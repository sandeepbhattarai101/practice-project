package com.practiceproject.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.practiceproject.IntegrationTest;
import com.practiceproject.common.ApiException;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The most important property of the system: one seat, one buyer. These tests fire real
 * concurrent transactions at Postgres; nothing is mocked.
 */
class SeatHoldConcurrencyTest extends IntegrationTest {

    @Autowired BookingService bookings;
    @Autowired BookingRepository repository;

    @Test
    void twentyBrowsersClickingTheSameSeatAtOnce_exactlyOneGetsIt() throws Exception {
        Long seat = fx.seatIds().get(2);
        int attempts = 20;
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger won = new AtomicInteger();
        AtomicInteger lost = new AtomicInteger();
        List<Future<?>> futures = new java.util.ArrayList<>();
        for (int i = 0; i < attempts; i++) {
            futures.add(pool.submit(() -> {
                start.await(); // release every thread at the same instant
                try {
                    bookings.hold(fx.showtimeId(), List.of(seat), null, Set.of());
                    won.incrementAndGet();
                } catch (ApiException e) {
                    assertThat(e.code()).isEqualTo("SEATS_UNAVAILABLE");
                    lost.incrementAndGet();
                }
                return null;
            }));
        }
        start.countDown();
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();

        assertThat(won.get()).isEqualTo(1);
        assertThat(lost.get()).isEqualTo(attempts - 1);
        assertThat(jdbc.queryForObject("select count(*) from seat_reservations where seat_id = ?", Integer.class, seat)).isEqualTo(1);
        // The losers' bookings were rolled back completely, not left half-written.
        assertThat(jdbc.queryForObject("select count(*) from bookings", Integer.class)).isEqualTo(1);
    }

    @Test
    void overlappingMultiSeatRequests_neverShareASeatAndNeverDeadlockForever() throws Exception {
        List<Long> s = fx.seatIds();
        // Each request wants 3 seats; neighbours overlap by one or two seats.
        List<List<Long>> requests = List.of(List.of(s.get(0), s.get(1), s.get(2)), List.of(s.get(2), s.get(1), s.get(3)),
                List.of(s.get(3), s.get(4), s.get(0)), List.of(s.get(4), s.get(2), s.get(1)));
        ExecutorService pool = Executors.newFixedThreadPool(requests.size());
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Boolean>> results = new java.util.ArrayList<>();
        for (List<Long> seats : requests) {
            results.add(pool.submit(() -> {
                start.await();
                try {
                    bookings.hold(fx.showtimeId(), seats, null, Set.of());
                    return true;
                } catch (RuntimeException e) {
                    return false;
                }
            }));
        }
        start.countDown();
        for (Future<Boolean> r : results) {
            r.get(30, java.util.concurrent.TimeUnit.SECONDS);
        }
        pool.shutdown();

        // Whatever won, every seat appears at most once (the primary key guarantees it).
        Integer duplicates = jdbc.queryForObject("""
                select count(*) from (select seat_id from seat_reservations group by seat_id having count(*) > 1) d
                """, Integer.class);
        assertThat(duplicates).isZero();
        // Every reservation belongs to a booking whose items match it exactly.
        Integer orphans = jdbc.queryForObject("""
                select count(*) from seat_reservations r
                where not exists (select 1 from booking_items bi where bi.booking_id = r.booking_id and bi.seat_id = r.seat_id)
                """, Integer.class);
        assertThat(orphans).isZero();
    }

    @Test
    void expiredHoldIsReleasedToTheNextCustomer() {
        Long seat = fx.seatIds().get(0);
        Booking first = bookings.hold(fx.showtimeId(), List.of(seat), null, Set.of());
        // While the hold is live, nobody else can take the seat.
        assertThatThrownBy(() -> bookings.hold(fx.showtimeId(), List.of(seat), null, Set.of()))
                .isInstanceOf(ApiException.class).hasMessageContaining("taken");

        // Time passes: make the hold expire.
        jdbc.update("update seat_reservations set expires_at = now() - interval '1 second' where booking_id = ?", first.getId());
        jdbc.update("update bookings set hold_expires_at = now() - interval '1 second' where id = ?", first.getId());

        Booking second = bookings.hold(fx.showtimeId(), List.of(seat), null, Set.of());
        assertThat(second.getStatus()).isEqualTo(Booking.Status.HELD);
        assertThat(jdbc.queryForObject("select booking_id from seat_reservations where seat_id = ?", Long.class, seat))
                .isEqualTo(second.getId());

        // The expiry job then closes the first booking.
        assertThat(bookings.expireIfDue(first.getId(), Duration.ZERO)).isTrue();
        assertThat(repository.findById(first.getId()).orElseThrow().getStatus()).isEqualTo(Booking.Status.EXPIRED);
    }

    @Test
    void newSelectionReplacesTheBrowsersPreviousHoldOnTheSameShow() {
        Booking first = bookings.hold(fx.showtimeId(), List.of(fx.seatIds().get(0)), null, Set.of());
        Booking second = bookings.hold(fx.showtimeId(), List.of(fx.seatIds().get(1)), null, Set.of(first.getId()));
        assertThat(repository.findById(first.getId()).orElseThrow().getStatus()).isEqualTo(Booking.Status.EXPIRED);
        assertThat(jdbc.queryForObject("select count(*) from seat_reservations", Integer.class)).isEqualTo(1);
        assertThat(second.getStatus()).isEqualTo(Booking.Status.HELD);
    }

    @Test
    void rejectsSeatsFromAnotherAuditoriumAndTooManySeats() {
        long otherHall = id("insert into auditoriums (cinema_id, name, grid_rows, grid_cols) values (" + fx.cinemaId() + ", 'Audi 2', 1, 1) returning id");
        long otherCat = id("insert into seat_categories (auditorium_id, code, name) values (" + otherHall + ", 'CLASSIC', 'Classic') returning id");
        long foreignSeat = id("insert into seats (auditorium_id, category_id, row_label, seat_number, grid_row, grid_col) values ("
                + otherHall + ", " + otherCat + ", 'A', 1, 1, 1) returning id");
        assertThatThrownBy(() -> bookings.hold(fx.showtimeId(), List.of(foreignSeat), null, Set.of()))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("SEATS_UNAVAILABLE");

        jdbc.update("update app_settings set value = '2' where key = 'booking.maxSeatsPerBooking'");
        try {
            assertThatThrownBy(() -> bookings.hold(fx.showtimeId(), fx.seatIds().subList(0, 3), null, Set.of()))
                    .isInstanceOf(ApiException.class).extracting("code").isEqualTo("TOO_MANY_SEATS");
        } finally {
            jdbc.update("update app_settings set value = '10' where key = 'booking.maxSeatsPerBooking'");
        }
    }

    @Test
    void salesCloseBeforeTheShowStarts() {
        jdbc.update("update showtimes set starts_at = now() + interval '5 minutes', ends_at = now() + interval '3 hours' where id = ?", fx.showtimeId());
        assertThatThrownBy(() -> bookings.hold(fx.showtimeId(), List.of(fx.seatIds().get(0)), null, Set.of()))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("SALES_CLOSED");
    }
}
