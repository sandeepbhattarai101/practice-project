package com.practiceproject.booking;

import com.practiceproject.common.ApiException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** SQL used by the booking flow to look up the show and seats being booked. */
@Repository
public class BookingQueries {

    /** Everything about a show the booking rules need, in one row. */
    public record ShowContext(Long showtimeId, Long movieId, Long auditoriumId, Long cinemaId, Instant startsAt,
                              Instant endsAt, String status, boolean salesOpen, String timezone, String movieTitle,
                              String format, String cinemaName, String cinemaAddress, String auditoriumName) {}

    public record SeatPrice(Long seatId, String label, Long categoryId, String categoryName, Long priceMinor) {}

    private static final String SHOW_SQL = """
            select s.id, s.movie_id, s.auditorium_id, a.cinema_id, s.starts_at, s.ends_at, s.status, s.sales_open,
                   ci.timezone, m.title, s.format, c.name, c.address, a.name
            from showtimes s
            join auditoriums a on a.id = s.auditorium_id
            join cinemas c on c.id = a.cinema_id
            join cities ci on ci.id = c.city_id
            join movies m on m.id = s.movie_id
            where s.id = ?
            """;

    private final JdbcTemplate jdbc;

    public BookingQueries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<ShowContext> show(Long showtimeId) {
        return jdbc.query(SHOW_SQL, (rs, i) -> map(rs), showtimeId).stream().findFirst();
    }

    /**
     * Same as show(), but takes a SHARE lock on the showtime row: many bookings can hold it
     * at once, but an admin's UPDATE (cancel/reschedule) waits until they commit. So a show
     * cannot be cancelled halfway through someone's hold.
     */
    public Optional<ShowContext> lockShowForShare(Long showtimeId) {
        return jdbc.query(SHOW_SQL + " for share of s", (rs, i) -> map(rs), showtimeId).stream().findFirst();
    }

    /** Active seats of the show's auditorium with this show's price, filtered to the ids asked for. */
    public List<SeatPrice> seatPrices(Long showtimeId, Long auditoriumId, Collection<Long> seatIds) {
        return jdbc.query("""
                select se.id, se.row_label || se.seat_number, sc.id, sc.name, sp.price_minor
                from seats se
                join seat_categories sc on sc.id = se.category_id
                left join showtime_prices sp on sp.showtime_id = ? and sp.seat_category_id = sc.id
                where se.auditorium_id = ? and se.is_active and se.id = any(?::bigint[])
                order by se.row_label, se.seat_number
                """, (rs, i) -> new SeatPrice(rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getString(4),
                (Long) rs.getObject(5, Long.class)), showtimeId, auditoriumId, SeatHoldRepository.pgArray(seatIds));
    }

    public void insertItems(Long bookingId, List<SeatPrice> seats) {
        jdbc.batchUpdate("insert into booking_items (booking_id, seat_id, seat_label, category_name, price_minor) values (?, ?, ?, ?, ?)",
                seats, seats.size(), (ps, s) -> {
                    ps.setLong(1, bookingId);
                    ps.setLong(2, s.seatId());
                    ps.setString(3, s.label());
                    ps.setString(4, s.categoryName());
                    ps.setLong(5, s.priceMinor());
                });
    }

    public List<Long> itemSeatIds(Long bookingId) {
        return jdbc.queryForList("select seat_id from booking_items where booking_id = ? order by seat_id", Long.class, bookingId);
    }

    public List<String> seatLabels(Long bookingId) {
        return jdbc.queryForList("select seat_label from booking_items where booking_id = ? order by seat_label", String.class, bookingId);
    }

    /** Open bookings this caller has for a show (to replace them with a new selection). */
    public List<Long> openBookingsFor(Long showtimeId, Long userId, Collection<Long> guestIds) {
        return jdbc.queryForList("""
                select id from bookings
                where showtime_id = ? and status in ('HELD', 'PAYMENT_PENDING')
                  and ((?::bigint is not null and user_id = ?) or id = any(?::bigint[]))
                """, Long.class, showtimeId, userId, userId, SeatHoldRepository.pgArray(guestIds));
    }

    /** How many unexpired holds this caller has across all shows (abuse limit). */
    public int activeHoldCount(Long userId, Collection<Long> guestIds) {
        Integer n = jdbc.queryForObject("""
                select count(*) from bookings
                where status in ('HELD', 'PAYMENT_PENDING') and hold_expires_at > now()
                  and ((?::bigint is not null and user_id = ?) or id = any(?::bigint[]))
                """, Integer.class, userId, userId, SeatHoldRepository.pgArray(guestIds));
        return n == null ? 0 : n;
    }

    public void touchUpdatedAt(Long bookingId, Instant at) {
        jdbc.update("update bookings set updated_at = ? where id = ?", Timestamp.from(at), bookingId);
    }

    private static ShowContext map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ShowContext(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4), rs.getTimestamp(5).toInstant(),
                rs.getTimestamp(6).toInstant(), rs.getString(7), rs.getBoolean(8), rs.getString(9), rs.getString(10),
                rs.getString(11), rs.getString(12), rs.getString(13), rs.getString(14));
    }

    static ApiException showNotFound() {
        return ApiException.notFound("Showtime");
    }
}
