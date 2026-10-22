package com.practiceproject.booking;

import com.practiceproject.audit.AuditService;
import com.practiceproject.auth.AuthUser;
import com.practiceproject.auth.User;
import com.practiceproject.auth.UserRepository;
import com.practiceproject.billing.BillingService;
import com.practiceproject.booking.BookingQueries.SeatPrice;
import com.practiceproject.booking.BookingQueries.ShowContext;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import com.practiceproject.coupon.CouponService;
import com.practiceproject.notification.EmailTemplates;
import com.practiceproject.notification.NotificationService;
import com.practiceproject.payment.Payment;
import com.practiceproject.payment.PaymentRepository;
import com.practiceproject.refund.RefundService;
import com.practiceproject.settings.SettingsService;
import com.practiceproject.settings.SettingsService.BookingSettings;
import com.practiceproject.ticket.TicketService;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The booking state machine. Every public method is one database transaction
 * ({@code @Transactional}): either everything it does commits, or nothing does.
 *
 * <pre>
 *   HELD ──startPayment──> PAYMENT_PENDING ──confirmPaid──> CONFIRMED ──cancel──> CANCELLED
 *    │  ▲                         │
 *    │  └────payment failed───────┘
 *    └──hold timed out / replaced──> EXPIRED   (a late successful payment can still confirm it
 *                                               if the seats are free, otherwise it is refunded)
 * </pre>
 */
@Service
public class BookingService {

    private static final Logger log = LoggerFactory.getLogger(BookingService.class);
    private static final int MAX_ACTIVE_HOLDS = 3;

    private final BookingRepository bookings;
    private final BookingQueries queries;
    private final SeatHoldRepository seatHolds;
    private final SettingsService settings;
    private final CouponService coupons;
    private final TicketService tickets;
    private final RefundService refunds;
    private final PaymentRepository payments;
    private final NotificationService notifications;
    private final EmailTemplates templates;
    private final AuditService audit;
    private final UserRepository users;
    private final AppProperties props;
    private final BillingService billing;

    public BookingService(BookingRepository bookings, BookingQueries queries, SeatHoldRepository seatHolds,
                          SettingsService settings, CouponService coupons, TicketService tickets, RefundService refunds,
                          PaymentRepository payments, NotificationService notifications, EmailTemplates templates,
                          AuditService audit, UserRepository users, AppProperties props, BillingService billing) {
        this.billing = billing;
        this.bookings = bookings;
        this.queries = queries;
        this.seatHolds = seatHolds;
        this.settings = settings;
        this.coupons = coupons;
        this.tickets = tickets;
        this.refunds = refunds;
        this.payments = payments;
        this.notifications = notifications;
        this.templates = templates;
        this.audit = audit;
        this.users = users;
        this.props = props;
    }

    // ------------------------------------------------------------------ hold seats

    @Transactional
    public Booking hold(Long showtimeId, List<Long> requestedSeatIds, AuthUser caller, Set<Long> guestBookingIds) {
        BookingSettings cfg = settings.booking();
        Set<Long> seatIds = new LinkedHashSet<>(requestedSeatIds);
        if (seatIds.isEmpty()) {
            throw ApiException.badRequest("Choose at least one seat");
        }
        if (seatIds.size() > cfg.maxSeatsPerBooking()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TOO_MANY_SEATS",
                    "You can book up to " + cfg.maxSeatsPerBooking() + " seats at a time");
        }

        ShowContext show = queries.lockShowForShare(showtimeId).orElseThrow(BookingQueries::showNotFound);
        Instant now = Instant.now();
        if (!salesOpen(show, cfg, now)) {
            throw ApiException.unprocessable("SALES_CLOSED", "Online sales for this show have closed");
        }

