package com.practiceproject.billing;

import com.fasterxml.jackson.core.type.TypeReference;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Formats;
import com.practiceproject.common.Json;
import com.practiceproject.common.PageResponse;
import com.practiceproject.settings.SettingsService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues invoices (on confirmation) and credit notes (on refund). Both are written in the
 * same transaction as the booking change that caused them, so a confirmed booking always
 * has its invoice, and an invoice never exists for a booking that failed to confirm.
 */
@Service
public class BillingService {

    public record Line(String description, int quantity, long unitPriceMinor, long amountMinor) {}

    public record Party(String name, String address, String taxId) {}

    public record Customer(String name, String email, String phone) {}

    public record PaymentRef(String provider, String providerTxnId) {}

    public record InvoiceDto(String number, String kind, Instant issuedAt, String fiscalYear, String bookingReference,
                             String originalInvoiceNumber, Party seller, Customer customer, String currency,
                             List<Line> lines, long subtotalMinor, long discountMinor, long feeMinor, long taxMinor,
                             int taxRateBasisPoints, String taxLabel, long totalMinor, PaymentRef payment, String timezone) {}

    public record InvoiceSummary(String number, String kind, Instant issuedAt, long totalMinor) {}

    private static final TypeReference<List<Line>> LINES = new TypeReference<>() {};
    private static final String TZ = "Asia/Kathmandu";

    private final NamedParameterJdbcTemplate jdbc;
    private final SettingsService settings;
    private final Json json;

