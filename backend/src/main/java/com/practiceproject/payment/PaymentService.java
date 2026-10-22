package com.practiceproject.payment;

import com.practiceproject.booking.Booking;
import com.practiceproject.booking.BookingAccess;
import com.practiceproject.booking.BookingRepository;
import com.practiceproject.booking.BookingService;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Json;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import com.practiceproject.payment.PaymentProvider.Outcome;
import com.practiceproject.payment.PaymentProvider.Redirect;
import com.practiceproject.payment.PaymentProvider.StartContext;
import com.practiceproject.payment.PaymentProvider.Verification;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Payment life cycle. Transactions are opened explicitly with TransactionTemplate because a
 * payment spans network calls to the gateway, and a rule of thumb for databases is:
 * NEVER hold row locks while waiting on the network. So each method is
 * short-transaction / network call / short-transaction.
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
    /** After this long without a definitive answer, an attempt is treated as abandoned. */
    static final Duration ABANDON_AFTER = Duration.ofMinutes(45);

    public record StartResponse(Long paymentId, Payment.Provider provider, Redirect redirect) {}

    private final PaymentRepository payments;
    private final BookingRepository bookings;
    private final BookingService bookingService;
    private final PaymentProviders providers;
    private final TransactionTemplate tx;
    private final JdbcTemplate jdbc;
    private final Json json;
    private final AppProperties props;

    public PaymentService(PaymentRepository payments, BookingRepository bookings, BookingService bookingService,
                          PaymentProviders providers, TransactionTemplate tx, JdbcTemplate jdbc, Json json, AppProperties props) {
        this.payments = payments;
        this.bookings = bookings;
        this.bookingService = bookingService;
        this.providers = providers;
        this.tx = tx;
        this.jdbc = jdbc;
        this.json = json;
        this.props = props;
    }

    // ------------------------------------------------------------------ start

    public StartResponse start(String reference, Payment.Provider code, String idempotencyKey, BookingAccess.Check access) {
        if (idempotencyKey == null || !idempotencyKey.matches("[A-Za-z0-9-]{16,80}")) {
            throw ApiException.badRequest("A valid Idempotency-Key header is required");
        }
        PaymentProvider provider = providers.requireEnabled(code);

        // Replay: the same key means "the same click". Return what we returned the first time.
        var replay = payments.findByIdempotencyKey(idempotencyKey);
        if (replay.isPresent()) {
            return replayed(replay.get(), reference, access);
        }

        // Transaction 1: validate, lock, create the payment row. Commits before we talk to the gateway.
        record Created(Payment payment, StartContext context, boolean free) {}
        Created created = tx.execute(status -> {
            Booking booking = bookings.lockByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
            access.require(booking);
            if (booking.getStatus() == Booking.Status.CONFIRMED) {
                throw ApiException.unprocessable("BOOKING_STATE", "This booking is already paid");
            }
            bookingService.beginPayment(booking);
            if (booking.getTotalMinor() == 0) {
                bookingService.confirmFree(booking);
                return new Created(null, null, true);
            }
            var payment = new Payment();
            payment.setBookingId(booking.getId());
            payment.setProvider(code);
            payment.setStatus(Payment.Status.INITIATED);
            payment.setAmountMinor(booking.getTotalMinor());
            payment.setCurrency(booking.getCurrency());
            payment.setMerchantTxnId(booking.getReference() + "-" + Tokens.readableCode(6));
            payment.setIdempotencyKey(idempotencyKey);
            payments.saveAndFlush(payment);
            event(payment.getId(), "INITIATED", Map.of("amountMinor", payment.getAmountMinor()));
            return new Created(payment, context(booking), false);
        });

        if (created.free()) {
            String url = props.frontendUrl() + "/bookings/" + reference + "?payment=success";
            return new StartResponse(null, code, new Redirect("GET", url, Map.of()));
        }

        // Network call, outside any transaction.
        PaymentProvider.StartResult result;
        try {
            result = provider.start(created.payment(), created.context());
        } catch (PaymentProvider.ProviderException e) {
            log.warn("Could not start {} payment {}: {}", code, created.payment().getId(), e.getMessage());
            tx.executeWithoutResult(s -> markFailedToStart(created.payment().getId(), e.getMessage()));
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_UNAVAILABLE",
                    provider.displayName() + " could not be reached. Please try again or choose another method.");
        }

        // Transaction 2: record what the gateway gave us.
        tx.executeWithoutResult(s -> {
            Payment payment = payments.lockById(created.payment().getId()).orElseThrow();
            payment.setStatus(Payment.Status.PENDING);
            if (result.providerTxnId() != null) {
                payment.setProviderTxnId(result.providerTxnId());
            }
            event(payment.getId(), "REDIRECT_ISSUED", result.eventPayload());
        });
        return new StartResponse(created.payment().getId(), code, result.redirect());
    }

    private StartResponse replayed(Payment payment, String reference, BookingAccess.Check access) {
        Booking booking = bookings.findById(payment.getBookingId()).orElseThrow();
        access.require(booking);
        if (!booking.getReference().equals(reference)) {
            throw ApiException.unprocessable("IDEMPOTENCY_KEY_REUSED", "This payment key belongs to another booking");
        }
        if (!payment.getStatus().isOpen()) {
            throw ApiException.conflict("PAYMENT_FINISHED", "That payment attempt has already finished. Start a new one.");
        }
        Map<String, Object> initiated = lastEventPayload(payment.getId(), "REDIRECT_ISSUED");
        Redirect redirect = providers.get(payment.getProvider()).resume(payment, context(booking), initiated);
        return new StartResponse(payment.getId(), payment.getProvider(), redirect);
    }

    private void markFailedToStart(Long paymentId, String reason) {
        Payment payment = payments.lockById(paymentId).orElseThrow();
        payment.setStatus(Payment.Status.FAILED);
        payment.setFailureReason("Could not start: " + truncate(reason));
        event(paymentId, "START_FAILED", Map.of("reason", truncate(reason)));
        Booking booking = bookings.lockById(payment.getBookingId()).orElseThrow();
        payments.flush();
        bookingService.paymentAttemptEnded(booking);
    }

    // ------------------------------------------------------------------ verify

    /** Ask the gateway about one payment and apply the answer. Safe to call any number of times. */
    public Payment.Status reconcile(Long paymentId, String trigger) {
        Payment payment = payments.findById(paymentId).orElseThrow(() -> ApiException.notFound("Payment"));
        if (payment.getStatus() == Payment.Status.SUCCEEDED) {
            return payment.getStatus();
        }
        Verification v;
        try {
            v = providers.get(payment.getProvider()).check(payment);
        } catch (PaymentProvider.ProviderException e) {
            log.warn("Status check failed for payment {}: {}", paymentId, e.getMessage());
            tx.executeWithoutResult(s -> {
                Payment p = payments.lockById(paymentId).orElseThrow();
                p.setLastCheckedAt(Instant.now());
                p.setCheckAttempts(p.getCheckAttempts() + 1);
                event(paymentId, "CHECK_ERROR", Map.of("trigger", trigger, "error", truncate(e.getMessage())));
            });
            return payment.getStatus();
        }
        return apply(paymentId, v, trigger);
    }

    /** Re-check every open payment of a booking (the customer's "check again" button). */
    public void reconcileBooking(String reference, BookingAccess.Check access) {
        Booking booking = bookings.findByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.require(booking);
        for (Payment p : payments.findByBookingIdOrderByCreatedAtDesc(booking.getId())) {
            if (p.getStatus().isOpen()) {
                reconcile(p.getId(), "customer");
            }
        }
    }

    /**
     * The single place where a gateway's answer changes our state. Locks payment then booking
     * (always in that order, everywhere, so two paths can never deadlock each other).
     */
    Payment.Status apply(Long paymentId, Verification v, String trigger) {
        return tx.execute(status -> {
            Payment payment = payments.lockById(paymentId).orElseThrow();
            event(paymentId, "STATUS_" + v.outcome(), Map.of("trigger", trigger, "message", String.valueOf(v.message()),
                    "gateway", v.raw() == null ? Map.of() : v.raw()));
            payment.setLastCheckedAt(Instant.now());
            payment.setCheckAttempts(payment.getCheckAttempts() + 1);
            if (payment.getStatus() == Payment.Status.SUCCEEDED) {
                return payment.getStatus(); // already done; duplicate callback
            }
            Booking booking = bookings.lockById(payment.getBookingId()).orElseThrow();

            switch (v.outcome()) {
                case SUCCEEDED -> {
                    if (v.amountMinor() != null && v.amountMinor() != payment.getAmountMinor()) {
                        // Someone tampered with the amount, or a gateway bug. Never confirm.
                        log.error("Amount mismatch on payment {}: expected {}, gateway says {}", paymentId,
                                payment.getAmountMinor(), v.amountMinor());
                        payment.setStatus(Payment.Status.FAILED);
                        payment.setFailureReason("Amount mismatch: manual review required");
                        payments.flush();
                        bookingService.paymentAttemptEnded(booking);
                        return payment.getStatus();
                    }
                    boolean alreadyPaid = payments.findByBookingIdOrderByCreatedAtDesc(booking.getId()).stream()
                            .anyMatch(p -> !p.getId().equals(paymentId) && p.getStatus() == Payment.Status.SUCCEEDED);
                    if (v.providerTxnId() != null) {
                        payment.setProviderTxnId(v.providerTxnId());
                    }
                    payment.setCompletedAt(Instant.now());
                    if (alreadyPaid) {
                        // ux_payments_one_success allows one SUCCEEDED per booking; this money goes back.
                        payment.setStatus(Payment.Status.CANCELLED);
                        payment.setFailureReason("DUPLICATE_PAYMENT: refunded");
                        payments.flush();
                        bookingService.confirmPaid(booking, payment);
                    } else {
                        payment.setStatus(Payment.Status.SUCCEEDED);
                        payments.flush();
                        bookingService.confirmPaid(booking, payment);
                    }
                }
                case FAILED, CANCELLED -> {
                    if (payment.getStatus().isOpen()) {
                        payment.setStatus(v.outcome() == Outcome.FAILED ? Payment.Status.FAILED : Payment.Status.CANCELLED);
                        payment.setFailureReason(v.message());
                        payment.setCompletedAt(Instant.now());
                        payments.flush();
                        bookingService.paymentAttemptEnded(booking);
                    }
                }
                case PENDING, NOT_FOUND -> {
                    if (payment.getStatus().isOpen() && payment.getCreatedAt().plus(ABANDON_AFTER).isBefore(Instant.now())) {
                        payment.setStatus(Payment.Status.EXPIRED);
                        payment.setFailureReason("No confirmation from the gateway");
                        payments.flush();
                        bookingService.paymentAttemptEnded(booking);
                    }
                }
            }
            return payment.getStatus();
        });
    }

    /** Where to send the browser after a gateway callback. The page then fetches the real status. */
    public String returnUrl(Long paymentId, Payment.Status status) {
        Payment payment = payments.findById(paymentId).orElseThrow(() -> ApiException.notFound("Payment"));
        Booking booking = bookings.findById(payment.getBookingId()).orElseThrow();
        String result = switch (status) {
            case SUCCEEDED -> "success";
            case FAILED -> "failed";
            case CANCELLED, EXPIRED -> "cancelled";
            default -> "pending";
        };
        return props.frontendUrl() + "/bookings/" + booking.getReference() + "?payment=" + result;
    }

    public void event(Long paymentId, String type, Map<String, ?> payload) {
        jdbc.update("insert into payment_events (payment_id, event_type, payload) values (?, ?, ?::jsonb)",
                paymentId, type, json.write(payload == null ? Map.of() : payload));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> lastEventPayload(Long paymentId, String type) {
        List<String> rows = jdbc.queryForList(
                "select payload::text from payment_events where payment_id = ? and event_type = ? order by id desc limit 1",
                String.class, paymentId, type);
        return rows.isEmpty() ? Map.of() : json.read(rows.getFirst(), Map.class);
    }

    private StartContext context(Booking booking) {
        String title = jdbc.queryForObject(
                "select m.title from showtimes s join movies m on m.id = s.movie_id where s.id = ?", String.class,
                booking.getShowtimeId());
        return new StartContext(booking.getReference(), "Tickets: " + title + " (" + booking.getReference() + ")",
                booking.getCustomerName(), booking.getCustomerEmail(), booking.getCustomerPhone());
    }

    private static String truncate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() > 300 ? s.substring(0, 300) : s;
    }
}
