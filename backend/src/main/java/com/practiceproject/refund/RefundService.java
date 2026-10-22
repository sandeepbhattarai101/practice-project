package com.practiceproject.refund;

import com.practiceproject.audit.AuditService;
import com.practiceproject.billing.BillingService;
import com.practiceproject.common.ApiException;
import com.practiceproject.payment.Payment;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Refund records. eSewa's and Khalti's standard merchant integrations do not expose a
 * self-service refund API for this flow, so a refund is RECORDED here as PENDING and finance
 * pays it out through the gateway's merchant portal, then marks it PROCESSED with the
 * gateway reference. Simulator payments are refunded instantly because no money moved.
 */
@Service
public class RefundService {

    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final BillingService billing;

    public RefundService(JdbcTemplate jdbc, AuditService audit, BillingService billing) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.billing = billing;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void create(Long bookingId, Payment payment, long amountMinor, String reason) {
        boolean simulated = payment.getProvider() == Payment.Provider.DEV_SANDBOX;
        // ON CONFLICT DO NOTHING + the UNIQUE(payment_id) constraint: asking twice can never create two refunds.
        List<Long> ids = jdbc.queryForList("""
                insert into refunds (booking_id, payment_id, amount_minor, status, reason, provider_ref, notes, processed_at)
                values (?, ?, ?, ?, ?, ?, ?, case when ? then now() end)
                on conflict (payment_id) do nothing
                returning id
                """, Long.class, bookingId, payment.getId(), amountMinor,
                simulated || amountMinor == 0 ? "PROCESSED" : "PENDING", reason,
                simulated ? "SIMULATED" : null, simulated ? "Simulator payment: no real money to return" : null,
                simulated || amountMinor == 0);
        if (ids.isEmpty()) {
            return;
        }
        billing.issueCreditNote(ids.getFirst(), bookingId, amountMinor, reason);
        audit.record("refund.created", "booking", bookingId, Map.of("paymentId", payment.getId(), "amountMinor", amountMinor,
                "reason", reason));
    }

    @Transactional
    public void process(Long refundId, String providerRef, String notes, Long actorId) {
        int n = jdbc.update("""
                update refunds set status = 'PROCESSED', provider_ref = ?, notes = ?, processed_by = ?, processed_at = now()
                where id = ? and status = 'PENDING'
                """, providerRef, notes, actorId, refundId);
        if (n == 0) {
            throw ApiException.conflict("REFUND_STATE", "Only pending refunds can be processed");
        }
        audit.record("refund.processed", "refund", refundId, Map.of("providerRef", providerRef == null ? "" : providerRef));
    }

    @Transactional
    public void reject(Long refundId, String notes, Long actorId) {
        int n = jdbc.update("""
                update refunds set status = 'REJECTED', notes = ?, processed_by = ?, processed_at = now()
                where id = ? and status = 'PENDING'
                """, notes, actorId, refundId);
        if (n == 0) {
            throw ApiException.conflict("REFUND_STATE", "Only pending refunds can be rejected");
        }
        audit.record("refund.rejected", "refund", refundId, Map.of("notes", notes == null ? "" : notes));
    }

    public Optional<Map<String, Object>> forBooking(Long bookingId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select amount_minor, status, created_at, processed_at from refunds where booking_id = ? order by created_at desc limit 1",
                bookingId);
        return rows.stream().findFirst();
    }
}
