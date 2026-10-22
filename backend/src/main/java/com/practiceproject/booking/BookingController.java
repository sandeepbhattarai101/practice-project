package com.practiceproject.booking;

import com.practiceproject.auth.CurrentUser;
import com.practiceproject.auth.GuestBookings;
import com.practiceproject.billing.BillingService;
import com.practiceproject.booking.BookingView.BookingDto;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import com.practiceproject.common.Tokens;
import com.practiceproject.payment.Payment;
import com.practiceproject.payment.PaymentService;
import com.practiceproject.ticket.TicketService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class BookingController {

    public record HoldRequest(@NotNull Long showtimeId, @NotEmpty @Size(max = 20) List<@NotNull Long> seatIds) {}

    public record CustomerRequest(@NotBlank @Size(max = 120) String name, @NotBlank @Email @Size(max = 254) String email,
                                  @Size(max = 30) @Pattern(regexp = "^[0-9+\\- ]*$", message = "Use digits, spaces, + or -") String phone) {}

    public record CouponRequest(@NotBlank @Size(max = 40) String code) {}

    public record PaymentRequest(@NotNull Payment.Provider provider) {}

    public record CancelRequest(@Size(max = 300) String reason) {}

    public record LookupRequest(@NotBlank @Size(max = 20) String reference, @Email @Size(max = 254) String email,
                                @Size(max = 200) String token) {}

    public record BookingSummary(String reference, Booking.Status status, String movieTitle, String posterUrl, String cinemaName,
                                 Instant startsAt, String timezone, List<String> seatLabels, long totalMinor, Instant createdAt) {}

    private final BookingService bookings;
    private final BookingRepository repository;
    private final BookingView view;
    private final BookingAccess access;
    private final PaymentService payments;
    private final TicketService tickets;
    private final BillingService billing;
    private final JdbcTemplate jdbc;
    private final com.practiceproject.config.AppProperties props;

    public BookingController(BookingService bookings, BookingRepository repository, BookingView view, BookingAccess access,
                             PaymentService payments, TicketService tickets, BillingService billing, JdbcTemplate jdbc,
                             com.practiceproject.config.AppProperties props) {
        this.bookings = bookings;
        this.repository = repository;
        this.view = view;
        this.access = access;
        this.payments = payments;
        this.tickets = tickets;
        this.billing = billing;
        this.jdbc = jdbc;
        this.props = props;
    }

    @PostMapping("/bookings")
    @ResponseStatus(HttpStatus.CREATED)
    public BookingDto hold(@Valid @RequestBody HoldRequest body, HttpServletRequest request) {
        Booking booking = bookings.hold(body.showtimeId(), body.seatIds(), CurrentUser.get().orElse(null),
                GuestBookings.ids(request));
        if (booking.getUserId() == null) {
            GuestBookings.add(request, booking.getId());
        }
        return view.build(booking);
    }

    @GetMapping("/bookings/{reference}")
    public BookingDto get(@PathVariable String reference, HttpServletRequest request) {
        Booking booking = repository.findByReference(reference).orElseThrow(BookingView::notFound);
        access.customer(request).require(booking);
        return view.build(booking);
    }

    @PutMapping("/bookings/{reference}/customer")
    public BookingDto customer(@PathVariable String reference, @Valid @RequestBody CustomerRequest body, HttpServletRequest request) {
        return view.build(bookings.updateCustomer(reference, body.name(), body.email(), body.phone(), access.customer(request)));
    }

    @PostMapping("/bookings/{reference}/coupon")
    public BookingDto applyCoupon(@PathVariable String reference, @Valid @RequestBody CouponRequest body, HttpServletRequest request) {
        return view.build(bookings.applyCoupon(reference, body.code(), access.customer(request)));
    }

    @DeleteMapping("/bookings/{reference}/coupon")
    public BookingDto removeCoupon(@PathVariable String reference, HttpServletRequest request) {
        return view.build(bookings.removeCoupon(reference, access.customer(request)));
    }

    @PostMapping("/bookings/{reference}/release")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void release(@PathVariable String reference, HttpServletRequest request) {
        bookings.release(reference, access.customer(request));
    }

    @PostMapping("/bookings/{reference}/payments")
    public PaymentService.StartResponse pay(@PathVariable String reference, @Valid @RequestBody PaymentRequest body,
                                            @RequestHeader("Idempotency-Key") String idempotencyKey, HttpServletRequest request) {
        return payments.start(reference, body.provider(), idempotencyKey, access.customer(request));
    }

    @PostMapping("/bookings/{reference}/payments/verify")
    public BookingDto verify(@PathVariable String reference, HttpServletRequest request) {
        payments.reconcileBooking(reference, access.customer(request));
        return view.build(repository.findByReference(reference).orElseThrow(BookingView::notFound));
    }

    @PostMapping("/bookings/{reference}/cancel")
    public BookingDto cancel(@PathVariable String reference, @Valid @RequestBody(required = false) CancelRequest body,
                             HttpServletRequest request) {
        return view.build(bookings.cancelByCustomer(reference, body == null ? null : body.reason(), access.customer(request)));
    }

    @PostMapping("/bookings/{reference}/resend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resend(@PathVariable String reference, HttpServletRequest request) {
        Booking booking = repository.findByReference(reference).orElseThrow(BookingView::notFound);
        access.customer(request).require(booking);
        Integer recent = jdbc.queryForObject("""
                select count(*) from notifications where booking_id = ? and type = 'BOOKING_CONFIRMED'
                  and created_at > now() - interval '1 hour'
                """, Integer.class, booking.getId());
        if (recent != null && recent >= 4) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "We've sent this ticket several times recently. Please check your spam folder.");
        }
        bookings.resendConfirmation(reference, access.customer(request));
    }

    @GetMapping(value = "/bookings/{reference}/qr.png", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> qr(@PathVariable String reference, HttpServletRequest request) {
        Booking booking = repository.findByReference(reference).orElseThrow(BookingView::notFound);
        access.customer(request).require(booking);
        if (booking.getStatus() != Booking.Status.CONFIRMED) {
            throw ApiException.notFound("Ticket");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePrivate())
                .body(tickets.qrPng(tickets.payload(booking.getReference(), booking.getTicketCode())));
    }

    @GetMapping("/bookings/{reference}/invoices")
    public List<BillingService.InvoiceDto> invoices(@PathVariable String reference, HttpServletRequest request) {
        Booking booking = repository.findByReference(reference).orElseThrow(BookingView::notFound);
        access.customer(request).require(booking);
        return billing.forBooking(booking.getId());
    }

    /** "Find my booking": reference + email, or reference + the token from the confirmation email. */
    @PostMapping("/bookings/lookup")
    public BookingDto lookup(@Valid @RequestBody LookupRequest body, HttpServletRequest request) {
        Booking booking = repository.findByReference(body.reference().trim().toUpperCase())
                .orElseThrow(() -> lookupFailed());
        boolean ok;
        if (body.token() != null && !body.token().isBlank()) {
            ok = booking.getAccessTokenHash() != null
                    && Tokens.constantTimeEquals(booking.getAccessTokenHash(), Tokens.sha256Hex(body.token()));
        } else {
            ok = body.email() != null && booking.getCustomerEmail() != null
                    && booking.getCustomerEmail().equalsIgnoreCase(body.email().trim());
        }
        if (!ok) {
            throw lookupFailed();
        }
        GuestBookings.add(request, booking.getId());
        return view.build(booking);
    }

    @GetMapping("/me/bookings")
    public PageResponse<BookingSummary> myBookings(@RequestParam(required = false) String scope,
                                                   @RequestParam(required = false) Integer page,
                                                   @RequestParam(required = false) Integer size) {
        Long userId = CurrentUser.require().id();
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        // Abandoned holds are noise in a booking history, so only show bookings that went somewhere.
        String filter = switch (scope == null ? "all" : scope) {
            case "upcoming" -> " and b.status in ('CONFIRMED', 'PAYMENT_PENDING') and s.starts_at > now()";
            case "past" -> " and (s.starts_at <= now() or b.status = 'CANCELLED')";
            default -> "";
        };
        String base = """
                from bookings b
                join showtimes s on s.id = b.showtime_id
                join movies m on m.id = s.movie_id
                join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id
                join cities ci on ci.id = c.city_id
                where b.user_id = ? and b.status in ('CONFIRMED', 'CANCELLED', 'PAYMENT_PENDING')
                """ + filter;
        Long total = jdbc.queryForObject("select count(*) " + base, Long.class, userId);
        String order = "upcoming".equals(scope) ? " order by s.starts_at asc" : " order by s.starts_at desc";
        List<BookingSummary> items = jdbc.query("""
                select b.reference, b.status, m.title, m.poster_url, c.name, s.starts_at, ci.timezone,
                       array(select bi.seat_label from booking_items bi where bi.booking_id = b.id order by bi.seat_label),
                       b.total_minor, b.created_at
                """ + base + order + " limit ? offset ?", (rs, i) -> new BookingSummary(rs.getString(1),
                Booking.Status.valueOf(rs.getString(2)), rs.getString(3), props.absoluteUrl(rs.getString(4)), rs.getString(5),
                rs.getTimestamp(6).toInstant(), rs.getString(7), List.of((String[]) rs.getArray(8).getArray()), rs.getLong(9),
                rs.getTimestamp(10).toInstant()), userId, s, (long) p * s);
        return PageResponse.of(items, p, s, total == null ? 0 : total);
    }

    private static ApiException lookupFailed() {
        return ApiException.notFound("Booking with those details");
    }
}
