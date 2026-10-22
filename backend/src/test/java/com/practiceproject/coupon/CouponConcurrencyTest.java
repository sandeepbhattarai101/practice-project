package com.practiceproject.coupon;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.practiceproject.IntegrationTest;
import com.practiceproject.booking.Booking;
import com.practiceproject.booking.BookingService;
import com.practiceproject.common.ApiException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class CouponConcurrencyTest extends IntegrationTest {

    @Autowired BookingService bookings;

    @Test
    void lastRemainingUseCannotBeTakenTwice() throws Exception {
        jdbc.update("insert into coupons (code, discount_type, discount_value, usage_limit) values ('ONCE', 'FIXED', 5000, 1)");
        List<Booking> held = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            held.add(bookings.hold(fx.showtimeId(), List.of(fx.seatIds().get(i)), null, Set.of()));
        }
        var pool = Executors.newFixedThreadPool(held.size());
        var start = new CountDownLatch(1);
        List<Future<Boolean>> results = new ArrayList<>();
        for (Booking b : held) {
            results.add(pool.submit(() -> {
                start.await();
                try {
                    bookings.applyCoupon(b.getReference(), "once", booking -> { });
                    return true;
                } catch (ApiException e) {
                    return false;
                }
            }));
        }
        start.countDown();
        int applied = 0;
        for (Future<Boolean> r : results) {
            applied += r.get() ? 1 : 0;
        }
        pool.shutdown();
        // Without the coupon row lock, several of these would succeed.
        assertThat(applied).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from coupon_redemptions where status = 'RESERVED'", Integer.class)).isEqualTo(1);
    }

    @Test
    void rulesAreEnforced() {
        jdbc.update("insert into coupons (code, discount_type, discount_value, min_subtotal_minor) values ('BIG', 'FIXED', 5000, 500000)");
        jdbc.update("insert into coupons (code, discount_type, discount_value, valid_until) values ('OLD', 'PERCENT', 1000, now() - interval '1 day')");
        jdbc.update("insert into coupons (code, discount_type, discount_value, is_active) values ('OFF', 'PERCENT', 1000, false)");
        Booking b = bookings.hold(fx.showtimeId(), List.of(fx.seatIds().getFirst()), null, Set.of());
        assertThatThrownBy(() -> bookings.applyCoupon(b.getReference(), "BIG", x -> { })).hasMessageContaining("minimum spend");
        assertThatThrownBy(() -> bookings.applyCoupon(b.getReference(), "OLD", x -> { })).hasMessageContaining("expired");
        assertThatThrownBy(() -> bookings.applyCoupon(b.getReference(), "OFF", x -> { })).hasMessageContaining("isn't valid");
        assertThatThrownBy(() -> bookings.applyCoupon(b.getReference(), "NOPE", x -> { })).hasMessageContaining("isn't valid");
    }

    @Test
    void percentDiscountRespectsTheCap() {
        var c = new Coupon();
        c.setDiscountType(Coupon.DiscountType.PERCENT);
        c.setDiscountValue(5000); // 50%
        c.setMaxDiscountMinor(15000L);
        assertThat(c.discountFor(100000)).isEqualTo(15000);
        assertThat(c.discountFor(20000)).isEqualTo(10000);
    }
}
