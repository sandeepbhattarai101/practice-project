package com.practiceproject.admin;

import com.practiceproject.common.Formats;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reporting SQL: GROUP BY, FILTER, date_trunc and time-zone conversion. Revenue counts only
 * CONFIRMED bookings (and cancelled ones that were once confirmed are excluded from gross,
 * since their money was refunded or credited, see billing for the exact ledger).
 */
@Service
@Transactional(readOnly = true)
public class ReportService {

    private static final String TZ = "Asia/Kathmandu";

    public record Totals(long bookings, long tickets, long revenueMinor) {}

    public record DayPoint(LocalDate date, long revenueMinor, long tickets) {}

    public record TopMovie(String title, long revenueMinor, long tickets) {}

    public record NextShow(Long showtimeId, String movieTitle, String cinemaName, String auditoriumName, Instant startsAt,
                           int sold, int capacity) {}

    public record Dashboard(Totals today, Totals last30Days, long activeHolds, long upcomingShowtimes, long pendingRefunds,
                            List<DayPoint> salesByDay, List<TopMovie> topMovies, List<NextShow> nextShowtimes) {}

    public record SalesRow(String key, String label, long bookings, long tickets, long grossMinor, long discountMinor,
                           long feeMinor, long taxMinor, long totalMinor) {}

    public record SalesReport(List<SalesRow> rows, SalesRow totals) {}

    public record OccupancyRow(Long showtimeId, String movieTitle, String cinemaName, String auditoriumName, Instant startsAt,
                               int capacity, int sold, double occupancyPercent) {}

    public record OccupancyReport(List<OccupancyRow> rows) {}

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SCOPED_BOOKINGS = """
            from bookings b
            join showtimes s on s.id = b.showtime_id
            join auditoriums a on a.id = s.auditorium_id
            join cinemas c on c.id = a.cinema_id
            join movies m on m.id = s.movie_id
            where b.status = 'CONFIRMED' and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
            """;

    public Dashboard dashboard(List<Long> cinemaIds) {
        String scope = AdminScope.sqlArray(cinemaIds);
        Totals today = totals(scope, "and (b.confirmed_at at time zone '" + TZ + "')::date = (now() at time zone '" + TZ + "')::date");
        Totals last30 = totals(scope, "and b.confirmed_at > now() - interval '30 days'");

        long holds = count("""
                select count(*) from bookings b join showtimes s on s.id = b.showtime_id join auditoriums a on a.id = s.auditorium_id
                where b.status in ('HELD', 'PAYMENT_PENDING') and b.hold_expires_at > now()
                  and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                """, scope);
        long upcoming = count("""
                select count(*) from showtimes s join auditoriums a on a.id = s.auditorium_id
                where s.status = 'SCHEDULED' and s.starts_at > now() and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                """, scope);
        long refunds = count("""
                select count(*) from refunds r join bookings b on b.id = r.booking_id join showtimes s on s.id = b.showtime_id
                join auditoriums a on a.id = s.auditorium_id
                where r.status = 'PENDING' and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                """, scope);

        // generate_series produces one row per day so days with no sales still appear (as zero).
        List<DayPoint> byDay = jdbc.query("""
                select d::date,
                       coalesce(sum(x.total_minor), 0),
                       coalesce(sum(x.tickets), 0)
                from generate_series((now() at time zone '%1$s')::date - 13, (now() at time zone '%1$s')::date, interval '1 day') d
                left join (
                    select (b.confirmed_at at time zone '%1$s')::date as day, b.total_minor,
                           (select count(*) from booking_items bi where bi.booking_id = b.id) as tickets
                    %2$s
                ) x on x.day = d::date
                group by d order by d
                """.formatted(TZ, SCOPED_BOOKINGS), (rs, i) -> new DayPoint(rs.getObject(1, LocalDate.class), rs.getLong(2), rs.getLong(3)),
                scope, scope);

        List<TopMovie> top = jdbc.query("""
                select m.title, sum(b.total_minor), sum((select count(*) from booking_items bi where bi.booking_id = b.id))
                """ + SCOPED_BOOKINGS + " and b.confirmed_at > now() - interval '30 days' group by m.title order by 2 desc limit 5",
                (rs, i) -> new TopMovie(rs.getString(1), rs.getLong(2), rs.getLong(3)), scope, scope);

        List<NextShow> next = jdbc.query("""
                select s.id, m.title, c.name, a.name, s.starts_at,
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'BOOKED'),
                       (select count(*) from seats se where se.auditorium_id = a.id and se.is_active)
                from showtimes s join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id
                join movies m on m.id = s.movie_id
                where s.status = 'SCHEDULED' and s.starts_at > now() and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                order by s.starts_at limit 8
                """, (rs, i) -> new NextShow(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getTimestamp(5).toInstant(), rs.getInt(6), rs.getInt(7)), scope, scope);

        return new Dashboard(today, last30, holds, upcoming, refunds, byDay, top, next);
    }

