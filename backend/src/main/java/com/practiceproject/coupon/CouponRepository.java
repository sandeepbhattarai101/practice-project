package com.practiceproject.coupon;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface CouponRepository extends JpaRepository<Coupon, Long> {

    @Query("select c from Coupon c where upper(c.code) = upper(:code)")
    Optional<Coupon> findByCode(String code);

    /**
     * Locks the coupon row while we count its uses and add one more. Without the lock, two
     * customers could both count "9 of 10 used" and both succeed, giving 11 uses.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where upper(c.code) = upper(:code)")
    Optional<Coupon> lockByCode(String code);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where c.id = :id")
    Optional<Coupon> lockById(Long id);
}
