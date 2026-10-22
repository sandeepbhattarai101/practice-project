package com.practiceproject.coupon;

import com.practiceproject.booking.Booking;
import com.practiceproject.common.ApiException;
import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Coupon rules. Usage is counted from coupon_redemptions rows, and a booking "reserves"
 * its use the moment the code is applied (released again if the hold expires).
 */
@Service
public class CouponService {

    public record Applied(Coupon coupon, long discountMinor) {}

    private final CouponRepository coupons;
    private final JdbcTemplate jdbc;

    public CouponService(CouponRepository coupons, JdbcTemplate jdbc) {
        this.coupons = coupons;
        this.jdbc = jdbc;
    }

    /** Validates the code for this booking and reserves one use. Caller holds the booking lock. */
    @Transactional(propagation = Propagation.MANDATORY)
    public Applied reserve(Booking booking, String code, long subtotalMinor, Long movieId, Long cinemaId) {
        Coupon coupon = coupons.lockByCode(code.trim()).orElseThrow(() -> invalid("This code isn't valid"));
        validate(coupon, booking, subtotalMinor, movieId, cinemaId);
        long discount = coupon.discountFor(subtotalMinor);
        jdbc.update("delete from coupon_redemptions where booking_id = ?", booking.getId());
        jdbc.update("""
                insert into coupon_redemptions (coupon_id, booking_id, user_id, customer_email, status, discount_minor)
                values (?, ?, ?, ?, 'RESERVED', ?)
                """, coupon.getId(), booking.getId(), booking.getUserId(), booking.getCustomerEmail(), discount);
        return new Applied(coupon, discount);
    }

    /**
     * Re-checks an applied coupon just before payment, when the customer's email is known,
     * so the per-customer limit also applies to guests.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void revalidate(Booking booking, Long movieId, Long cinemaId) {
        if (booking.getCouponId() == null) {
            return;
        }
        Coupon coupon = coupons.lockById(booking.getCouponId()).orElseThrow(() -> invalid("This code is no longer valid"));
        validate(coupon, booking, booking.getSubtotalMinor(), movieId, cinemaId);
        jdbc.update("update coupon_redemptions set customer_email = ?, user_id = ? where booking_id = ?",
                booking.getCustomerEmail(), booking.getUserId(), booking.getId());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void release(Long bookingId) {
        jdbc.update("update coupon_redemptions set status = 'RELEASED' where booking_id = ? and status <> 'RELEASED'", bookingId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void remove(Long bookingId) {
        jdbc.update("delete from coupon_redemptions where booking_id = ?", bookingId);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void redeem(Long bookingId) {
        jdbc.update("update coupon_redemptions set status = 'REDEEMED' where booking_id = ?", bookingId);
    }

    public long usedCount(Long couponId) {
        Long n = jdbc.queryForObject("select count(*) from coupon_redemptions where coupon_id = ? and status <> 'RELEASED'",
                Long.class, couponId);
        return n == null ? 0 : n;
    }

    private void validate(Coupon coupon, Booking booking, long subtotalMinor, Long movieId, Long cinemaId) {
        Instant now = Instant.now();
        if (!coupon.isActive()) {
            throw invalid("This code isn't valid");
        }
        if (coupon.getValidFrom() != null && now.isBefore(coupon.getValidFrom())) {
            throw invalid("This code isn't active yet");
        }
        if (coupon.getValidUntil() != null && !now.isBefore(coupon.getValidUntil())) {
            throw invalid("This code has expired");
        }
        if (subtotalMinor < coupon.getMinSubtotalMinor()) {
            throw new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "COUPON_INVALID",
                    "This code needs a minimum spend", Map.of("minSubtotalMinor", coupon.getMinSubtotalMinor()));
        }
        if (coupon.getMovieId() != null && !coupon.getMovieId().equals(movieId)) {
            throw invalid("This code isn't valid for this movie");
        }
        if (coupon.getCinemaId() != null && !coupon.getCinemaId().equals(cinemaId)) {
            throw invalid("This code isn't valid at this cinema");
        }
        if (coupon.getUsageLimit() != null) {
            Long used = jdbc.queryForObject("""
                    select count(*) from coupon_redemptions
                    where coupon_id = ? and status <> 'RELEASED' and booking_id <> ?
                    """, Long.class, coupon.getId(), booking.getId());
            if (used != null && used >= coupon.getUsageLimit()) {
                throw invalid("This code has reached its usage limit");
            }
        }
        if (coupon.getPerUserLimit() != null && (booking.getUserId() != null || booking.getCustomerEmail() != null)) {
            Long mine = jdbc.queryForObject("""
                    select count(*) from coupon_redemptions
                    where coupon_id = ? and status <> 'RELEASED' and booking_id <> ?
                      and (user_id = ? or lower(customer_email) = lower(?))
                    """, Long.class, coupon.getId(), booking.getId(), booking.getUserId(), booking.getCustomerEmail());
            if (mine != null && mine >= coupon.getPerUserLimit()) {
                throw invalid("You have already used this code the maximum number of times");
            }
        }
    }

    private static ApiException invalid(String message) {
        return ApiException.unprocessable("COUPON_INVALID", message);
    }
}
