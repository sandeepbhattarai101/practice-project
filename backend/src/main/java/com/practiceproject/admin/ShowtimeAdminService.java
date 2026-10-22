package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.booking.BookingService;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ShowtimeAdminService {

    public record PriceInput(@NotNull Long categoryId, @NotNull @Min(0) @Max(100_000_000) Long priceMinor) {}

    public record ShowtimeInput(@NotNull Long movieId, @NotNull Long auditoriumId, @NotNull Instant startsAt,
                                @NotBlank @Size(max = 10) String format, @NotBlank @Size(max = 40) String language,
                                @Min(0) @Max(120) Integer bufferMinutes, @NotEmpty List<@Valid PriceInput> prices) {}

    public record BulkInput(@NotNull Long movieId, @NotNull Long auditoriumId,
                            @NotEmpty @Size(max = 31) List<@NotNull LocalDate> dates,
                            @NotEmpty @Size(max = 8) List<@Pattern(regexp = "^([01]\\d|2[0-3]):[0-5]\\d$", message = "Use HH:mm") String> times,
                            @NotBlank String format, @NotBlank String language, @Min(0) @Max(120) Integer bufferMinutes,
                            @NotEmpty List<@Valid PriceInput> prices) {}

    public record Conflict(Instant startsAt, String message) {}

    public record BulkResult(int created, List<Conflict> conflicts) {}

    public record Ref(Long id, String name) {}

    public record PriceRow(Long categoryId, String name, long priceMinor) {}

    public record AdminShowtime(Long id, Instant startsAt, Instant endsAt, String format, String language, String status,
                                boolean salesOpen, Ref movie, Ref cinema, Ref auditorium, int sold, int held, int capacity,
                                List<PriceRow> prices, String timezone) {}

    private final JdbcTemplate jdbc;
    private final AdminScope scope;
    private final BookingService bookings;
    private final AuditService audit;

    public ShowtimeAdminService(JdbcTemplate jdbc, AdminScope scope, BookingService bookings, AuditService audit) {
        this.jdbc = jdbc;
        this.scope = scope;
        this.bookings = bookings;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public PageResponse<AdminShowtime> list(Long cinemaId, Long movieId, LocalDate from, LocalDate to, String status, int page, int size) {
        String cinemas = AdminScope.sqlArray(scope.narrow(cinemaId));
        String where = """
                 where (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                   and (?::bigint is null or s.movie_id = ?)
                   and (?::date is null or (s.starts_at at time zone ci.timezone)::date >= ?)
                   and (?::date is null or (s.starts_at at time zone ci.timezone)::date <= ?)
                   and (?::text is null or s.status = ?)
                """;
        Object[] args = {cinemas, cinemas, movieId, movieId, from, from, to, to, blank(status), blank(status)};
        String joins = " from showtimes s join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id"
                + " join cities ci on ci.id = c.city_id join movies m on m.id = s.movie_id";
        Long total = jdbc.queryForObject("select count(*)" + joins + where, Long.class, args);
        List<Object> pageArgs = new ArrayList<>(java.util.Arrays.asList(args)); // asList, not List.of: filter values may be null
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<AdminShowtime> items = jdbc.query("""
                select s.id, s.starts_at, s.ends_at, s.format, s.language, s.status, s.sales_open, m.id, m.title, c.id, c.name,
                       a.id, a.name, ci.timezone,
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'BOOKED') as sold,
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'HELD' and r.expires_at > now()) as held,
                       (select count(*) from seats se where se.auditorium_id = a.id and se.is_active) as capacity
                """ + joins + where + " order by s.starts_at limit ? offset ?", (rs, i) -> new AdminShowtime(
                rs.getLong(1), rs.getTimestamp(2).toInstant(), rs.getTimestamp(3).toInstant(), rs.getString(4), rs.getString(5),
                rs.getString(6), rs.getBoolean(7), new Ref(rs.getLong(8), rs.getString(9)), new Ref(rs.getLong(10), rs.getString(11)),
                new Ref(rs.getLong(12), rs.getString(13)), rs.getInt(15), rs.getInt(16), rs.getInt(17), prices(rs.getLong(1)),
                rs.getString(14)), pageArgs.toArray());
        return PageResponse.of(items, page, size, total == null ? 0 : total);
    }

    @Transactional
    public AdminShowtime create(ShowtimeInput in) {
        scope.requireAuditorium(in.auditoriumId());
        validate(in.movieId(), in.auditoriumId(), in.format(), in.language(), in.prices());
        Instant ends = endsAt(in.movieId(), in.startsAt(), in.bufferMinutes());
        if (!in.startsAt().isAfter(Instant.now())) {
            throw ApiException.badRequest("The show must start in the future");
        }
        Long id = insert(in.movieId(), in.auditoriumId(), in.startsAt(), ends, in.format(), in.language(), in.prices());
        if (id == null) {
            throw overlap();
        }
        audit.record("showtime.created", "showtime", id, Map.of("movieId", in.movieId(), "startsAt", in.startsAt().toString()));
        return get(id);
    }

    @Transactional
    public BulkResult bulk(BulkInput in) {
        scope.requireAuditorium(in.auditoriumId());
        validate(in.movieId(), in.auditoriumId(), in.format(), in.language(), in.prices());
        ZoneId zone = ZoneId.of(jdbc.queryForObject("""
                select ci.timezone from auditoriums a join cinemas c on c.id = a.cinema_id join cities ci on ci.id = c.city_id where a.id = ?
                """, String.class, in.auditoriumId()));
        int created = 0;
        List<Conflict> conflicts = new ArrayList<>();
        for (LocalDate date : in.dates()) {
            for (String time : in.times()) {
                // Convert cinema-local wall-clock time to an instant: 20:00 in Kathmandu is 14:15 UTC.
                Instant start = date.atTime(LocalTime.parse(time)).atZone(zone).toInstant();
                if (!start.isAfter(Instant.now())) {
                    conflicts.add(new Conflict(start, "In the past"));
                    continue;
                }
                Long id = insert(in.movieId(), in.auditoriumId(), start, endsAt(in.movieId(), start, in.bufferMinutes()),
                        in.format(), in.language(), in.prices());
                if (id == null) {
                    conflicts.add(new Conflict(start, "Overlaps another show in this auditorium"));
                } else {
                    created++;
                }
            }
        }
        audit.record("showtime.bulk_created", "auditorium", in.auditoriumId(), Map.of("created", created, "conflicts", conflicts.size()));
        return new BulkResult(created, conflicts);
    }

    @Transactional
    public AdminShowtime update(Long id, ShowtimeInput in) {
        scope.requireShowtime(id);
        scope.requireAuditorium(in.auditoriumId());
        var current = jdbc.queryForMap("select auditorium_id, starts_at, movie_id, status from showtimes where id = ? for update", id);
        if ("CANCELLED".equals(current.get("status"))) {
            throw ApiException.unprocessable("SHOWTIME_CANCELLED", "Cancelled shows can't be edited");
        }
        validate(in.movieId(), in.auditoriumId(), in.format(), in.language(), in.prices());
        boolean hasSeatsTaken = Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists (select 1 from seat_reservations where showtime_id = ?)", Boolean.class, id));
        boolean moving = !current.get("auditorium_id").equals(in.auditoriumId())
                || !((Timestamp) current.get("starts_at")).toInstant().equals(in.startsAt())
                || !current.get("movie_id").equals(in.movieId());
        if (hasSeatsTaken && moving) {
            throw ApiException.conflict("SHOWTIME_HAS_BOOKINGS",
                    "Seats are already held or sold, so the movie, time and auditorium can't change. Prices can still be edited.");
        }
        try {
            jdbc.update("update showtimes set movie_id = ?, auditorium_id = ?, starts_at = ?, ends_at = ?, format = ?, language = ?, updated_at = now() where id = ?",
                    in.movieId(), in.auditoriumId(), Timestamp.from(in.startsAt()),
                    Timestamp.from(endsAt(in.movieId(), in.startsAt(), in.bufferMinutes())), in.format(), in.language(), id);
        } catch (DataIntegrityViolationException e) {
            throw overlap();
        }
        // Price changes affect new holds only; existing bookings keep the price they were quoted (booking_items).
        jdbc.update("delete from showtime_prices where showtime_id = ?", id);
        insertPrices(id, in.prices());
        audit.record("showtime.updated", "showtime", id, Map.of("startsAt", in.startsAt().toString()));
        return get(id);
    }

    @Transactional
    public AdminShowtime setSales(Long id, boolean open) {
        scope.requireShowtime(id);
        jdbc.update("update showtimes set sales_open = ?, updated_at = now() where id = ?", open, id);
        audit.record(open ? "showtime.sales_opened" : "showtime.sales_closed", "showtime", id, Map.of());
        return get(id);
    }

    /** Cancels the show and every booking on it, with full refunds. One transaction: all or nothing. */
    @Transactional
    public AdminShowtime cancel(Long id, String reason) {
        scope.requireShowtime(id);
        // FOR UPDATE waits for in-flight seat holds (which hold FOR SHARE) to commit first.
        String status = jdbc.queryForObject("select status from showtimes where id = ? for update", String.class, id);
        if ("CANCELLED".equals(status)) {
            return get(id);
        }
        jdbc.update("update showtimes set status = 'CANCELLED', sales_open = false, updated_at = now() where id = ?", id);
        List<String> refs = jdbc.queryForList(
                "select reference from bookings where showtime_id = ? and status in ('HELD', 'PAYMENT_PENDING', 'CONFIRMED')",
                String.class, id);
        String why = "Show cancelled: " + reason;
        for (String ref : refs) {
            bookings.cancelByStaff(ref, why, 100, booking -> { });
        }
        audit.record("showtime.cancelled", "showtime", id, Map.of("reason", reason, "bookingsCancelled", refs.size()));
        return get(id);
    }

    @Transactional(readOnly = true)
    public AdminShowtime get(Long id) {
        return single(id);
    }

    private AdminShowtime single(Long id) {
        return jdbc.query("""
                select s.id, s.starts_at, s.ends_at, s.format, s.language, s.status, s.sales_open, m.id, m.title, c.id, c.name,
                       a.id, a.name, ci.timezone,
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'BOOKED'),
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'HELD' and r.expires_at > now()),
                       (select count(*) from seats se where se.auditorium_id = a.id and se.is_active)
                from showtimes s join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id
                join cities ci on ci.id = c.city_id join movies m on m.id = s.movie_id where s.id = ?
                """, (rs, i) -> new AdminShowtime(rs.getLong(1), rs.getTimestamp(2).toInstant(), rs.getTimestamp(3).toInstant(),
                rs.getString(4), rs.getString(5), rs.getString(6), rs.getBoolean(7), new Ref(rs.getLong(8), rs.getString(9)),
                new Ref(rs.getLong(10), rs.getString(11)), new Ref(rs.getLong(12), rs.getString(13)), rs.getInt(15), rs.getInt(16),
                rs.getInt(17), prices(rs.getLong(1)), rs.getString(14)), id).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Showtime"));
    }

    // ------------------------------------------------------------------ helpers

    /** Insert returning the id, or null if the overlap constraint rejected it (ON CONFLICT DO NOTHING). */
    private Long insert(Long movieId, Long auditoriumId, Instant start, Instant end, String format, String language,
                        List<PriceInput> prices) {
        List<Long> ids = jdbc.queryForList("""
                insert into showtimes (movie_id, auditorium_id, starts_at, ends_at, format, language)
                values (?, ?, ?, ?, ?, ?) on conflict do nothing returning id
                """, Long.class, movieId, auditoriumId, Timestamp.from(start), Timestamp.from(end), format, language);
        if (ids.isEmpty()) {
            return null;
        }
        insertPrices(ids.getFirst(), prices);
        return ids.getFirst();
    }

    private void insertPrices(Long showtimeId, List<PriceInput> prices) {
        jdbc.batchUpdate("insert into showtime_prices (showtime_id, seat_category_id, price_minor) values (?, ?, ?)",
                prices, prices.size(), (ps, p) -> {
                    ps.setLong(1, showtimeId);
                    ps.setLong(2, p.categoryId());
                    ps.setLong(3, p.priceMinor());
                });
    }

    private void validate(Long movieId, Long auditoriumId, String format, String language, List<PriceInput> prices) {
        var movie = jdbc.queryForList("select languages, status from movies where id = ?", movieId).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Movie"));
        if ("ARCHIVED".equals(movie.get("status"))) {
            throw ApiException.badRequest("Archived movies can't be scheduled");
        }
        List<String> formats = jdbc.queryForObject("select formats from auditoriums where id = ? and is_active",
                (rs, i) -> List.of((String[]) rs.getArray(1).getArray()), auditoriumId);
        if (!formats.contains(format)) {
            throw ApiException.badRequest("This auditorium does not support " + format + ". Supported: " + String.join(", ", formats));
        }
        Set<Long> categories = new HashSet<>(jdbc.queryForList("select id from seat_categories where auditorium_id = ?", Long.class, auditoriumId));
        Set<Long> priced = new HashSet<>();
        for (PriceInput p : prices) {
            if (!categories.contains(p.categoryId())) {
                throw ApiException.badRequest("Price given for a seat category that is not in this auditorium");
            }
            priced.add(p.categoryId());
        }
        if (!priced.equals(categories)) {
            throw ApiException.badRequest("Set a price for every seat category in this auditorium");
        }
        if (language == null || language.isBlank()) {
            throw ApiException.badRequest("Language is required");
        }
    }

    private Instant endsAt(Long movieId, Instant start, Integer bufferMinutes) {
        Integer runtime = jdbc.queryForObject("select runtime_minutes from movies where id = ?", Integer.class, movieId);
        int buffer = bufferMinutes == null ? 20 : bufferMinutes;
        return start.plusSeconds((long) (runtime + buffer) * 60);
    }

    private List<PriceRow> prices(Long showtimeId) {
        return jdbc.query("""
                select sc.id, sc.name, sp.price_minor from showtime_prices sp join seat_categories sc on sc.id = sp.seat_category_id
                where sp.showtime_id = ? order by sc.sort_order, sc.id
                """, (rs, i) -> new PriceRow(rs.getLong(1), rs.getString(2), rs.getLong(3)), showtimeId);
    }

    private static ApiException overlap() {
        return ApiException.conflict("SHOWTIME_OVERLAP", "This overlaps another show in the same auditorium (including cleaning time)");
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
