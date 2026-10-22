package com.practiceproject.payment;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    Optional<Payment> findByIdempotencyKey(String key);

    Optional<Payment> findByMerchantTxnId(String merchantTxnId);

    Optional<Payment> findByProviderAndProviderTxnId(Payment.Provider provider, String providerTxnId);

    List<Payment> findByBookingIdOrderByCreatedAtDesc(Long bookingId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.id = :id")
    Optional<Payment> lockById(Long id);

    /** Open payments that have not been asked about recently: the reconciliation job's work list. */
    @Query("""
            select p from Payment p
            where p.status in (com.practiceproject.payment.Payment.Status.INITIATED, com.practiceproject.payment.Payment.Status.PENDING)
              and p.createdAt < :createdBefore
              and (p.lastCheckedAt is null or p.lastCheckedAt < :checkedBefore)
            order by p.createdAt
            """)
    List<Payment> findDueForReconciliation(Instant createdBefore, Instant checkedBefore, Pageable page);
}
