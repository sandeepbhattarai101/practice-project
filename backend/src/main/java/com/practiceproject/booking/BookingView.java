package com.practiceproject.booking;

import com.practiceproject.billing.BillingService;
import com.practiceproject.billing.BillingService.InvoiceSummary;
import com.practiceproject.booking.BookingQueries.ShowContext;
import com.practiceproject.common.ApiException;
import com.practiceproject.config.AppProperties;
import com.practiceproject.payment.Payment;
import com.practiceproject.payment.PaymentRepository;
import com.practiceproject.settings.SettingsService;
import com.practiceproject.ticket.TicketService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Builds the Booking JSON shape from docs/API.md. Read-only. */
@Component
public class BookingView {

    public record MovieRef(String slug, String title, String posterUrl, String certification, int runtimeMinutes) {}
    public record CinemaRef(String slug, String name, String address) {}
    public record AuditoriumRef(String name) {}
    public record ShowtimeRef(Long id, Instant startsAt, Instant endsAt, String format, String language, String timezone,
                              MovieRef movie, CinemaRef cinema, AuditoriumRef auditorium) {}
    public record Item(Long seatId, String seatLabel, String categoryName, long priceMinor) {}
    public record Pricing(long subtotalMinor, long discountMinor, long feeMinor, long taxMinor, String taxLabel,
                          int taxRateBasisPoints, long totalMinor, String currency) {}
    public record CouponRef(String code, String description) {}
    public record Customer(String name, String email, String phone) {}
    public record Ticket(String code, String qrPayload, String qrUrl) {}
    public record PaymentRef(Long id, Payment.Provider provider, Payment.Status status, long amountMinor, Instant createdAt,
                             Instant completedAt, String failureReason) {}
    public record RefundRef(long amountMinor, String status, Instant createdAt, Instant processedAt) {}

    public record BookingDto(String reference, Booking.Status status, ShowtimeRef showtime, List<Item> items, Pricing pricing,
                             CouponRef coupon, Customer customer, Instant holdExpiresAt, Instant confirmedAt,
                             Instant cancelledAt, String cancellationReason, Ticket ticket, Instant checkedInAt,
                             List<PaymentRef> payments, RefundRef refund, boolean cancellable, long cancellationRefundMinor,
                             List<InvoiceSummary> invoices, Instant createdAt) {}

    /** Serialises flat: all Booking fields plus userId and userEmail. */
    public record AdminBookingDto(@com.fasterxml.jackson.annotation.JsonUnwrapped BookingDto booking, Long userId, String userEmail) {}

    private final JdbcTemplate jdbc;
    private final BookingQueries queries;
    private final BookingService service;
    private final PaymentRepository payments;
    private final SettingsService settings;
    private final TicketService tickets;
    private final BillingService billing;
    private final AppProperties props;

    public BookingView(JdbcTemplate jdbc, BookingQueries queries, BookingService service, PaymentRepository payments,
                       SettingsService settings, TicketService tickets, BillingService billing, AppProperties props) {
        this.jdbc = jdbc;
        this.queries = queries;
        this.service = service;
        this.payments = payments;
        this.settings = settings;
        this.tickets = tickets;
        this.billing = billing;
        this.props = props;
    }

    @Transactional(readOnly = true)
    public BookingDto build(Booking b) {
        ShowContext show = queries.show(b.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        Map<String, Object> movie = jdbc.queryForMap(
                "select slug, poster_url, certification, runtime_minutes from movies where id = ?", show.movieId());
        String cinemaSlug = jdbc.queryForObject("select slug from cinemas where id = ?", String.class, show.cinemaId());

        var showtime = new ShowtimeRef(show.showtimeId(), show.startsAt(), show.endsAt(), show.format(),
                jdbc.queryForObject("select language from showtimes where id = ?", String.class, show.showtimeId()),
                show.timezone(),
                new MovieRef((String) movie.get("slug"), show.movieTitle(), props.absoluteUrl((String) movie.get("poster_url")),
                        (String) movie.get("certification"), ((Number) movie.get("runtime_minutes")).intValue()),
                new CinemaRef(cinemaSlug, show.cinemaName(), show.cinemaAddress()), new AuditoriumRef(show.auditoriumName()));

        List<Item> items = jdbc.query("""
                select seat_id, seat_label, category_name, price_minor from booking_items
                where booking_id = ? order by seat_label
                """, (rs, i) -> new Item(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4)), b.getId());

        var cfg = settings.booking();
        var pricing = new Pricing(b.getSubtotalMinor(), b.getDiscountMinor(), b.getFeeMinor(), b.getTaxMinor(), cfg.taxLabel(),
                cfg.taxRateBasisPoints(), b.getTotalMinor(), b.getCurrency());

        CouponRef coupon = b.getCouponId() == null ? null : jdbc.query(
                "select code, description from coupons where id = ?",
                (rs, i) -> new CouponRef(rs.getString(1), rs.getString(2)), b.getCouponId()).stream().findFirst().orElse(null);

        Ticket ticket = b.getStatus() == Booking.Status.CONFIRMED && b.getTicketCode() != null
                ? new Ticket(b.getTicketCode(), tickets.payload(b.getReference(), b.getTicketCode()),
                props.absoluteUrl("/api/bookings/" + b.getReference() + "/qr.png"))
                : null;

        List<PaymentRef> paymentRefs = payments.findByBookingIdOrderByCreatedAtDesc(b.getId()).stream()
                .map(p -> new PaymentRef(p.getId(), p.getProvider(), p.getStatus(), p.getAmountMinor(), p.getCreatedAt(),
                        p.getCompletedAt(), p.getFailureReason()))
                .toList();

        RefundRef refund = jdbc.query("""
                select amount_minor, status, created_at, processed_at from refunds where booking_id = ? order by created_at desc limit 1
                """, (rs, i) -> new RefundRef(rs.getLong(1), rs.getString(2), rs.getTimestamp(3).toInstant(),
                toInstant(rs.getTimestamp(4))), b.getId()).stream().findFirst().orElse(null);

        var quote = service.quoteCustomerCancel(b, show.startsAt());
        return new BookingDto(b.getReference(), b.getStatus(), showtime, items, pricing, coupon,
                new Customer(b.getCustomerName(), b.getCustomerEmail(), b.getCustomerPhone()), b.getHoldExpiresAt(),
                b.getConfirmedAt(), b.getCancelledAt(), b.getCancellationReason(), ticket, b.getCheckedInAt(), paymentRefs,
                refund, quote.allowed(), quote.refundMinor(), billing.summariesForBooking(b.getId()), b.getCreatedAt());
    }

    @Transactional(readOnly = true)
    public AdminBookingDto buildAdmin(Booking b) {
        String email = b.getUserId() == null ? null
                : jdbc.queryForList("select email from users where id = ?", String.class, b.getUserId()).stream().findFirst().orElse(null);
        return new AdminBookingDto(build(b), b.getUserId(), email);
    }

    private static Instant toInstant(Timestamp ts) {
        return ts == null ? null : ts.toInstant();
    }

    static ApiException notFound() {
        return ApiException.notFound("Booking");
    }
}
