package com.practiceproject.booking;

import com.practiceproject.auth.AuthUser;
import com.practiceproject.auth.CurrentUser;
import com.practiceproject.auth.GuestBookings;
import com.practiceproject.booking.BookingQueries.ShowContext;
import com.practiceproject.catalog.CatalogDtos.AuditoriumRef;
import com.practiceproject.catalog.CatalogDtos.ShowtimeDetail;
import com.practiceproject.catalog.CatalogDtos.ShowtimePrice;
import com.practiceproject.catalog.CatalogQueries;
import com.practiceproject.catalog.CatalogRepositories;
import com.practiceproject.common.ApiException;
import com.practiceproject.settings.SettingsService;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/showtimes")
public class ShowtimeController {

    public record SeatCategory(Long id, String code, String name, String color, Long priceMinor) {}

    public record SeatDto(Long id, String label, String rowLabel, int number, int gridRow, int gridCol, Long categoryId,
                          String type, String state) {}

    public record SeatMap(Long showtimeId, int gridRows, int gridCols, List<SeatCategory> categories, List<SeatDto> seats,
                          String myBookingReference, Instant myHoldExpiresAt) {}

    private final BookingQueries queries;
    private final CatalogQueries catalog;
    private final CatalogRepositories.CityRepository cities;
    private final JdbcTemplate jdbc;
    private final SettingsService settings;
    private final SeatEvents events;

    public ShowtimeController(BookingQueries queries, CatalogQueries catalog, CatalogRepositories.CityRepository cities,
                              JdbcTemplate jdbc, SettingsService settings, SeatEvents events) {
        this.queries = queries;
        this.catalog = catalog;
        this.cities = cities;
        this.jdbc = jdbc;
        this.settings = settings;
        this.events = events;
    }

    @GetMapping("/{id}")
    public ShowtimeDetail detail(@PathVariable Long id) {
        ShowContext show = queries.show(id).orElseThrow(BookingQueries::showNotFound);
        var cinema = catalog.cinemaById(show.cinemaId()).orElseThrow(() -> ApiException.notFound("Cinema"));
        Long cityId = cities.findBySlug(cinema.citySlug()).map(c -> c.getId()).orElse(null);
        String movieSlug = jdbc.queryForObject("select slug from movies where id = ?", String.class, show.movieId());
        var movie = catalog.cardBySlug(movieSlug, cityId, show.timezone(), false).orElseThrow(() -> ApiException.notFound("Movie"));
        String language = jdbc.queryForObject("select language from showtimes where id = ?", String.class, id);
        int close = settings.booking().salesCloseMinutes();
        Instant salesCloseAt = show.startsAt().minus(Duration.ofMinutes(close));
        boolean open = "SCHEDULED".equals(show.status()) && show.salesOpen() && salesCloseAt.isAfter(Instant.now());
        List<ShowtimePrice> prices = jdbc.query("""
                select sc.id, sc.code, sc.name, sc.color, sp.price_minor
                from showtime_prices sp join seat_categories sc on sc.id = sp.seat_category_id
                where sp.showtime_id = ? order by sc.sort_order, sc.id
                """, (rs, i) -> new ShowtimePrice(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5)), id);
        return new ShowtimeDetail(id, show.startsAt(), show.endsAt(), show.format(), language, show.status(), open, salesCloseAt,
                show.timezone(), movie, cinema, new AuditoriumRef(show.auditoriumId(), show.auditoriumName()), prices);
    }

    /**
     * The seat map: every seat with its state for THIS show. One query with a LEFT JOIN on
     * seat_reservations: a seat with no reservation row (or an expired hold) is available.
     */
    @GetMapping("/{id}/seats")
    public SeatMap seats(@PathVariable Long id, HttpServletRequest request) {
        ShowContext show = queries.show(id).orElseThrow(BookingQueries::showNotFound);
        AuthUser user = CurrentUser.get().orElse(null);
        Set<Long> guestIds = GuestBookings.ids(request);
        Long userId = user == null ? null : user.id();

        var grid = jdbc.queryForMap("select grid_rows, grid_cols from auditoriums where id = ?", show.auditoriumId());
        List<SeatCategory> categories = jdbc.query("""
                select sc.id, sc.code, sc.name, sc.color, sp.price_minor
                from seat_categories sc
                left join showtime_prices sp on sp.seat_category_id = sc.id and sp.showtime_id = ?
                where sc.auditorium_id = ? order by sc.sort_order, sc.id
                """, (rs, i) -> new SeatCategory(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getObject(5, Long.class)), id, show.auditoriumId());

        String guestArray = SeatHoldRepository.pgArray(guestIds);
        List<SeatDto> seats = jdbc.query("""
                select se.id, se.row_label, se.seat_number, se.grid_row, se.grid_col, se.category_id, se.seat_type,
                       se.is_active, sp.price_minor is not null as priced,
                       r.status as res_status, r.expires_at, b.user_id, b.id as booking_id
                from seats se
                left join showtime_prices sp on sp.showtime_id = ? and sp.seat_category_id = se.category_id
                left join seat_reservations r on r.showtime_id = ? and r.seat_id = se.id
                left join bookings b on b.id = r.booking_id
                where se.auditorium_id = ? and se.grid_row > 0 -- negative rows = retired seats kept for history
                order by se.grid_row, se.grid_col
                """, (rs, i) -> {
            String state;
            String resStatus = rs.getString("res_status");
            Timestamp expires = rs.getTimestamp("expires_at");
            boolean liveHold = "HELD".equals(resStatus) && expires != null && expires.toInstant().isAfter(Instant.now());
            Long bookingId = rs.getObject("booking_id", Long.class);
            // Note: Set.of().contains(null) throws, hence the explicit null check.
            boolean mine = (userId != null && userId.equals(rs.getObject("user_id", Long.class)))
                    || (bookingId != null && guestIds.contains(bookingId));
            if (!rs.getBoolean("is_active") || !rs.getBoolean("priced")) {
                state = "UNAVAILABLE";
            } else if ("BOOKED".equals(resStatus)) {
                state = "SOLD";
            } else if (liveHold) {
                state = mine ? "MINE" : "HELD";
            } else {
                state = "AVAILABLE";
            }
            String row = rs.getString("row_label");
            int number = rs.getInt("seat_number");
            return new SeatDto(rs.getLong("id"), row + number, row, number, rs.getInt("grid_row"), rs.getInt("grid_col"),
                    rs.getLong("category_id"), rs.getString("seat_type"), state);
        }, id, id, show.auditoriumId());

        var mine = jdbc.query("""
                select reference, hold_expires_at from bookings
                where showtime_id = ? and status in ('HELD', 'PAYMENT_PENDING') and hold_expires_at > now()
                  and ((?::bigint is not null and user_id = ?) or id = any(?::bigint[]))
                order by created_at desc limit 1
                """, (rs, i) -> new Object[] {rs.getString(1), rs.getTimestamp(2).toInstant()}, id, userId, userId, guestArray);

        return new SeatMap(id, ((Number) grid.get("grid_rows")).intValue(), ((Number) grid.get("grid_cols")).intValue(),
                categories, seats, mine.isEmpty() ? null : (String) mine.getFirst()[0],
                mine.isEmpty() ? null : (Instant) mine.getFirst()[1]);
    }

    @GetMapping("/{id}/seats/stream")
    public SseEmitter stream(@PathVariable Long id) {
        queries.show(id).orElseThrow(BookingQueries::showNotFound);
        return events.subscribe(id);
    }
}
