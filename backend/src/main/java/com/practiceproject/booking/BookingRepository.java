package com.practiceproject.booking;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface BookingRepository extends JpaRepository<Booking, Long> {

    Optional<Booking> findByReference(String reference);

    /**
     * {@code SELECT ... FOR UPDATE}: a pessimistic row lock held until the transaction ends.
     * Everything that changes a booking's state (pay, expire, cancel, apply coupon) goes
     * through this, so those operations queue up one at a time per booking instead of
     * interleaving, e.g. the expiry job and a payment confirmation can never both win.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Booking b where b.reference = :reference")
    Optional<Booking> lockByReference(String reference);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Booking b where b.id = :id")
    Optional<Booking> lockById(Long id);
}