    public SalesReport sales(LocalDate from, LocalDate to, String groupBy, List<Long> cinemaIds) {
        String scope = AdminScope.sqlArray(cinemaIds);
        String keyExpr = switch (groupBy == null ? "day" : groupBy) {
            case "movie" -> "m.id::text, m.title";
            case "cinema" -> "c.id::text, c.name";
            default -> "to_char((b.confirmed_at at time zone '" + TZ + "')::date, 'YYYY-MM-DD'), to_char((b.confirmed_at at time zone '"
                    + TZ + "')::date, 'DD/MM/YYYY')";
        };
        List<SalesRow> rows = jdbc.query("select " + keyExpr + """
                , count(*), sum((select count(*) from booking_items bi where bi.booking_id = b.id)),
                  sum(b.subtotal_minor), sum(b.discount_minor), sum(b.fee_minor), sum(b.tax_minor), sum(b.total_minor)
                """ + SCOPED_BOOKINGS + """
                  and (?::date is null or (b.confirmed_at at time zone 'Asia/Kathmandu')::date >= ?)
                  and (?::date is null or (b.confirmed_at at time zone 'Asia/Kathmandu')::date <= ?)
                group by 1, 2 order by 1
                """, (rs, i) -> new SalesRow(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getLong(4), rs.getLong(5),
                rs.getLong(6), rs.getLong(7), rs.getLong(8), rs.getLong(9)), scope, scope, from, from, to, to);
        var totals = new SalesRow("total", "Total", rows.stream().mapToLong(SalesRow::bookings).sum(),
                rows.stream().mapToLong(SalesRow::tickets).sum(), rows.stream().mapToLong(SalesRow::grossMinor).sum(),
                rows.stream().mapToLong(SalesRow::discountMinor).sum(), rows.stream().mapToLong(SalesRow::feeMinor).sum(),
                rows.stream().mapToLong(SalesRow::taxMinor).sum(), rows.stream().mapToLong(SalesRow::totalMinor).sum());
        return new SalesReport(rows, totals);
    }

    public OccupancyReport occupancy(LocalDate from, LocalDate to, List<Long> cinemaIds) {
        String scope = AdminScope.sqlArray(cinemaIds);
        List<OccupancyRow> rows = jdbc.query("""
                select s.id, m.title, c.name, a.name, s.starts_at, cap.n,
                       (select count(*) from seat_reservations r where r.showtime_id = s.id and r.status = 'BOOKED') as sold
                from showtimes s
                join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id join movies m on m.id = s.movie_id
                join lateral (select count(*) as n from seats se where se.auditorium_id = a.id and se.is_active) cap on true
                where s.status = 'SCHEDULED' and (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                  and (?::date is null or (s.starts_at at time zone 'Asia/Kathmandu')::date >= ?)
                  and (?::date is null or (s.starts_at at time zone 'Asia/Kathmandu')::date <= ?)
                order by s.starts_at limit 1000
                """, (rs, i) -> {
            int cap = rs.getInt(6);
            int sold = rs.getInt(7);
            return new OccupancyRow(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                    rs.getTimestamp(5).toInstant(), cap, sold, cap == 0 ? 0 : Math.round(sold * 1000.0 / cap) / 10.0);
        }, scope, scope, from, from, to, to);
        return new OccupancyReport(rows);
    }

    public String salesCsv(SalesReport report) {
        var sb = new StringBuilder("Group,Bookings,Tickets,Gross,Discount,Fees,Tax,Total\n");
        List<SalesRow> all = new ArrayList<>(report.rows());
        all.add(report.totals());
        for (SalesRow r : all) {
            sb.append(cell(r.label())).append(',').append(r.bookings()).append(',').append(r.tickets()).append(',')
                    .append(Formats.decimal(r.grossMinor())).append(',').append(Formats.decimal(r.discountMinor())).append(',')
                    .append(Formats.decimal(r.feeMinor())).append(',').append(Formats.decimal(r.taxMinor())).append(',')
                    .append(Formats.decimal(r.totalMinor())).append('\n');
        }
        return sb.toString();
    }

    public String occupancyCsv(OccupancyReport report) {
        var sb = new StringBuilder("Showtime,Movie,Cinema,Auditorium,Starts,Capacity,Sold,Occupancy %\n");
        for (OccupancyRow r : report.rows()) {
            sb.append(r.showtimeId()).append(',').append(cell(r.movieTitle())).append(',').append(cell(r.cinemaName())).append(',')
                    .append(cell(r.auditoriumName())).append(',').append(Formats.dateTime(r.startsAt(), TZ)).append(',')
                    .append(r.capacity()).append(',').append(r.sold()).append(',').append(r.occupancyPercent()).append('\n');
        }
        return sb.toString();
    }

    private Totals totals(String scope, String extra) {
        Map<String, Object> row = jdbc.queryForMap("""
                select count(*) as bookings,
                       coalesce(sum((select count(*) from booking_items bi where bi.booking_id = b.id)), 0) as tickets,
                       coalesce(sum(b.total_minor), 0) as revenue
                """ + SCOPED_BOOKINGS + extra, scope, scope);
        return new Totals(((Number) row.get("bookings")).longValue(), ((Number) row.get("tickets")).longValue(),
                ((Number) row.get("revenue")).longValue());
    }

    private long count(String sql, String scope) {
        Long n = jdbc.queryForObject(sql, Long.class, scope, scope);
        return n == null ? 0 : n;
    }

    /** CSV cell with formula-injection protection. */
    static String cell(String v) {
        if (v == null) {
            return "";
        }
        String s = !v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0 ? "'" + v : v;
        return "\"" + s.replace("\"", "\"\"") + "\"";
    }

    static Map<String, Object> map() {
        return new LinkedHashMap<>();
    }
}
