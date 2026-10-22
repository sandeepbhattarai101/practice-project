package com.practiceproject.booking;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * All writes to seat_reservations, the table whose primary key (showtime_id, seat_id)
 * makes double-selling impossible. Read the comments here alongside V3__bookings_payments.sql.
 */
@Repository
public class SeatHoldRepository {

    private final JdbcTemplate jdbc;

    public SeatHoldRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Tries to claim every seat for the booking, atomically. Returns the seat ids it got.
     *
     * How it stays correct when 50 people click the same seat at once:
     * <ol>
     *   <li>INSERT fails with a conflict if a row for (show, seat) exists, and
     *       {@code ON CONFLICT ... DO UPDATE ... WHERE} only takes over a row whose hold has
     *       expired. A live hold or a sale is left alone and that seat is simply not returned.</li>
     *   <li>If two transactions insert the same new key at once, Postgres makes the second
     *       wait for the first to commit or roll back, then re-checks. No race window.</li>
     *   <li>Seats are inserted in ascending id order, so two overlapping requests lock rows in
     *       the same order and cannot deadlock each other.</li>
     * </ol>
     * The caller compares the result with what it asked for and rolls back on a shortfall.
     */
    public List<Long> claim(Long showtimeId, Collection<Long> seatIds, Long bookingId, Instant expiresAt, String status) {
        return jdbc.queryForList("""
                insert into seat_reservations (showtime_id, seat_id, booking_id, status, expires_at)
                select ?::bigint, s, ?::bigint, ?::text, ?::timestamptz
                from unnest(?::bigint[]) as s
                order by s
                on conflict (showtime_id, seat_id) do update
                    set booking_id = excluded.booking_id,
                        status = excluded.status,
                        expires_at = excluded.expires_at,
                        created_at = now()
                    where seat_reservations.status = 'HELD' and seat_reservations.expires_at <= now()
                returning seat_id
                """, Long.class, showtimeId, bookingId, status,
                expiresAt == null ? null : Timestamp.from(expiresAt), pgArray(seatIds));
    }

    /** Releases only rows this booking still owns and that are holds (a sale is never released here). */
    public int releaseHolds(Long bookingId) {
        return jdbc.update("delete from seat_reservations where booking_id = ? and status = 'HELD'", bookingId);
    }

    /** Frees every seat of a booking, sold or held (used by cancellation). */
    public int releaseAll(Long bookingId) {
        return jdbc.update("delete from seat_reservations where booking_id = ?", bookingId);
    }

    /** Converts this booking's holds into sales. Returns the seat ids converted. */
    public List<Long> markBooked(Long bookingId) {
        return jdbc.queryForList("""
                update seat_reservations set status = 'BOOKED', expires_at = null
                where booking_id = ?
                returning seat_id
                """, Long.class, bookingId);
    }

    /** Pushes the hold expiry out while the customer is on the payment page. */
    public int extendHolds(Long bookingId, Instant expiresAt) {
        return jdbc.update("update seat_reservations set expires_at = ? where booking_id = ? and status = 'HELD'",
                Timestamp.from(expiresAt), bookingId);
    }

    /**
     * Postgres NOTIFY: tells every listening app instance "seats changed for this show".
     * Inside a transaction the notification is only delivered on COMMIT, and is dropped on
     * rollback, so listeners never hear about changes that did not happen.
     */
    public void notifySeatsChanged(Long showtimeId) {
        jdbc.queryForList("select pg_notify('seat_events', ?)", String.class, String.valueOf(showtimeId));
    }

    static String pgArray(Collection<Long> ids) {
        return ids.stream().sorted().map(String::valueOf).collect(Collectors.joining(",", "{", "}"));
    }
}
