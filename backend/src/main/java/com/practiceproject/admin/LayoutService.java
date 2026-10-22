package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.common.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seat layout editor backend. A layout is saved as a whole ("replace all seats") inside one
 * transaction: other requests see either the old layout or the new one, never half of each.
 */
@Service
public class LayoutService {

    public record CategoryInput(@NotBlank @Size(max = 20) @Pattern(regexp = "^[A-Z0-9_]+$", message = "Upper-case code") String code,
                                @NotBlank @Size(max = 40) String name,
                                @NotBlank @Pattern(regexp = "^#[0-9A-Fa-f]{6}$", message = "Hex colour like #F5B544") String color,
                                int sortOrder) {}

    public record SeatInput(@NotBlank @Size(max = 4) @Pattern(regexp = "^[A-Z]{1,3}$", message = "Row label A-ZZZ") String rowLabel,
                            @NotNull @Min(1) @Max(200) Integer seatNumber,
                            @NotNull @Min(1) Integer gridRow, @NotNull @Min(1) Integer gridCol,
                            @NotBlank String categoryCode,
                            @NotBlank @Pattern(regexp = "^(STANDARD|WHEELCHAIR|COMPANION|COUPLE)$") String seatType,
                            boolean isActive) {}

    public record LayoutInput(@NotNull @Min(1) @Max(60) Integer gridRows, @NotNull @Min(1) @Max(80) Integer gridCols,
                              @NotNull @Size(min = 1, max = 10) List<@Valid CategoryInput> categories,
                              @NotNull @Size(max = 2000) List<@Valid SeatInput> seats) {}

    public record AuditoriumInfo(Long id, Long cinemaId, String name, int gridRows, int gridCols, List<String> formats, boolean isActive) {}

