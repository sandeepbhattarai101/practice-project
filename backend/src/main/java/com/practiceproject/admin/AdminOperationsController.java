package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.booking.Booking;
import com.practiceproject.booking.BookingAccess;
import com.practiceproject.booking.BookingRepository;
import com.practiceproject.booking.BookingService;
import com.practiceproject.booking.BookingView;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import com.practiceproject.ticket.TicketService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Day-to-day cinema operations. Open to ADMIN and CINEMA_MANAGER (SecurityConfig), with
 * every query narrowed by AdminScope to the cinemas a manager runs.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminOperationsController {

    public record SalesRequest(boolean salesOpen) {}

    public record ReasonRequest(@NotBlank @Size(max = 300) String reason) {}

    public record StaffCancelRequest(@NotBlank @Size(max = 300) String reason, @NotNull @Min(0) @Max(100) Integer refundPercent) {}

    public record CodeRequest(@NotBlank @Size(max = 100) String code) {}

    public record CheckinResult(String result, BookingView.BookingDto booking) {}

    public record AdminBookingRow(String reference, Booking.Status status, String customerName, String customerEmail,
                                  String movieTitle, String cinemaName, Instant startsAt, String timezone, List<String> seatLabels,
                                  long totalMinor, Instant createdAt) {}

    private final AdminScope scope;
    private final ReportService reports;
    private final ShowtimeAdminService showtimes;
    private final BookingRepository bookingRepository;
    private final BookingService bookings;
    private final BookingView view;
    private final BookingAccess access;
    private final TicketService tickets;
    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public AdminOperationsController(AdminScope scope, ReportService reports, ShowtimeAdminService showtimes,
                                     BookingRepository bookingRepository, BookingService bookings, BookingView view,
                                     BookingAccess access, TicketService tickets, JdbcTemplate jdbc, AuditService audit) {
        this.scope = scope;
        this.reports = reports;
        this.showtimes = showtimes;
        this.bookingRepository = bookingRepository;
        this.bookings = bookings;
        this.view = view;
        this.access = access;
        this.tickets = tickets;
        this.jdbc = jdbc;
        this.audit = audit;
    }

    // ------------------------------------------------------------------ lookups & dashboard

    @GetMapping("/lookups")
    public Map<String, Object> lookups() {
        String cinemaScope = AdminScope.sqlArray(scope.cinemaIds());
        var cities = jdbc.queryForList("select id, name, slug, is_default as \"isDefault\" from cities order by sort_order");
        List<Map<String, Object>> cinemas = new ArrayList<>();
        for (var c : jdbc.queryForList("""
                select c.id, c.name, ci.slug as "citySlug", ci.timezone from cinemas c join cities ci on ci.id = c.city_id
                where (?::bigint[] is null or c.id = any(?::bigint[])) order by c.name
                """, cinemaScope, cinemaScope)) {
            List<Map<String, Object>> halls = new ArrayList<>();
            jdbc.query("select id, name, formats from auditoriums where cinema_id = ? and is_active order by name", rs -> {
                Long hallId = rs.getLong(1);
                halls.add(Map.of("id", hallId, "name", rs.getString(2), "formats", List.of((String[]) rs.getArray(3).getArray()),
                        "categories", jdbc.queryForList(
                                "select id, code, name from seat_categories where auditorium_id = ? order by sort_order, id", hallId)));
            }, c.get("id"));
            var copy = new java.util.LinkedHashMap<>(c);
            copy.put("auditoriums", halls);
            cinemas.add(copy);
        }
        var movies = jdbc.query("select id, title, languages, runtime_minutes, status from movies where status <> 'ARCHIVED' order by title",
                (rs, i) -> Map.of("id", rs.getLong(1), "title", rs.getString(2), "languages", List.of((String[]) rs.getArray(3).getArray()),
                        "runtimeMinutes", rs.getInt(4), "status", rs.getString(5)));
        return Map.of("cities", cities, "cinemas", cinemas, "movies", movies);
    }

    @GetMapping("/dashboard")
    public ReportService.Dashboard dashboard(@RequestParam(required = false) Long cinemaId) {
        return reports.dashboard(scope.narrow(cinemaId));
    }

    // ------------------------------------------------------------------ showtimes

    @GetMapping("/showtimes")
    public PageResponse<ShowtimeAdminService.AdminShowtime> showtimes(
            @RequestParam(required = false) Long cinemaId, @RequestParam(required = false) Long movieId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String status, @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return showtimes.list(cinemaId, movieId, from, to, status, PageResponse.clampPage(page), PageResponse.clampSize(size));
    }

    @PostMapping("/showtimes")
    public ShowtimeAdminService.AdminShowtime createShowtime(@Valid @RequestBody ShowtimeAdminService.ShowtimeInput body) {
        return showtimes.create(body);
    }

    @PostMapping("/showtimes/bulk")
    public ShowtimeAdminService.BulkResult bulk(@Valid @RequestBody ShowtimeAdminService.BulkInput body) {
        return showtimes.bulk(body);
    }

    @PutMapping("/showtimes/{id}")
    public ShowtimeAdminService.AdminShowtime updateShowtime(@PathVariable Long id, @Valid @RequestBody ShowtimeAdminService.ShowtimeInput body) {
        return showtimes.update(id, body);
    }

    @PostMapping("/showtimes/{id}/sales")
    public ShowtimeAdminService.AdminShowtime sales(@PathVariable Long id, @RequestBody SalesRequest body) {
        return showtimes.setSales(id, body.salesOpen());
    }

    @PostMapping("/showtimes/{id}/cancel")
    public ShowtimeAdminService.AdminShowtime cancelShowtime(@PathVariable Long id, @Valid @RequestBody ReasonRequest body) {
        return showtimes.cancel(id, body.reason().trim());
    }

    // ------------------------------------------------------------------ bookings

    @GetMapping("/bookings")
    public PageResponse<AdminBookingRow> bookings(@RequestParam(required = false) String q,
                                                  @RequestParam(required = false) String status,
                                                  @RequestParam(required = false) Long cinemaId,
                                                  @RequestParam(required = false) Long showtimeId,
                                                  @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                  @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                  @RequestParam(required = false) Integer page,
                                                  @RequestParam(required = false) Integer size) {
        int p = PageResponse.clampPage(page);
        int s = PageResponse.clampSize(size);
        String cinemas = AdminScope.sqlArray(scope.narrow(cinemaId));
        String like = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase().replace("%", "\\%").replace("_", "\\_") + "%";
        String st = status == null || status.isBlank() ? null : status;
        String base = """
                from bookings b
                join showtimes s on s.id = b.showtime_id join movies m on m.id = s.movie_id
                join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id join cities ci on ci.id = c.city_id
                where (?::bigint[] is null or a.cinema_id = any(?::bigint[]))
                  and (?::text is null or lower(b.reference) like ? or lower(b.customer_email) like ? or lower(b.customer_name) like ?)
                  and (?::text is null or b.status = ?)
                  and (?::bigint is null or b.showtime_id = ?)
                  and (?::date is null or (b.created_at at time zone 'Asia/Kathmandu')::date >= ?)
                  and (?::date is null or (b.created_at at time zone 'Asia/Kathmandu')::date <= ?)
                """;
        Object[] args = {cinemas, cinemas, like, like, like, like, st, st, showtimeId, showtimeId, from, from, to, to};
        Long total = jdbc.queryForObject("select count(*) " + base, Long.class, args);
        List<Object> pageArgs = new ArrayList<>(java.util.Arrays.asList(args)); // asList, not List.of: filter values may be null
        pageArgs.add(s);
        pageArgs.add((long) p * s);
        List<AdminBookingRow> rows = jdbc.query("""
                select b.reference, b.status, b.customer_name, b.customer_email, m.title, c.name, s.starts_at, ci.timezone,
                       array(select bi.seat_label from booking_items bi where bi.booking_id = b.id order by bi.seat_label),
                       b.total_minor, b.created_at
                """ + base + " order by b.created_at desc limit ? offset ?", (rs, i) -> new AdminBookingRow(rs.getString(1),
                Booking.Status.valueOf(rs.getString(2)), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getTimestamp(7).toInstant(), rs.getString(8), List.of((String[]) rs.getArray(9).getArray()), rs.getLong(10),
                rs.getTimestamp(11).toInstant()), pageArgs.toArray());
        return PageResponse.of(rows, p, s, total == null ? 0 : total);
    }

    @GetMapping("/bookings/{reference}")
    public BookingView.AdminBookingDto booking(@PathVariable String reference) {
        Booking b = bookingRepository.findByReference(reference).orElseThrow(() -> ApiException.notFound("Booking"));
        access.staff().require(b);
        return view.buildAdmin(b);
    }

    @PostMapping("/bookings/{reference}/cancel")
    public BookingView.AdminBookingDto cancelBooking(@PathVariable String reference, @Valid @RequestBody StaffCancelRequest body) {
        Booking b = bookings.cancelByStaff(reference, body.reason().trim(), body.refundPercent(), access.staff());
        return view.buildAdmin(bookingRepository.findById(b.getId()).orElseThrow());
    }

    @PostMapping("/bookings/{reference}/resend")
    public ResponseEntity<Void> resend(@PathVariable String reference) {
        bookings.resendConfirmation(reference, access.staff());
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------------------ check-in

    @PostMapping("/checkin/lookup")
    public CheckinResult checkinLookup(@Valid @RequestBody CodeRequest body) {
        return checkin(body.code(), false);
    }

    @PostMapping("/checkin/confirm")
    @Transactional
    public CheckinResult checkinConfirm(@Valid @RequestBody CodeRequest body) {
        return checkin(body.code(), true);
    }

    private CheckinResult checkin(String code, boolean admit) {
        var parsed = tickets.parse(code);
        if (parsed.isEmpty()) {
            return new CheckinResult("INVALID", null);
        }
        var found = admit ? bookingRepository.lockByReference(parsed.get().reference())
                : bookingRepository.findByReference(parsed.get().reference());
        if (found.isEmpty() || found.get().getTicketCode() == null
                || !com.practiceproject.common.Tokens.constantTimeEquals(found.get().getTicketCode(), parsed.get().ticketCode())) {
            return new CheckinResult("INVALID", null);
        }
        Booking b = found.get();
        access.staff().require(b); // a manager can only admit at their own cinemas
        if (b.getStatus() != Booking.Status.CONFIRMED) {
            return new CheckinResult("NOT_CONFIRMED", view.build(b));
        }
        if (b.getCheckedInAt() != null) {
            return new CheckinResult("ALREADY_CHECKED_IN", view.build(b));
        }
        var show = jdbc.queryForMap("""
                select s.starts_at, s.ends_at, ci.timezone from showtimes s join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id join cities ci on ci.id = c.city_id where s.id = ?
                """, b.getShowtimeId());
        ZoneId zone = ZoneId.of((String) show.get("timezone"));
        LocalDate showDay = ((java.sql.Timestamp) show.get("starts_at")).toInstant().atZone(zone).toLocalDate();
        boolean ended = ((java.sql.Timestamp) show.get("ends_at")).toInstant().isBefore(Instant.now());
        if (!showDay.equals(LocalDate.now(zone)) || ended) {
            return new CheckinResult("WRONG_DAY", view.build(b));
        }
        if (admit) {
            b.setCheckedInAt(Instant.now());
            bookingRepository.saveAndFlush(b);
            audit.record("booking.checked_in", "booking", b.getReference(), Map.of());
        }
        return new CheckinResult("VALID", view.build(b));
    }

    // ------------------------------------------------------------------ reports

    @GetMapping("/reports/sales")
    public ReportService.SalesReport sales(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                           @RequestParam(required = false) String groupBy,
                                           @RequestParam(required = false) Long cinemaId) {
        return reports.sales(from, to, groupBy, scope.narrow(cinemaId));
    }

    @GetMapping(value = "/reports/sales.csv")
    public ResponseEntity<String> salesCsv(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                           @RequestParam(required = false) String groupBy,
                                           @RequestParam(required = false) Long cinemaId) {
        return csv("sales-report.csv", reports.salesCsv(reports.sales(from, to, groupBy, scope.narrow(cinemaId))));
    }

    @GetMapping("/reports/occupancy")
    public ReportService.OccupancyReport occupancy(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                   @RequestParam(required = false) Long cinemaId) {
        return reports.occupancy(from, to, scope.narrow(cinemaId));
    }

    @GetMapping("/reports/occupancy.csv")
    public ResponseEntity<String> occupancyCsv(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                               @RequestParam(required = false) Long cinemaId) {
        return csv("occupancy-report.csv", reports.occupancyCsv(reports.occupancy(from, to, scope.narrow(cinemaId))));
    }

    static ResponseEntity<String> csv(String filename, String body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                .body("﻿" + body); // byte-order mark so Excel reads UTF-8 (Rs., em dashes) correctly
    }
}