        List<SeatPrice> seats = queries.seatPrices(showtimeId, show.auditoriumId(), seatIds);
        if (seats.size() != seatIds.size() || seats.stream().anyMatch(s -> s.priceMinor() == null)) {
            Set<Long> valid = new HashSet<>();
            seats.stream().filter(s -> s.priceMinor() != null).forEach(s -> valid.add(s.seatId()));
            List<Long> bad = seatIds.stream().filter(id -> !valid.contains(id)).toList();
            throw new ApiException(HttpStatus.CONFLICT, "SEATS_UNAVAILABLE", "Some seats cannot be booked for this show",
                    Map.of("seatIds", bad));
        }

        Long userId = caller == null ? null : caller.id();
        // A new selection replaces this browser's earlier hold on the same show.
        for (Long openId : queries.openBookingsFor(showtimeId, userId, guestBookingIds)) {
            Booking open = bookings.lockById(openId).orElseThrow();
            if (open.getStatus() == Booking.Status.PAYMENT_PENDING) {
                throw ApiException.conflict("PAYMENT_IN_PROGRESS",
                        "You have a payment in progress for this show. Finish or cancel it first.");
            }
            if (open.getStatus() == Booking.Status.HELD) {
                expireInternal(open, "Replaced by a new seat selection");
            }
        }
        if (queries.activeHoldCount(userId, guestBookingIds) >= MAX_ACTIVE_HOLDS) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_HOLDS",
                    "You already have seats held for other shows. Complete or release them first.");
        }

        var booking = new Booking();
        booking.setReference("PP" + Tokens.readableCode(8));
        booking.setShowtimeId(showtimeId);
        booking.setUserId(userId);
        booking.setStatus(Booking.Status.HELD);
        booking.setCurrency(props.currency());
        booking.setHoldExpiresAt(now.plus(Duration.ofMinutes(cfg.holdMinutes())));
        if (caller != null) {
            users.findById(caller.id()).ifPresent(u -> {
                booking.setCustomerName(u.getFullName());
                booking.setCustomerEmail(u.getEmail());
                booking.setCustomerPhone(u.getPhone());
            });
        }
        bookings.saveAndFlush(booking); // flush: we need the generated id for the next statements

        List<Long> claimed = seatHolds.claim(showtimeId, seatIds, booking.getId(), booking.getHoldExpiresAt(), "HELD");
        if (claimed.size() != seatIds.size()) {
            Set<Long> got = new HashSet<>(claimed);
            List<Long> taken = seatIds.stream().filter(id -> !got.contains(id)).toList();
            // Throwing rolls back the whole transaction: the booking row and any seats we did claim vanish.
            throw new ApiException(HttpStatus.CONFLICT, "SEATS_UNAVAILABLE",
                    taken.size() == 1 ? "Sorry, that seat was just taken" : "Sorry, some of those seats were just taken",
                    Map.of("seatIds", taken));
        }

        queries.insertItems(booking.getId(), seats);
        long subtotal = seats.stream().mapToLong(SeatPrice::priceMinor).sum();
        applyPricing(booking, subtotal, 0, seats.size(), cfg);
        seatHolds.notifySeatsChanged(showtimeId);
        return booking;
    }

    // ------------------------------------------------------------------ checkout edits

    @Transactional
    public Booking updateCustomer(String reference, String name, String email, String phone, BookingAccess.Check access) {
        Booking booking = lockOpen(reference, access);
        booking.setCustomerName(name.trim());
        booking.setCustomerEmail(email.trim());
        booking.setCustomerPhone(phone == null || phone.isBlank() ? null : phone.trim());
        return booking;
    }

    @Transactional
    public Booking applyCoupon(String reference, String code, BookingAccess.Check access) {
        Booking booking = lockOpen(reference, access);
        if (booking.getStatus() != Booking.Status.HELD) {
            throw ApiException.unprocessable("BOOKING_STATE", "Coupons can't be changed while a payment is in progress");
        }
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        var applied = coupons.reserve(booking, code, booking.getSubtotalMinor(), show.movieId(), show.cinemaId());
        booking.setCouponId(applied.coupon().getId());
        applyPricing(booking, booking.getSubtotalMinor(), applied.discountMinor(), queries.itemSeatIds(booking.getId()).size(),
                settings.booking());
        return booking;
    }

    @Transactional
    public Booking removeCoupon(String reference, BookingAccess.Check access) {
        Booking booking = lockOpen(reference, access);
        if (booking.getStatus() != Booking.Status.HELD) {
            throw ApiException.unprocessable("BOOKING_STATE", "Coupons can't be changed while a payment is in progress");
        }
        coupons.remove(booking.getId());
        booking.setCouponId(null);
        applyPricing(booking, booking.getSubtotalMinor(), 0, queries.itemSeatIds(booking.getId()).size(), settings.booking());
        return booking;
    }

    @Transactional
    public void release(String reference, BookingAccess.Check access) {
        Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        if (booking.getStatus() == Booking.Status.PAYMENT_PENDING) {
            throw ApiException.unprocessable("BOOKING_STATE", "A payment is in progress. Check its status before cancelling.");
        }
        if (booking.getStatus() == Booking.Status.HELD) {
            expireInternal(booking, "Released by customer");
        }
    }

    // ------------------------------------------------------------------ payment hooks (called by PaymentService)

    /**
     * Moves a HELD booking to PAYMENT_PENDING and extends the hold for the payment window.
     * Called inside PaymentService's transaction with the booking already locked.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void beginPayment(Booking booking) {
        BookingSettings cfg = settings.booking();
        Instant now = Instant.now();
        if (!booking.isOpen()) {
            throw ApiException.unprocessable("BOOKING_STATE", "This booking can no longer be paid");
        }
        if (!booking.getHoldExpiresAt().isAfter(now)) {
            throw ApiException.conflict("HOLD_EXPIRED", "Your seat hold has expired. Please choose your seats again.");
        }
        if (isBlank(booking.getCustomerName()) || isBlank(booking.getCustomerEmail())) {
            throw ApiException.unprocessable("CUSTOMER_DETAILS_REQUIRED", "Please enter your name and email first");
        }
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        if (!salesOpen(show, cfg, now)) {
            throw ApiException.unprocessable("SALES_CLOSED", "Online sales for this show have closed");
        }
        coupons.revalidate(booking, show.movieId(), show.cinemaId());

        Instant extended = now.plus(Duration.ofMinutes(cfg.paymentWindowMinutes()));
        if (extended.isAfter(booking.getHoldExpiresAt())) {
            booking.setHoldExpiresAt(extended);
        }
        int seats = queries.itemSeatIds(booking.getId()).size();
        if (seatHolds.extendHolds(booking.getId(), booking.getHoldExpiresAt()) != seats) {
            throw ApiException.conflict("HOLD_EXPIRED", "Your seat hold has expired. Please choose your seats again.");
        }
        booking.setStatus(Booking.Status.PAYMENT_PENDING);
    }

    /** A payment attempt failed or was cancelled: let the customer try again while the hold lasts. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void paymentAttemptEnded(Booking booking) {
        if (booking.getStatus() != Booking.Status.PAYMENT_PENDING) {
            return;
        }
        boolean otherOpen = payments.findByBookingIdOrderByCreatedAtDesc(booking.getId()).stream()
                .anyMatch(p -> p.getStatus().isOpen());
        if (otherOpen) {
            return;
        }
        if (booking.getHoldExpiresAt().isAfter(Instant.now())) {
            booking.setStatus(Booking.Status.HELD);
        } else {
            expireInternal(booking, "Payment was not completed in time");
        }
    }

    /**
     * The gateway confirmed money arrived. Confirms the booking, or, if that is impossible
     * (seats lost after a late payment, show cancelled, already paid), records a full refund.
     * Caller holds locks on both the payment and the booking.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmPaid(Booking booking, Payment payment) {
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        String problem = null;

        if (booking.getStatus() == Booking.Status.CONFIRMED) {
            problem = "Duplicate payment for an already confirmed booking";
        } else if (booking.getStatus() == Booking.Status.CANCELLED) {
            problem = "Payment arrived after the booking was cancelled";
        } else if (!"SCHEDULED".equals(show.status())) {
            problem = "Payment arrived after the show was cancelled";
        } else if (!show.startsAt().isAfter(Instant.now())) {
            problem = "Payment arrived after the show started";
        }

        if (problem == null) {
            List<Long> expected = queries.itemSeatIds(booking.getId());
            List<Long> booked = new ArrayList<>(seatHolds.markBooked(booking.getId()));
            if (booked.size() < expected.size()) {
                // Our hold expired and the sweeper (or a stolen seat) removed some rows.
                // Try to re-take the missing seats as sold, if nobody else holds them now.
                List<Long> missing = expected.stream().filter(id -> !booked.contains(id)).toList();
                booked.addAll(seatHolds.claim(booking.getShowtimeId(), missing, booking.getId(), null, "BOOKED"));
            }
            if (booked.size() < expected.size()) {
                problem = "Seats were released before the payment completed and are no longer available";
            }
        }

        if (problem != null) {
            log.warn("Booking {} paid but cannot be confirmed: {}", booking.getReference(), problem);
            boolean wasConfirmed = booking.getStatus() == Booking.Status.CONFIRMED;
            if (!wasConfirmed && booking.getStatus() != Booking.Status.CANCELLED) {
                seatHolds.releaseAll(booking.getId());
                booking.setStatus(Booking.Status.CANCELLED);
                booking.setCancelledAt(Instant.now());
                booking.setCancellationReason(problem);
                coupons.release(booking.getId());
            }
            refunds.create(booking.getId(), payment, payment.getAmountMinor(), problem);
            audit.record("payment.refund_required", "booking", booking.getReference(),
                    Map.of("paymentId", payment.getId(), "reason", problem));
            if (!wasConfirmed) {
                notifications.enqueue("BOOKING_CANCELLED", booking.getCustomerEmail(),
                        templates.bookingCancelled(info(booking, show), payment.getAmountMinor(), problem), booking.getId());
            }
            seatHolds.notifySeatsChanged(booking.getShowtimeId());
            return;
        }

        String accessToken = Tokens.urlToken();
        booking.setStatus(Booking.Status.CONFIRMED);
        booking.setConfirmedAt(Instant.now());
        booking.setTicketCode(tickets.newTicketCode());
        booking.setAccessTokenHash(Tokens.sha256Hex(accessToken));
        coupons.redeem(booking.getId());
        // Totals must be flushed to the row before billing reads them back with SQL.
        bookings.flush();
        billing.issueInvoice(booking.getId(), payment.getId());
        audit.record("booking.confirmed", "booking", booking.getReference(),
                Map.of("paymentId", payment.getId(), "totalMinor", booking.getTotalMinor()));
        var bookingInfo = info(booking, show, accessToken);
        notifications.enqueue("BOOKING_CONFIRMED", booking.getCustomerEmail(), templates.bookingConfirmed(bookingInfo), booking.getId());
        seatHolds.notifySeatsChanged(booking.getShowtimeId());
    }

    /** A booking whose total is zero (100% coupon) needs no gateway. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void confirmFree(Booking booking) {
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        List<Long> expected = queries.itemSeatIds(booking.getId());
        if (seatHolds.markBooked(booking.getId()).size() != expected.size()) {
            throw ApiException.conflict("HOLD_EXPIRED", "Your seat hold has expired. Please choose your seats again.");
        }
        String accessToken = Tokens.urlToken();
        booking.setStatus(Booking.Status.CONFIRMED);
        booking.setConfirmedAt(Instant.now());
        booking.setTicketCode(tickets.newTicketCode());
        booking.setAccessTokenHash(Tokens.sha256Hex(accessToken));
        coupons.redeem(booking.getId());
        bookings.flush();
        billing.issueInvoice(booking.getId(), null);
        audit.record("booking.confirmed", "booking", booking.getReference(), Map.of("totalMinor", 0));
        notifications.enqueue("BOOKING_CONFIRMED", booking.getCustomerEmail(),
                templates.bookingConfirmed(info(booking, show, accessToken)), booking.getId());
        seatHolds.notifySeatsChanged(booking.getShowtimeId());
    }

    // ------------------------------------------------------------------ expiry

    /** Expires one booking if it is still open and past its hold. Used by HoldExpiryJob. */
    @Transactional
    public boolean expireIfDue(Long bookingId, Duration paymentGrace) {
        Booking booking = bookings.lockById(bookingId).orElse(null);
        if (booking == null || !booking.isOpen()) {
            return false;
        }
        Instant cutoff = booking.getStatus() == Booking.Status.PAYMENT_PENDING
                ? booking.getHoldExpiresAt().plus(paymentGrace)
                : booking.getHoldExpiresAt();
        if (cutoff.isAfter(Instant.now())) {
            return false;
        }
        expireInternal(booking, booking.getStatus() == Booking.Status.PAYMENT_PENDING
                ? "Payment was not completed in time" : "Seat hold expired");
        return true;
    }

    private void expireInternal(Booking booking, String reason) {
        booking.setStatus(Booking.Status.EXPIRED);
        booking.setCancellationReason(reason);
        seatHolds.releaseHolds(booking.getId());
        coupons.release(booking.getId());
        seatHolds.notifySeatsChanged(booking.getShowtimeId());
    }

    // ------------------------------------------------------------------ cancellation

    public record CancelQuote(boolean allowed, long refundMinor, String reason) {}

    /** What a customer cancellation would do right now. Pure read, used for display too. */
    public CancelQuote quoteCustomerCancel(Booking booking, Instant startsAt) {
        BookingSettings cfg = settings.booking();
        if (booking.getStatus() != Booking.Status.CONFIRMED) {
            return new CancelQuote(false, 0, "Only confirmed bookings can be cancelled");
        }
        if (booking.getCheckedInAt() != null) {
            return new CancelQuote(false, 0, "This ticket has already been used");
        }
        if (!startsAt.minus(Duration.ofHours(cfg.cancellationCutoffHours())).isAfter(Instant.now())) {
            return new CancelQuote(false, 0, "Cancellations close " + cfg.cancellationCutoffHours() + " hours before the show");
        }
        return new CancelQuote(true, PricingCalculator.refund(booking.getTotalMinor(), cfg.refundPercent()), null);
    }

    @Transactional
    public Booking cancelByCustomer(String reference, String reason, BookingAccess.Check access) {
        Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        CancelQuote quote = quoteCustomerCancel(booking, show.startsAt());
        if (!quote.allowed()) {
            throw ApiException.unprocessable("BOOKING_STATE", quote.reason());
        }
        cancelConfirmed(booking, show, quote.refundMinor(), isBlank(reason) ? "Cancelled by customer" : reason.trim());
        return booking;
    }

    /** Staff cancellation: no time limit, refund percentage chosen by staff. */
    @Transactional
    public Booking cancelByStaff(String reference, String reason, int refundPercent, BookingAccess.Check access) {
        Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        if (booking.isOpen()) {
            expireInternal(booking, reason);
            booking.setStatus(Booking.Status.CANCELLED);
            booking.setCancelledAt(Instant.now());
            audit.record("booking.cancelled", "booking", reference, Map.of("reason", reason, "byStaff", true));
            return booking;
        }
        if (booking.getStatus() != Booking.Status.CONFIRMED) {
            throw ApiException.unprocessable("BOOKING_STATE", "This booking is already " + booking.getStatus().name().toLowerCase());
        }
        long refund = PricingCalculator.refund(booking.getTotalMinor(), Math.max(0, Math.min(100, refundPercent)));
        cancelConfirmed(booking, show, refund, reason);
        return booking;
    }

    private void cancelConfirmed(Booking booking, ShowContext show, long refundMinor, String reason) {
        booking.setStatus(Booking.Status.CANCELLED);
        booking.setCancelledAt(Instant.now());
        booking.setCancellationReason(reason);
        seatHolds.releaseAll(booking.getId());
        coupons.release(booking.getId());
        payments.findByBookingIdOrderByCreatedAtDesc(booking.getId()).stream()
                .filter(p -> p.getStatus() == Payment.Status.SUCCEEDED)
                .findFirst()
                .ifPresent(p -> refunds.create(booking.getId(), p, refundMinor, reason));
        audit.record("booking.cancelled", "booking", booking.getReference(), Map.of("reason", reason, "refundMinor", refundMinor));
        notifications.enqueue("BOOKING_CANCELLED", booking.getCustomerEmail(),
                templates.bookingCancelled(info(booking, show), refundMinor, reason), booking.getId());
        seatHolds.notifySeatsChanged(booking.getShowtimeId());
    }

    // ------------------------------------------------------------------ misc

    @Transactional
    public void resendConfirmation(String reference, BookingAccess.Check access) {
        Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        if (booking.getStatus() != Booking.Status.CONFIRMED) {
            throw ApiException.unprocessable("BOOKING_STATE", "Only confirmed bookings have tickets to send");
        }
        ShowContext show = queries.show(booking.getShowtimeId()).orElseThrow(BookingQueries::showNotFound);
        // A fresh access link each time; the old one stops working.
        String accessToken = Tokens.urlToken();
        booking.setAccessTokenHash(Tokens.sha256Hex(accessToken));
        notifications.enqueue("BOOKING_CONFIRMED", booking.getCustomerEmail(),
                templates.bookingConfirmed(info(booking, show, accessToken)), booking.getId());
    }

    public boolean salesOpen(ShowContext show, BookingSettings cfg, Instant now) {
        return "SCHEDULED".equals(show.status()) && show.salesOpen()
                && show.startsAt().minus(Duration.ofMinutes(cfg.salesCloseMinutes())).isAfter(now);
    }

    private Booking lockOpen(String reference, BookingAccess.Check access) {
        Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        if (!booking.isOpen()) {
            throw ApiException.unprocessable("BOOKING_STATE", "This booking can no longer be changed");
        }
        if (!booking.getHoldExpiresAt().isAfter(Instant.now())) {
            throw ApiException.conflict("HOLD_EXPIRED", "Your seat hold has expired. Please choose your seats again.");
        }
        return booking;
    }

    private void applyPricing(Booking booking, long subtotal, long discount, int tickets, BookingSettings cfg) {
        var p = PricingCalculator.calculate(subtotal, discount, tickets, cfg.serviceFeeMinor(), cfg.taxRateBasisPoints());
        booking.setSubtotalMinor(p.subtotalMinor());
        booking.setDiscountMinor(p.discountMinor());
        booking.setFeeMinor(p.feeMinor());
        booking.setTaxMinor(p.taxMinor());
        booking.setTotalMinor(p.totalMinor());
    }

    private EmailTemplates.BookingInfo info(Booking b, ShowContext show) {
        return info(b, show, null);
    }

    private EmailTemplates.BookingInfo info(Booking b, ShowContext show, String accessToken) {
        String link = accessToken == null
                ? props.frontendUrl() + "/bookings/" + b.getReference()
                : props.frontendUrl() + "/bookings/find?ref=" + b.getReference() + "&token=" + accessToken;
        return new EmailTemplates.BookingInfo(b.getReference(), b.getCustomerName() == null ? "there" : b.getCustomerName(),
                show.movieTitle(), show.cinemaName(), show.cinemaAddress(), show.auditoriumName(), show.startsAt(),
                show.timezone(), show.format(), queries.seatLabels(b.getId()), b.getTotalMinor(), b.getTicketCode(), link);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    static Collection<Long> none() {
        return List.of();
    }

    static boolean isStaff(User.Role role) {
        return role == User.Role.ADMIN || role == User.Role.CINEMA_MANAGER;
    }
}