    public record Layout(AuditoriumInfo auditorium, int gridRows, int gridCols, List<CategoryInput> categories,
                         List<SeatInput> seats, boolean locked) {}

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public LayoutService(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Layout get(Long auditoriumId) {
        AuditoriumInfo a = jdbc.query("select id, cinema_id, name, grid_rows, grid_cols, formats, is_active from auditoriums where id = ?",
                (rs, i) -> new AuditoriumInfo(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getInt(4), rs.getInt(5),
                        List.of((String[]) rs.getArray(6).getArray()), rs.getBoolean(7)), auditoriumId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound("Auditorium"));
        List<CategoryInput> categories = jdbc.query(
                "select code, name, color, sort_order from seat_categories where auditorium_id = ? order by sort_order, id",
                (rs, i) -> new CategoryInput(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4)), auditoriumId);
        List<SeatInput> seats = jdbc.query("""
                select s.row_label, s.seat_number, s.grid_row, s.grid_col, c.code, s.seat_type, s.is_active
                from seats s join seat_categories c on c.id = s.category_id
                where s.auditorium_id = ? and s.grid_row > 0 order by s.grid_row, s.grid_col
                """, (rs, i) -> new SeatInput(rs.getString(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getString(5),
                rs.getString(6), rs.getBoolean(7)), auditoriumId);
        return new Layout(a, a.gridRows(), a.gridCols(), categories, seats, isLocked(auditoriumId));
    }

    /** Locked while any future show in this hall has holds or sales: changing seats under them would corrupt bookings. */
    public boolean isLocked(Long auditoriumId) {
        Boolean locked = jdbc.queryForObject("""
                select exists (
                    select 1 from seat_reservations r join showtimes s on s.id = r.showtime_id
                    where s.auditorium_id = ? and s.ends_at > now()
                )""", Boolean.class, auditoriumId);
        return Boolean.TRUE.equals(locked);
    }

    @Transactional
    public Layout save(Long auditoriumId, LayoutInput in) {
        // Lock the auditorium row so two admins saving at once are applied one after the other.
        jdbc.queryForList("select id from auditoriums where id = ? for update", Long.class, auditoriumId).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Auditorium"));
        if (isLocked(auditoriumId)) {
            throw ApiException.conflict("LAYOUT_LOCKED",
                    "Upcoming shows in this auditorium already have holds or sales. Change the layout after they finish.");
        }
        validate(in);

        // Old bookings point at seat ids, so seats that were ever booked are deactivated rather than deleted.
        jdbc.update("""
                delete from seats s where s.auditorium_id = ?
                  and not exists (select 1 from booking_items bi where bi.seat_id = s.id)
                """, auditoriumId);
        // Remaining (historic) seats move off-grid so they can't collide with the new positions.
        jdbc.update("""
                update seats set is_active = false, grid_row = -id, grid_col = -id, row_label = 'ZZ' || id
                where auditorium_id = ?
                """, auditoriumId);

        Map<String, Long> categoryIds = new HashMap<>();
        Set<String> keepCodes = new HashSet<>();
        for (CategoryInput c : in.categories()) {
            keepCodes.add(c.code());
            Long id = jdbc.queryForObject("""
                    insert into seat_categories (auditorium_id, code, name, color, sort_order) values (?, ?, ?, ?, ?)
                    on conflict (auditorium_id, code) do update set name = excluded.name, color = excluded.color, sort_order = excluded.sort_order
                    returning id
                    """, Long.class, auditoriumId, c.code(), c.name().trim(), c.color(), c.sortOrder());
            categoryIds.put(c.code(), id);
        }
        jdbc.batchUpdate("""
                insert into seats (auditorium_id, category_id, row_label, seat_number, grid_row, grid_col, seat_type, is_active)
                values (?, ?, ?, ?, ?, ?, ?, ?)
                """, in.seats(), 500, (ps, s) -> {
            ps.setLong(1, auditoriumId);
            ps.setLong(2, categoryIds.get(s.categoryCode()));
            ps.setString(3, s.rowLabel());
            ps.setInt(4, s.seatNumber());
            ps.setInt(5, s.gridRow());
            ps.setInt(6, s.gridCol());
            ps.setString(7, s.seatType());
            ps.setBoolean(8, s.isActive());
        });
        // Unused categories go, unless historic seats or prices still reference them.
        jdbc.update("""
                delete from seat_categories c where c.auditorium_id = ? and not (c.code = any(?::text[]))
                  and not exists (select 1 from seats s where s.category_id = c.id)
                  and not exists (select 1 from showtime_prices p where p.seat_category_id = c.id)
                """, auditoriumId, "{" + String.join(",", keepCodes) + "}");
        jdbc.update("update auditoriums set grid_rows = ?, grid_cols = ? where id = ?", in.gridRows(), in.gridCols(), auditoriumId);
        // Future shows in this hall need a price for any new category; default to the cheapest existing price.
        jdbc.update("""
                insert into showtime_prices (showtime_id, seat_category_id, price_minor)
                select s.id, c.id, coalesce((select min(price_minor) from showtime_prices p where p.showtime_id = s.id), 0)
                from showtimes s cross join seat_categories c
                where s.auditorium_id = ? and c.auditorium_id = ? and s.starts_at > now()
                on conflict do nothing
                """, auditoriumId, auditoriumId);
        audit.record("auditorium.layout_saved", "auditorium", auditoriumId, Map.of("seats", in.seats().size()));
        return get(auditoriumId);
    }

    private static void validate(LayoutInput in) {
        Set<String> codes = new HashSet<>();
        for (CategoryInput c : in.categories()) {
            if (!codes.add(c.code())) {
                throw ApiException.badRequest("Duplicate category code " + c.code());
            }
        }
        Set<String> cells = new HashSet<>();
        Set<String> labels = new HashSet<>();
        for (SeatInput s : in.seats()) {
            if (!codes.contains(s.categoryCode())) {
                throw ApiException.badRequest("Seat " + s.rowLabel() + s.seatNumber() + " uses unknown category " + s.categoryCode());
            }
            if (s.gridRow() > in.gridRows() || s.gridCol() > in.gridCols()) {
                throw ApiException.badRequest("Seat " + s.rowLabel() + s.seatNumber() + " is outside the grid");
            }
            if (!cells.add(s.gridRow() + ":" + s.gridCol())) {
                throw ApiException.badRequest("Two seats share grid cell " + s.gridRow() + "," + s.gridCol());
            }
            if (!labels.add(s.rowLabel() + s.seatNumber())) {
                throw ApiException.badRequest("Seat label " + s.rowLabel() + s.seatNumber() + " is used twice");
            }
        }
    }
}
