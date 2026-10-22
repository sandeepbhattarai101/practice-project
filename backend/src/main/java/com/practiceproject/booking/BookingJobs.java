package com.practiceproject.booking;

import com.practiceproject.payment.Payment;
import com.practiceproject.payment.PaymentRepository;
import com.practiceproject.payment.PaymentService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Background work that keeps bookings honest when customers walk away:
 * <ul>
 *   <li>expire holds that ran out (seats go back on sale);</li>
 *   <li>reconcile payments whose browser never came back (closed tab, lost signal).</li>
 * </ul>
 * Each booking is handled in its own short transaction, so one bad row cannot block the rest.
 */
@Component
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true")
public class BookingJobs {

    private static final Logger log = LoggerFactory.getLogger(BookingJobs.class);
    /** Extra time for PAYMENT_PENDING bookings: the gateway may still be redirecting the customer back. */
    static final Duration PAYMENT_GRACE = Duration.ofMinutes(3);

    private final JdbcTemplate jdbc;
    private final BookingService bookings;
    private final PaymentRepository payments;
    private final PaymentService paymentService;

    public BookingJobs(JdbcTemplate jdbc, BookingService bookings, PaymentRepository payments, PaymentService paymentService) {
        this.jdbc = jdbc;
        this.bookings = bookings;
        this.payments = payments;
        this.paymentService = paymentService;
    }

    @Scheduled(fixedDelay = 15_000, initialDelay = 10_000)
    public void expireHolds() {
        // Served by the partial index ix_bookings_hold_expiry.
        List<Long> due = jdbc.queryForList("""
                select id from bookings
                where status in ('HELD', 'PAYMENT_PENDING') and hold_expires_at < now()
                order by hold_expires_at
                limit 200
                """, Long.class);
        for (Long id : due) {
            try {
                // A PAYMENT_PENDING booking gets one last check with the gateway before expiring.
                for (Payment p : payments.findByBookingIdOrderByCreatedAtDesc(id)) {
                    if (p.getStatus().isOpen()) {
                        paymentService.reconcile(p.getId(), "expiry-job");
                    }
                }
                if (bookings.expireIfDue(id, PAYMENT_GRACE)) {
                    log.debug("Expired booking {}", id);
                }
            } catch (RuntimeException e) {
                log.warn("Could not expire booking {}: {}", id, e.getMessage());
            }
        }
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    public void reconcilePayments() {
        Instant now = Instant.now();
        var due = payments.findDueForReconciliation(now.minus(Duration.ofMinutes(2)), now.minus(Duration.ofMinutes(2)),
                PageRequest.of(0, 25));
        for (Payment p : due) {
            try {
                paymentService.reconcile(p.getId(), "reconciliation-job");
            } catch (RuntimeException e) {
                log.warn("Reconciliation failed for payment {}: {}", p.getId(), e.getMessage());
            }
        }
    }
}