    public BillingService(NamedParameterJdbcTemplate jdbc, SettingsService settings, Json json) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.json = json;
    }

    /** Issues the tax invoice for a just-confirmed booking. Idempotent per booking. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void issueInvoice(Long bookingId, Long paymentId) {
        var p = new MapSqlParameterSource("bookingId", bookingId);
        if (exists("select 1 from invoices where booking_id = :bookingId and kind = 'INVOICE'", p)) {
            return;
        }
        Map<String, Object> b = jdbc.queryForMap("""
                select b.customer_name, b.customer_email, b.customer_phone, b.currency, b.subtotal_minor, b.discount_minor,
                       b.fee_minor, b.tax_minor, b.total_minor, b.reference, m.title, s.starts_at, s.format, ci.timezone,
                       (select count(*) from booking_items bi where bi.booking_id = b.id) as tickets
                from bookings b
                join showtimes s on s.id = b.showtime_id
                join movies m on m.id = s.movie_id
                join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id
                join cities ci on ci.id = c.city_id
                where b.id = :bookingId
                """, p);
        String tz = (String) b.get("timezone");
        String show = b.get("title") + " (" + b.get("format") + "), "
                + Formats.dateTime(((java.sql.Timestamp) b.get("starts_at")).toInstant(), tz);

        List<Line> lines = new ArrayList<>(jdbc.query("""
                select category_name, price_minor, count(*) as qty
                from booking_items where booking_id = :bookingId
                group by category_name, price_minor
                order by price_minor desc
                """, p, (rs, i) -> {
            int qty = rs.getInt(3);
            long unit = rs.getLong(2);
            return new Line("Ticket — " + rs.getString(1) + " · " + show, qty, unit, unit * qty);
        }));
        long fee = ((Number) b.get("fee_minor")).longValue();
        int tickets = ((Number) b.get("tickets")).intValue();
        if (fee > 0) {
            lines.add(new Line("Convenience fee", tickets, fee / Math.max(tickets, 1), fee));
        }

        var cfg = settings.booking();
        insert("INVOICE", bookingId, paymentId, null, null, (String) b.get("customer_name"), (String) b.get("customer_email"),
                (String) b.get("customer_phone"), (String) b.get("currency"),
                ((Number) b.get("subtotal_minor")).longValue(), ((Number) b.get("discount_minor")).longValue(), fee,
                ((Number) b.get("tax_minor")).longValue(), cfg.taxRateBasisPoints(), cfg.taxLabel(),
                ((Number) b.get("total_minor")).longValue(), lines);
    }

    /**
     * Credit note for a refund, splitting the refunded amount into net, fee and tax in the
     * same proportions as the original invoice.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void issueCreditNote(Long refundId, Long bookingId, long refundMinor, String reason) {
        if (refundMinor <= 0) {
            return;
        }
        var p = new MapSqlParameterSource("bookingId", bookingId).addValue("refundId", refundId);
        if (exists("select 1 from invoices where refund_id = :refundId", p)) {
            return;
        }
        List<Map<String, Object>> originals = jdbc.queryForList(
                "select * from invoices where booking_id = :bookingId and kind = 'INVOICE'", p);
        if (originals.isEmpty()) {
            return; // nothing was invoiced (e.g. paid-but-never-confirmed): the refund alone is the record
        }
        Map<String, Object> inv = originals.getFirst();
        Long refundPaymentId = jdbc.queryForObject("select payment_id from refunds where id = :refundId", p, Long.class);
        if (!java.util.Objects.equals(refundPaymentId, inv.get("payment_id") == null ? null : ((Number) inv.get("payment_id")).longValue())) {
            return; // refund of a duplicate payment that was never invoiced: nothing to credit
        }
        long total = ((Number) inv.get("total_minor")).longValue();
        long amount = Math.min(refundMinor, total);
        long tax = proportion(((Number) inv.get("tax_minor")).longValue(), amount, total);
        long fee = proportion(((Number) inv.get("fee_minor")).longValue(), amount, total);
        long net = amount - tax - fee;
        String reference = jdbc.queryForObject("select reference from bookings where id = :bookingId", p, String.class);
        var lines = List.of(new Line("Refund — booking " + reference + " (" + reason + ")", 1, net, net));
        if (fee > 0) {
            lines = List.of(lines.getFirst(), new Line("Convenience fee refunded", 1, fee, fee));
        }
        insert("CREDIT_NOTE", bookingId, (Long) inv.get("payment_id"), refundId, ((Number) inv.get("id")).longValue(),
                (String) inv.get("customer_name"), (String) inv.get("customer_email"), (String) inv.get("customer_phone"),
                (String) inv.get("currency"), net, 0, fee, tax, ((Number) inv.get("tax_rate_basis_points")).intValue(),
                (String) inv.get("tax_label"), amount, lines);
    }

    @Transactional(readOnly = true)
    public List<InvoiceSummary> summariesForBooking(Long bookingId) {
        return jdbc.query("""
                select invoice_number, kind, issued_at, total_minor from invoices where booking_id = :id order by issued_at
                """, new MapSqlParameterSource("id", bookingId),
                (rs, i) -> new InvoiceSummary(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant(), rs.getLong(4)));
    }

    @Transactional(readOnly = true)
    public List<InvoiceDto> forBooking(Long bookingId) {
        return jdbc.query(SELECT + " where i.booking_id = :id order by i.issued_at", new MapSqlParameterSource("id", bookingId), mapper());
    }

    @Transactional(readOnly = true)
    public Optional<InvoiceDto> byNumber(String number) {
        return jdbc.query(SELECT + " where i.invoice_number = :n", new MapSqlParameterSource("n", number), mapper()).stream().findFirst();
    }

    public record LedgerFilter(String q, String kind, LocalDate from, LocalDate to) {}

    @Transactional(readOnly = true)
    public PageResponse<InvoiceDto> list(LedgerFilter f, int page, int size) {
        var params = filterParams(f);
        long total = jdbc.queryForObject("select count(*) from invoices i join bookings b on b.id = i.booking_id" + WHERE, params, Long.class);
        params.addValue("limit", size).addValue("offset", (long) page * size);
        var items = jdbc.query(SELECT + WHERE + " order by i.issued_at desc, i.id desc limit :limit offset :offset", params, mapper());
        return PageResponse.of(items, page, size, total);
    }

    /** Totals for the billing dashboard: invoiced, credited and net, per tax line. */
    @Transactional(readOnly = true)
    public Map<String, Object> totals(LedgerFilter f) {
        return jdbc.queryForMap("""
                select
                  coalesce(sum(case when i.kind = 'INVOICE' then i.total_minor end), 0)       as invoiced_minor,
                  coalesce(sum(case when i.kind = 'CREDIT_NOTE' then i.total_minor end), 0)   as credited_minor,
                  coalesce(sum(case when i.kind = 'INVOICE' then i.tax_minor else -i.tax_minor end), 0) as net_tax_minor,
                  coalesce(sum(case when i.kind = 'INVOICE' then i.total_minor else -i.total_minor end), 0) as net_minor,
                  count(*) filter (where i.kind = 'INVOICE')     as invoice_count,
                  count(*) filter (where i.kind = 'CREDIT_NOTE') as credit_note_count
                from invoices i join bookings b on b.id = i.booking_id
                """ + WHERE, filterParams(f));
    }

    @Transactional(readOnly = true)
    public String csv(LedgerFilter f) {
        var sb = new StringBuilder("Number,Kind,Issued,Booking,Customer,Email,Subtotal,Discount,Fees,Tax,Total,Currency\n");
        var params = filterParams(f);
        jdbc.query(SELECT + WHERE + " order by i.issued_at, i.id", params, mapper()).forEach(i -> sb
                .append(csvCell(i.number())).append(',').append(i.kind()).append(',')
                .append(Formats.dateTime(i.issuedAt(), TZ)).append(',').append(csvCell(i.bookingReference())).append(',')
                .append(csvCell(i.customer().name())).append(',').append(csvCell(i.customer().email())).append(',')
                .append(sign(i, i.subtotalMinor())).append(',').append(sign(i, i.discountMinor())).append(',')
                .append(sign(i, i.feeMinor())).append(',').append(sign(i, i.taxMinor())).append(',')
                .append(sign(i, i.totalMinor())).append(',').append(i.currency()).append('\n'));
        return sb.toString();
    }

    // ------------------------------------------------------------------ internals

    private static final String SELECT = """
            select i.*, b.reference as booking_reference, o.invoice_number as original_number,
                   p.provider as payment_provider, p.provider_txn_id as payment_provider_txn
            from invoices i
            join bookings b on b.id = i.booking_id
            left join invoices o on o.id = i.original_invoice_id
            left join payments p on p.id = i.payment_id
            """;

    private static final String WHERE = """
             where (cast(:q as text) is null or i.invoice_number ilike :q or b.reference ilike :q
                    or i.customer_email ilike :q or i.customer_name ilike :q)
               and (cast(:kind as text) is null or i.kind = :kind)
               and (cast(:from as date) is null or (i.issued_at at time zone 'Asia/Kathmandu')::date >= :from)
               and (cast(:to as date) is null or (i.issued_at at time zone 'Asia/Kathmandu')::date <= :to)
            """;

    private MapSqlParameterSource filterParams(LedgerFilter f) {
        return new MapSqlParameterSource()
                .addValue("q", f.q() == null || f.q().isBlank() ? null : "%" + f.q().trim().replace("%", "\\%").replace("_", "\\_") + "%")
                .addValue("kind", f.kind() == null || f.kind().isBlank() ? null : f.kind())
                .addValue("from", f.from()).addValue("to", f.to());
    }

    private void insert(String kind, Long bookingId, Long paymentId, Long refundId, Long originalId, String customerName,
                        String customerEmail, String customerPhone, String currency, long subtotal, long discount, long fee,
                        long tax, int taxBp, String taxLabel, long total, List<Line> lines) {
        String prefix = settingText("billing.invoicePrefix", "PP");
        String year = String.valueOf(LocalDate.now(ZoneId.of(TZ)).getYear());
        String seriesCode = (kind.equals("INVOICE") ? "INV" : "CN");
        String series = seriesCode + "-" + year;
        // Gap-free counter: see the comment on invoice_counters in V5.
        Long n = jdbc.queryForObject("""
                insert into invoice_counters (series, next_number) values (:series, 2)
                on conflict (series) do update set next_number = invoice_counters.next_number + 1
                returning next_number - 1
                """, new MapSqlParameterSource("series", series), Long.class);
        String number = "%s-%s-%s-%06d".formatted(prefix, seriesCode, year, n);

        jdbc.update("""
                insert into invoices (invoice_number, kind, booking_id, payment_id, refund_id, original_invoice_id, fiscal_year,
                    seller_name, seller_address, seller_tax_id, customer_name, customer_email, customer_phone, currency,
                    subtotal_minor, discount_minor, fee_minor, tax_minor, tax_rate_basis_points, tax_label, total_minor, lines)
                values (:number, :kind, :bookingId, :paymentId, :refundId, :originalId, :fy, :sellerName, :sellerAddress, :sellerTaxId,
                    :customerName, :customerEmail, :customerPhone, :currency, :subtotal, :discount, :fee, :tax, :taxBp, :taxLabel,
                    :total, cast(:lines as jsonb))
                """, new MapSqlParameterSource()
                .addValue("number", number).addValue("kind", kind).addValue("bookingId", bookingId)
                .addValue("paymentId", paymentId).addValue("refundId", refundId).addValue("originalId", originalId)
                .addValue("fy", year)
                .addValue("sellerName", settingText("billing.sellerName", "Practice Project"))
                .addValue("sellerAddress", settingText("billing.sellerAddress", "Kathmandu, Nepal"))
                .addValue("sellerTaxId", settingText("billing.sellerTaxId", null))
                .addValue("customerName", customerName == null || customerName.isBlank() ? "Customer" : customerName)
                .addValue("customerEmail", customerEmail).addValue("customerPhone", customerPhone)
                .addValue("currency", currency).addValue("subtotal", subtotal).addValue("discount", discount)
                .addValue("fee", fee).addValue("tax", tax).addValue("taxBp", taxBp).addValue("taxLabel", taxLabel)
                .addValue("total", total).addValue("lines", json.write(lines)));
    }

    private String settingText(String key, String fallback) {
        return settings.list().stream().filter(s -> s.key().equals(key)).map(s -> String.valueOf(s.value()))
                .findFirst().orElse(fallback);
    }

    private boolean exists(String sql, MapSqlParameterSource p) {
        return !jdbc.queryForList(sql, p).isEmpty();
    }

    private static long proportion(long part, long amount, long total) {
        if (total == 0) {
            return 0;
        }
        return BigDecimal.valueOf(part).multiply(BigDecimal.valueOf(amount))
                .divide(BigDecimal.valueOf(total), 0, RoundingMode.HALF_UP).longValueExact();
    }

    private static String sign(InvoiceDto i, long minor) {
        return Formats.decimal(i.kind().equals("CREDIT_NOTE") ? -minor : minor);
    }

    /** Quotes a CSV cell and defuses spreadsheet formula injection (=, +, -, @ at the start). */
    static String csvCell(String value) {
        if (value == null) {
            return "";
        }
        String v = value;
        if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }

    private RowMapper<InvoiceDto> mapper() {
        return (rs, i) -> new InvoiceDto(rs.getString("invoice_number"), rs.getString("kind"),
                rs.getTimestamp("issued_at").toInstant(), rs.getString("fiscal_year"), rs.getString("booking_reference"),
                rs.getString("original_number"),
                new Party(rs.getString("seller_name"), rs.getString("seller_address"), rs.getString("seller_tax_id")),
                new Customer(rs.getString("customer_name"), rs.getString("customer_email"), rs.getString("customer_phone")),
                rs.getString("currency"), readLines(rs.getString("lines")), rs.getLong("subtotal_minor"),
                rs.getLong("discount_minor"), rs.getLong("fee_minor"), rs.getLong("tax_minor"),
                rs.getInt("tax_rate_basis_points"), rs.getString("tax_label"), rs.getLong("total_minor"),
                rs.getString("payment_provider") == null ? null
                        : new PaymentRef(rs.getString("payment_provider"), rs.getString("payment_provider_txn")),
                TZ);
    }

    private List<Line> readLines(String raw) {
        try {
            return json.mapper().readValue(raw, LINES);
        } catch (Exception e) {
            throw new IllegalStateException("Corrupt invoice lines", e);
        }
    }

    static ApiException notFound() {
        return ApiException.notFound("Invoice");
    }
}
