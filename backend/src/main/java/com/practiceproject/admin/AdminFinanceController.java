package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.auth.CurrentUser;
import com.practiceproject.auth.User;
import com.practiceproject.auth.UserRepository;
import com.practiceproject.billing.BillingService;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Json;
import com.practiceproject.common.PageResponse;
import com.practiceproject.payment.Payment;
import com.practiceproject.payment.PaymentService;
import com.practiceproject.refund.RefundService;
import com.practiceproject.settings.SettingsService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Money, people and platform settings. Platform admins only. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminFinanceController {

    public record PaymentRow(Long id, String bookingReference, Payment.Provider provider, Payment.Status status, long amountMinor,
                             String merchantTxnId, String providerTxnId, Instant createdAt, Instant completedAt,
                             String failureReason, int checkAttempts) {}

    public record PaymentEvent(String eventType, Object payload, Instant createdAt) {}

    public record PaymentDetail(PaymentRow payment, List<PaymentEvent> events) {}

    public record RefundRow(Long id, String bookingReference, long amountMinor, String status, String reason, String provider,
                            String providerRef, String notes, Instant createdAt, Instant processedAt) {}

    public record ProcessRequest(@Size(max = 120) String providerRef, @Size(max = 500) String notes) {}

    public record RejectRequest(@Size(max = 500) String notes) {}

    public record UserRow(Long id, String email, String fullName, String phone, User.Role role, User.Status status,
                          boolean emailVerified, Instant createdAt, long bookingCount, List<Long> managedCinemaIds) {}

    public record UserUpdate(@NotNull User.Role role, @NotNull User.Status status, List<Long> managedCinemaIds) {}

    private final JdbcTemplate jdbc;
    private final PaymentService payments;
    private final RefundService refunds;
    private final BillingService billing;
    private final UserRepository users;
    private final SettingsService settings;
    private final AuditService audit;
    private final Json json;

    public AdminFinanceController(JdbcTemplate jdbc, PaymentService payments, RefundService refunds, BillingService billing,
                                  UserRepository users, SettingsService settings, AuditService audit, Json json) {
        this.jdbc = jdbc;
        this.payments = payments;
        this.refunds = refunds;
        this.billing = billing;
        this.users = users;
        this.settings = settings;
        this.audit = audit;
        this.json = json;
    }

    // ------------------------------------------------------------------ payments

    private static final String PAYMENT_SELECT = """
            select p.id, b.reference, p.provider, p.status, p.amount_minor, p.merchant_txn_id, p.provider_txn_id,
                   p.created_at, p.completed_at, p.failure_reason, p.check_attempts
            from payments p join bookings b on b.id = p.booking_id
            """;

    @GetMapping("/payments")
    public PageResponse<PaymentRow> payments(@RequestParam(required = false) String status,
                                             @RequestParam(required = false) String provider,
                                             @RequestParam(required = false) String q,
                                             @RequestParam(required = false) Integer page,
                                             @RequestParam(required = false) Integer size) {
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        String like = blank(q) == null ? null : "%" + q.trim().toUpperCase() + "%";
        String where = """
                 where (?::text is null or p.status = ?) and (?::text is null or p.provider = ?)
                   and (?::text is null or upper(b.reference) like ? or upper(p.merchant_txn_id) like ? or upper(coalesce(p.provider_txn_id, '')) like ?)
                """;
        Object[] args = {blank(status), blank(status), blank(provider), blank(provider), like, like, like, like};
        Long total = jdbc.queryForObject("select count(*) from payments p join bookings b on b.id = p.booking_id" + where, Long.class, args);
        List<Object> pageArgs = new ArrayList<>(java.util.Arrays.asList(args)); // asList, not List.of: filter values may be null
        pageArgs.add(s);
        pageArgs.add((long) p * s);
        var rows = jdbc.query(PAYMENT_SELECT + where + " order by p.created_at desc limit ? offset ?", (rs, i) -> paymentRow(rs),
                pageArgs.toArray());
        return PageResponse.of(rows, p, s, total == null ? 0 : total);
    }

    @GetMapping("/payments/{id}")
    public PaymentDetail payment(@PathVariable Long id) {
        PaymentRow row = jdbc.query(PAYMENT_SELECT + " where p.id = ?", (rs, i) -> paymentRow(rs), id).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Payment"));
        List<PaymentEvent> events = jdbc.query("select event_type, payload::text, created_at from payment_events where payment_id = ? order by id",
                (rs, i) -> new PaymentEvent(rs.getString(1), json.read(rs.getString(2), Object.class), rs.getTimestamp(3).toInstant()), id);
        return new PaymentDetail(row, events);
    }

    @PostMapping("/payments/{id}/reconcile")
    public PaymentDetail reconcile(@PathVariable Long id) {
        payments.reconcile(id, "admin:" + CurrentUser.require().email());
        return payment(id);
    }

    private static PaymentRow paymentRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new PaymentRow(rs.getLong(1), rs.getString(2), Payment.Provider.valueOf(rs.getString(3)),
                Payment.Status.valueOf(rs.getString(4)), rs.getLong(5), rs.getString(6), rs.getString(7),
                rs.getTimestamp(8).toInstant(), rs.getTimestamp(9) == null ? null : rs.getTimestamp(9).toInstant(),
                rs.getString(10), rs.getInt(11));
    }

    // ------------------------------------------------------------------ refunds

    @GetMapping("/refunds")
    public PageResponse<RefundRow> refunds(@RequestParam(required = false) String status,
                                           @RequestParam(required = false) Integer page,
                                           @RequestParam(required = false) Integer size) {
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        Long total = jdbc.queryForObject("select count(*) from refunds where (?::text is null or status = ?)", Long.class,
                blank(status), blank(status));
        var rows = jdbc.query("""
                select r.id, b.reference, r.amount_minor, r.status, r.reason, p.provider, r.provider_ref, r.notes, r.created_at, r.processed_at
                from refunds r join bookings b on b.id = r.booking_id join payments p on p.id = r.payment_id
                where (?::text is null or r.status = ?)
                order by (r.status = 'PENDING') desc, r.created_at desc limit ? offset ?
                """, (rs, i) -> new RefundRow(rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getString(7), rs.getString(8), rs.getTimestamp(9).toInstant(),
                rs.getTimestamp(10) == null ? null : rs.getTimestamp(10).toInstant()), blank(status), blank(status), s, (long) p * s);
        return PageResponse.of(rows, p, s, total == null ? 0 : total);
    }

    @PostMapping("/refunds/{id}/process")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void processRefund(@PathVariable Long id, @Valid @RequestBody ProcessRequest body) {
        refunds.process(id, blank(body.providerRef()), blank(body.notes()), CurrentUser.require().id());
    }

    @PostMapping("/refunds/{id}/reject")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void rejectRefund(@PathVariable Long id, @Valid @RequestBody RejectRequest body) {
        refunds.reject(id, blank(body.notes()), CurrentUser.require().id());
    }

    // ------------------------------------------------------------------ billing

    @GetMapping("/invoices")
    public PageResponse<BillingService.InvoiceDto> invoices(@RequestParam(required = false) String q, @RequestParam(required = false) String kind,
                                                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                            @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        return billing.list(new BillingService.LedgerFilter(q, kind, from, to), PageResponse.clampPage(page), PageResponse.clampSize(size));
    }

    @GetMapping("/invoices/summary")
    public Map<String, Object> invoiceSummary(@RequestParam(required = false) String q, @RequestParam(required = false) String kind,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        Map<String, Object> t = billing.totals(new BillingService.LedgerFilter(q, kind, from, to));
        return Map.of("invoicedMinor", t.get("invoiced_minor"), "creditedMinor", t.get("credited_minor"),
                "netMinor", t.get("net_minor"), "netTaxMinor", t.get("net_tax_minor"),
                "invoiceCount", t.get("invoice_count"), "creditNoteCount", t.get("credit_note_count"));
    }

    // Registered before /invoices/{number} would also match "invoices.csv" — distinct path, no clash.
    @GetMapping("/invoices.csv")
    public ResponseEntity<String> invoicesCsv(@RequestParam(required = false) String q, @RequestParam(required = false) String kind,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return AdminOperationsController.csv("invoices.csv", billing.csv(new BillingService.LedgerFilter(q, kind, from, to)));
    }

    @GetMapping("/invoices/{number}")
    public BillingService.InvoiceDto invoice(@PathVariable String number) {
        return billing.byNumber(number).orElseThrow(() -> ApiException.notFound("Invoice"));
    }

    // ------------------------------------------------------------------ users

    @GetMapping("/users")
    public PageResponse<UserRow> users(@RequestParam(required = false) String q, @RequestParam(required = false) String role,
                                       @RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        String like = blank(q) == null ? null : "%" + q.trim().toLowerCase() + "%";
        String where = " where (?::text is null or lower(u.email) like ? or lower(u.full_name) like ?) and (?::text is null or u.role = ?)";
        Object[] args = {like, like, like, blank(role), blank(role)};
        Long total = jdbc.queryForObject("select count(*) from users u" + where, Long.class, args);
        List<Object> pageArgs = new ArrayList<>(java.util.Arrays.asList(args)); // asList, not List.of: filter values may be null
        pageArgs.add(s);
        pageArgs.add((long) p * s);
        var rows = jdbc.query("""
                select u.id, u.email, u.full_name, u.phone, u.role, u.status, u.email_verified_at is not null, u.created_at,
                       (select count(*) from bookings b where b.user_id = u.id and b.status = 'CONFIRMED'),
                       array(select cinema_id from manager_cinemas mc where mc.user_id = u.id order by cinema_id)
                from users u""" + where + " order by u.created_at desc limit ? offset ?", (rs, i) -> new UserRow(rs.getLong(1),
                rs.getString(2), rs.getString(3), rs.getString(4), User.Role.valueOf(rs.getString(5)), User.Status.valueOf(rs.getString(6)),
                rs.getBoolean(7), rs.getTimestamp(8).toInstant(), rs.getLong(9), List.of((Long[]) rs.getArray(10).getArray())),
                pageArgs.toArray());
        return PageResponse.of(rows, p, s, total == null ? 0 : total);
    }

    @PutMapping("/users/{id}")
    @Transactional
    public UserRow updateUser(@PathVariable Long id, @Valid @RequestBody UserUpdate body) {
        User user = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        if (id.equals(CurrentUser.require().id()) && (body.role() != User.Role.ADMIN || body.status() != User.Status.ACTIVE)) {
            throw ApiException.unprocessable("SELF_LOCKOUT", "You can't remove your own admin access or disable yourself");
        }
        User.Role before = user.getRole();
        user.setRole(body.role());
        user.setStatus(body.status());
        users.saveAndFlush(user);
        users.clearManagedCinemas(id);
        if (body.role() == User.Role.CINEMA_MANAGER && body.managedCinemaIds() != null) {
            for (Long cinemaId : body.managedCinemaIds()) {
                users.addManagedCinema(id, cinemaId);
            }
        }
        if (body.status() == User.Status.DISABLED) {
            // End their sessions immediately rather than waiting for the next request.
            jdbc.update("delete from spring_session where principal_name = ?", user.getEmail().toLowerCase());
        }
        audit.record("user.updated", "user", id, Map.of("roleBefore", before.name(), "role", body.role().name(),
                "status", body.status().name(), "managedCinemaIds", body.managedCinemaIds() == null ? List.of() : body.managedCinemaIds()));
        return users(user.getEmail(), null, 0, 1).items().stream().filter(u -> u.id().equals(id)).findFirst().orElseThrow();
    }

    // ------------------------------------------------------------------ settings & audit

    @GetMapping("/settings")
    public List<SettingsService.Setting> settings() {
        return settings.list();
    }

    @PutMapping("/settings")
    public List<SettingsService.Setting> updateSettings(@RequestBody Map<String, Object> changes) {
        if (changes.isEmpty() || changes.size() > 50) {
            throw ApiException.badRequest("Send between 1 and 50 settings");
        }
        settings.update(changes, CurrentUser.require().id());
        audit.record("settings.updated", "settings", null, changes);
        return settings.list();
    }

    @GetMapping("/audit")
    public PageResponse<Map<String, Object>> audit(@RequestParam(required = false) String entityType,
                                                   @RequestParam(required = false) Integer page,
                                                   @RequestParam(required = false) Integer size) {
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        Long total = jdbc.queryForObject("select count(*) from audit_events where (?::text is null or entity_type = ?)", Long.class,
                blank(entityType), blank(entityType));
        var rows = jdbc.query("""
                select id, actor_email, action, entity_type, entity_id, details::text, ip_address, created_at from audit_events
                where (?::text is null or entity_type = ?) order by created_at desc, id desc limit ? offset ?
                """, (rs, i) -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", rs.getLong(1));
            m.put("actorEmail", rs.getString(2));
            m.put("action", rs.getString(3));
            m.put("entityType", rs.getString(4));
            m.put("entityId", rs.getString(5));
            m.put("details", json.read(rs.getString(6), Object.class));
            m.put("ipAddress", rs.getString(7));
            m.put("createdAt", rs.getTimestamp(8).toInstant());
            return m;
        }, blank(entityType), blank(entityType), s, (long) p * s);
        return PageResponse.of(rows, p, s, total == null ? 0 : total);
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
