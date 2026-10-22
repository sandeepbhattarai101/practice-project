package com.practiceproject.catalog;

import com.practiceproject.catalog.CatalogDtos.CinemaCard;
import com.practiceproject.catalog.CatalogDtos.CinemaOption;
import com.practiceproject.catalog.CatalogDtos.CityDto;
import com.practiceproject.catalog.CatalogDtos.FilterOptions;
import com.practiceproject.catalog.CatalogDtos.MovieCard;
import com.practiceproject.catalog.CatalogDtos.PromotionDto;
import com.practiceproject.catalog.CatalogDtos.ShowtimeChip;
import com.practiceproject.catalog.CatalogDtos.Suggestion;
import com.practiceproject.common.PageResponse;
import com.practiceproject.config.AppProperties;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Read-side SQL for the public catalogue. Written as plain SQL on purpose: these queries
 * aggregate across five tables, and SQL states that more clearly than an ORM would.
 *
 * Patterns to look for:
 * <ul>
 *   <li>{@code LEFT JOIN LATERAL}: a subquery that runs once per outer row and may use its columns.</li>
 *   <li>{@code cast(:p as bigint) is null or col = :p}: an optional filter in one static query.</li>
 *   <li>{@code (starts_at at time zone tz)::date}: "which calendar day is this in Kathmandu?".</li>
 *   <li>Chips for many movies are fetched in ONE query and grouped in Java, avoiding N+1 queries.</li>
 * </ul>
 */
@Repository
public class CatalogQueries {

    public record MovieFilter(Long cityId, String q, String genre, String language, String format, String cinemaSlug,
                              String when, LocalDate date, String sort) {}

    public record ChipFilter(Long movieId, Long cinemaId, Long cityId, LocalDate date, Collection<Long> movieIds) {}

    private static final String MOVIE_CARD_SELECT = """
            select m.id, m.slug, m.title, m.tagline, m.poster_url, m.backdrop_url, m.trailer_url, m.runtime_minutes,
                   m.release_date, m.certification, m.languages, m.genres, m.is_sample_data,
                   coalesce(f.formats, '{}') as formats,
                   (f.formats is not null) as has_shows,
                   (m.release_date > (now() at time zone :tz)::date) as is_upcoming
            from movies m
            left join lateral (
                select array_agg(distinct s.format order by s.format) as formats
                from showtimes s
                join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id
                where s.movie_id = m.id and s.status = 'SCHEDULED' and s.starts_at > now()
                  and c.status = 'ACTIVE'
                  and (cast(:cityId as bigint) is null or c.city_id = :cityId)
            ) f on true
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final AppProperties props;

    public CatalogQueries(NamedParameterJdbcTemplate jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    // ------------------------------------------------------------------ cities

    public List<CityDto> cities() {
        return jdbc.query("select id, name, slug, is_default from cities order by sort_order, name",
                (rs, i) -> new CityDto(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)));
    }

    /** The city named by slug, else the default city, else the first one. */
    public Optional<City> resolveCity(String slug, CatalogRepositories.CityRepository cities) {
        if (slug != null && !slug.isBlank()) {
            var found = cities.findBySlug(slug);
            if (found.isPresent()) {
                return found;
            }
        }
        return cities.findAll().stream()
                .sorted((a, b) -> Boolean.compare(b.isDefault(), a.isDefault()) != 0
                        ? Boolean.compare(b.isDefault(), a.isDefault())
                        : Integer.compare(a.getSortOrder(), b.getSortOrder()))
                .findFirst();
    }

    // ------------------------------------------------------------------ movies

    public PageResponse<MovieCard> movies(MovieFilter f, String tz, int page, int size) {
        var params = new MapSqlParameterSource().addValue("cityId", f.cityId()).addValue("tz", tz);
        List<String> where = new ArrayList<>(List.of("m.status = 'PUBLISHED'"));

        String when = f.when() == null ? "now" : f.when();
        switch (when) {
            case "upcoming" -> where.add("m.release_date > (now() at time zone :tz)::date");
            case "all" -> { }
            default -> where.add("m.release_date <= (now() at time zone :tz)::date and f.formats is not null");
        }
        if (notBlank(f.genre())) {
            where.add(":genre = any(m.genres)");
            params.addValue("genre", f.genre());
        }
        if (notBlank(f.language())) {
            where.add(":language = any(m.languages)");
            params.addValue("language", f.language());
        }
        if (notBlank(f.q())) {
            // websearch_to_tsquery understands user-style input ("dragon -cartoon"), and the LIKE
            // catches partial words the full-text index would miss.
            where.add("(m.search_vector @@ websearch_to_tsquery('simple', :q) or lower(m.title) like :qLike escape '\\')");
            params.addValue("q", f.q().trim()).addValue("qLike", "%" + escapeLike(f.q().trim().toLowerCase()) + "%");
        }
        if (notBlank(f.format()) || notBlank(f.cinemaSlug()) || f.date() != null) {
            where.add("""
                    exists (
                        select 1 from showtimes s
                        join auditoriums a on a.id = s.auditorium_id
                        join cinemas c on c.id = a.cinema_id
                        join cities ci on ci.id = c.city_id
                        where s.movie_id = m.id and s.status = 'SCHEDULED' and s.starts_at > now() and c.status = 'ACTIVE'
                          and (cast(:cityId as bigint) is null or c.city_id = :cityId)
                          and (cast(:format as text) is null or s.format = :format)
                          and (cast(:cinema as text) is null or c.slug = :cinema)
                          and (cast(:date as date) is null or (s.starts_at at time zone ci.timezone)::date = :date)
                    )""");
            params.addValue("format", blankToNull(f.format())).addValue("cinema", blankToNull(f.cinemaSlug()))
                    .addValue("date", f.date());
        }

        String orderBy = switch (f.sort() == null ? "popular" : f.sort()) {
            case "title" -> "m.title asc";
            case "release" -> "upcoming".equals(when) ? "m.release_date asc, m.title" : "m.release_date desc, m.title";
            default -> "upcoming".equals(when)
                    ? "m.release_date asc, m.title"
                    : "coalesce(pop.tickets, 0) desc, m.is_featured desc, m.release_date desc, m.title";
        };

        String whereSql = " where " + String.join(" and ", where);
        long total = jdbc.queryForObject("select count(*) from (" + MOVIE_CARD_SELECT + whereSql + ") x", params, Long.class);

        params.addValue("limit", size).addValue("offset", (long) page * size);
        String sql = MOVIE_CARD_SELECT + """
                left join lateral (
                    select count(*) as tickets
                    from bookings b
                    join showtimes s2 on s2.id = b.showtime_id
                    join booking_items bi on bi.booking_id = b.id
                    where s2.movie_id = m.id and b.status = 'CONFIRMED' and b.confirmed_at > now() - interval '14 days'
                ) pop on true
                """ + whereSql + " order by " + orderBy + " limit :limit offset :offset";
        return PageResponse.of(jdbc.query(sql, params, movieCardMapper()), page, size, total);
    }

    public List<MovieCard> featured(Long cityId, String tz, int limit) {
        var params = new MapSqlParameterSource().addValue("cityId", cityId).addValue("tz", tz).addValue("limit", limit);
        return jdbc.query(MOVIE_CARD_SELECT + """
                where m.status = 'PUBLISHED' and m.is_featured
                  and (f.formats is not null or m.release_date > (now() at time zone :tz)::date)
                order by (f.formats is not null) desc, m.release_date desc
                limit :limit
                """, params, movieCardMapper());
    }

    public List<MovieCard> cardsByIds(Collection<Long> ids, Long cityId, String tz) {
        if (ids.isEmpty()) {
            return List.of();
        }
        var params = new MapSqlParameterSource().addValue("cityId", cityId).addValue("tz", tz).addValue("ids", ids);
        return jdbc.query(MOVIE_CARD_SELECT + " where m.id in (:ids)", params, movieCardMapper());
    }

    public Optional<MovieCard> cardBySlug(String slug, Long cityId, String tz, boolean publishedOnly) {
        var params = new MapSqlParameterSource().addValue("cityId", cityId).addValue("tz", tz).addValue("slug", slug);
        String extra = publishedOnly ? " and m.status = 'PUBLISHED'" : "";
        return jdbc.query(MOVIE_CARD_SELECT + " where m.slug = :slug" + extra, params, movieCardMapper()).stream().findFirst();
    }

    public List<MovieCard> related(Long movieId, List<String> genres, Long cityId, String tz) {
        var params = new MapSqlParameterSource().addValue("cityId", cityId).addValue("tz", tz)
                .addValue("movieId", movieId).addValue("genres", genres.toArray(String[]::new));
        // "&&" on arrays means "overlaps": shares at least one genre. cardinality() counts how many.
        return jdbc.query(MOVIE_CARD_SELECT + """
                where m.status = 'PUBLISHED' and m.id <> :movieId
                  and (f.formats is not null or m.release_date > (now() at time zone :tz)::date)
                order by cardinality(array(select unnest(m.genres) intersect select unnest(cast(:genres as text[])))) desc,
                         m.release_date desc
                limit 8
                """, params, movieCardMapper());
    }

    public List<Suggestion> suggest(String q) {
        String term = q.trim().toLowerCase();
        var params = new MapSqlParameterSource().addValue("q", term)
                .addValue("like", "%" + escapeLike(term) + "%").addValue("prefix", escapeLike(term) + "%");
        // similarity() comes from pg_trgm: "Dragn" still finds "Dragon" (typo tolerance).
        return jdbc.query("""
                select slug, title, poster_url, release_date, genres
                from movies m
                where status = 'PUBLISHED'
                  and (lower(title) like :like escape '\\' or similarity(lower(title), :q) > 0.2
                       or search_vector @@ websearch_to_tsquery('simple', :q))
                order by (lower(title) like :prefix escape '\\') desc, similarity(lower(title), :q) desc, release_date desc
                limit 8
                """, params, (rs, i) -> new Suggestion(rs.getString(1), rs.getString(2), props.absoluteUrl(rs.getString(3)),
                rs.getObject(4, LocalDate.class), strings(rs.getArray(5))));
    }

    public FilterOptions filterOptions(Long cityId) {
        var params = new MapSqlParameterSource().addValue("cityId", cityId);
        List<String> genres = jdbc.queryForList(
                "select distinct g from movies, unnest(genres) g where status = 'PUBLISHED' order by g", params, String.class);
        List<String> languages = jdbc.queryForList(
                "select distinct l from movies, unnest(languages) l where status = 'PUBLISHED' order by l", params, String.class);
        List<String> formats = jdbc.queryForList("""
                select distinct s.format from showtimes s
                join auditoriums a on a.id = s.auditorium_id join cinemas c on c.id = a.cinema_id
                where s.status = 'SCHEDULED' and s.starts_at > now() and c.status = 'ACTIVE'
                  and (cast(:cityId as bigint) is null or c.city_id = :cityId)
                order by 1
                """, params, String.class);
        List<CinemaOption> cinemas = jdbc.query("""
                select slug, name from cinemas where status = 'ACTIVE' and (cast(:cityId as bigint) is null or city_id = :cityId)
                order by name
                """, params, (rs, i) -> new CinemaOption(rs.getString(1), rs.getString(2)));
        return new FilterOptions(genres, languages, formats, cinemas);
    }

    // ------------------------------------------------------------------ cinemas

    private static final String CINEMA_SELECT = """
            select c.id, c.slug, c.name, c.address, ci.name as city_name, ci.slug as city_slug, c.image_url, c.facilities,
                   coalesce((select array_agg(distinct f order by f)
                             from auditoriums a, unnest(a.formats) f
                             where a.cinema_id = c.id and a.is_active), '{}') as formats,
                   c.phone, c.latitude, c.longitude, ci.timezone, c.description
            from cinemas c
            join cities ci on ci.id = c.city_id
            """;

    public List<CinemaCard> cinemas(Long cityId, String q, String format) {
        var params = new MapSqlParameterSource().addValue("cityId", cityId)
                .addValue("q", notBlank(q) ? "%" + escapeLike(q.trim().toLowerCase()) + "%" : null)
                .addValue("format", blankToNull(format));
        return jdbc.query(CINEMA_SELECT + """
                where c.status = 'ACTIVE'
                  and (cast(:cityId as bigint) is null or c.city_id = :cityId)
                  and (cast(:q as text) is null or lower(c.name) like :q escape '\\' or lower(c.address) like :q escape '\\')
                  and (cast(:format as text) is null or exists (
                        select 1 from auditoriums a where a.cinema_id = c.id and a.is_active and :format = any(a.formats)))
                order by c.name
                """, params, cinemaMapper());
    }

    public Optional<CinemaCard> cinemaBySlug(String slug) {
        return jdbc.query(CINEMA_SELECT + " where c.slug = :slug and c.status = 'ACTIVE'",
                new MapSqlParameterSource("slug", slug), cinemaMapper()).stream().findFirst();
    }

    public Optional<CinemaCard> cinemaById(Long id) {
        return jdbc.query(CINEMA_SELECT + " where c.id = :id", new MapSqlParameterSource("id", id), cinemaMapper())
                .stream().findFirst();
    }

    public String cinemaDescription(Long cinemaId) {
        return jdbc.queryForList("select description from cinemas where id = :id", new MapSqlParameterSource("id", cinemaId),
                String.class).stream().findFirst().orElse(null);
    }

    public List<CatalogDtos.AuditoriumSummary> auditoriums(Long cinemaId) {
        return jdbc.query("""
                select a.id, a.name, a.formats, (select count(*) from seats s where s.auditorium_id = a.id and s.is_active)
                from auditoriums a where a.cinema_id = :id and a.is_active order by a.name
                """, new MapSqlParameterSource("id", cinemaId),
                (rs, i) -> new CatalogDtos.AuditoriumSummary(rs.getLong(1), rs.getString(2), strings(rs.getArray(3)), rs.getInt(4)));
    }

    // ------------------------------------------------------------------ showtimes

    /** A chip plus the ids we group by. */
    public record ChipRow(Long movieId, Long cinemaId, ShowtimeChip chip) {}

    public List<ChipRow> chips(ChipFilter f, int salesCloseMinutes) {
        var params = new MapSqlParameterSource()
                .addValue("movieId", f.movieId()).addValue("cinemaId", f.cinemaId()).addValue("cityId", f.cityId())
                .addValue("date", f.date()).addValue("closeMinutes", salesCloseMinutes)
                .addValue("hasMovieIds", f.movieIds() != null)
                .addValue("movieIds", f.movieIds() == null || f.movieIds().isEmpty() ? List.of(-1L) : f.movieIds());
        return jdbc.query("""
                select s.id, s.movie_id, c.id as cinema_id, s.starts_at, s.format, s.language,
                       c.slug, c.name, a.name as auditorium_name, ci.timezone,
                       cap.total, tk.taken, coalesce(pr.min_price, 0), coalesce(pr.max_price, 0),
                       (s.sales_open and s.starts_at - make_interval(mins => :closeMinutes) > now()) as sales_open
                from showtimes s
                join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id
                join cities ci on ci.id = c.city_id
                join movies mv on mv.id = s.movie_id and mv.status = 'PUBLISHED'
                join lateral (select count(*) as total from seats se where se.auditorium_id = a.id and se.is_active) cap on true
                join lateral (
                    -- A seat is taken if sold, or held by a hold that has not expired yet.
                    select count(*) as taken from seat_reservations r
                    where r.showtime_id = s.id and (r.status = 'BOOKED' or r.expires_at > now())
                ) tk on true
                join lateral (
                    select min(price_minor) as min_price, max(price_minor) as max_price
                    from showtime_prices p where p.showtime_id = s.id
                ) pr on true
                where s.status = 'SCHEDULED' and s.starts_at > now() and c.status = 'ACTIVE'
                  and (cast(:movieId as bigint) is null or s.movie_id = :movieId)
                  and (cast(:cinemaId as bigint) is null or c.id = :cinemaId)
                  and (cast(:cityId as bigint) is null or c.city_id = :cityId)
                  and (cast(:date as date) is null or (s.starts_at at time zone ci.timezone)::date = :date)
                  and (not :hasMovieIds or s.movie_id in (:movieIds))
                order by c.name, s.starts_at
                """, params, (rs, i) -> {
            int total = rs.getInt(11);
            int available = Math.max(0, total - rs.getInt(12));
            String availability = available == 0 ? "SOLD_OUT"
                    : total > 0 && available <= total * 0.25 ? "FILLING_FAST" : "AVAILABLE";
            var chip = new ShowtimeChip(rs.getLong(1), rs.getTimestamp(4).toInstant(), rs.getString(5), rs.getString(6),
                    rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), available, total, availability,
                    rs.getLong(13), rs.getLong(14), rs.getBoolean(15) && available > 0);
            return new ChipRow(rs.getLong(2), rs.getLong(3), chip);
        });
    }

    /** Calendar days (in the cinema's timezone) that still have shows. */
    public List<LocalDate> showDates(Long movieId, Long cinemaId, Long cityId) {
        var params = new MapSqlParameterSource().addValue("movieId", movieId).addValue("cinemaId", cinemaId)
                .addValue("cityId", cityId);
        return jdbc.queryForList("""
                select distinct (s.starts_at at time zone ci.timezone)::date as d
                from showtimes s
                join auditoriums a on a.id = s.auditorium_id
                join cinemas c on c.id = a.cinema_id
                join cities ci on ci.id = c.city_id
                join movies m on m.id = s.movie_id and m.status = 'PUBLISHED'
                where s.status = 'SCHEDULED' and s.starts_at > now() and c.status = 'ACTIVE'
                  and (cast(:movieId as bigint) is null or s.movie_id = :movieId)
                  and (cast(:cinemaId as bigint) is null or c.id = :cinemaId)
                  and (cast(:cityId as bigint) is null or c.city_id = :cityId)
                order by d
                limit 21
                """, params, LocalDate.class);
    }

    // ------------------------------------------------------------------ promotions

    public List<PromotionDto> promotions() {
        return jdbc.query("""
                select id, title, subtitle, image_url, cta_label, cta_url, coupon_code from promotions
                where is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
                order by sort_order, id
                """, (rs, i) -> new PromotionDto(rs.getLong(1), rs.getString(2), rs.getString(3),
                props.absoluteUrl(rs.getString(4)), rs.getString(5), rs.getString(6), rs.getString(7)));
    }

    // ------------------------------------------------------------------ mappers

    private RowMapper<MovieCard> movieCardMapper() {
        return (rs, i) -> {
            boolean upcoming = rs.getBoolean("is_upcoming");
            boolean hasShows = rs.getBoolean("has_shows");
            String showing = upcoming ? "UPCOMING" : hasShows ? "NOW_SHOWING" : "NOT_SCHEDULED";
            return new MovieCard(rs.getLong("id"), rs.getString("slug"), rs.getString("title"), rs.getString("tagline"),
                    props.absoluteUrl(rs.getString("poster_url")), props.absoluteUrl(rs.getString("backdrop_url")),
                    rs.getString("trailer_url"), rs.getInt("runtime_minutes"), rs.getObject("release_date", LocalDate.class),
                    rs.getString("certification"), strings(rs.getArray("languages")), strings(rs.getArray("genres")),
                    strings(rs.getArray("formats")), showing, rs.getBoolean("is_sample_data"));
        };
    }

    private RowMapper<CinemaCard> cinemaMapper() {
        return (rs, i) -> new CinemaCard(rs.getLong("id"), rs.getString("slug"), rs.getString("name"),
                rs.getString("address"), rs.getString("city_name"), rs.getString("city_slug"),
                props.absoluteUrl(rs.getString("image_url")), strings(rs.getArray("facilities")),
                strings(rs.getArray("formats")), rs.getString("phone"), rs.getBigDecimal("latitude"),
                rs.getBigDecimal("longitude"), directionsUrl(rs), rs.getString("timezone"));
    }

    private static String directionsUrl(ResultSet rs) throws SQLException {
        var lat = rs.getBigDecimal("latitude");
        var lng = rs.getBigDecimal("longitude");
        String destination = lat != null && lng != null
                ? lat.toPlainString() + "," + lng.toPlainString()
                : rs.getString("name") + ", " + rs.getString("address");
        return "https://www.google.com/maps/dir/?api=1&destination=" + URLEncoder.encode(destination, StandardCharsets.UTF_8);
    }

    static List<String> strings(Array array) throws SQLException {
        if (array == null) {
            return List.of();
        }
        return Arrays.asList((String[]) array.getArray());
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String blankToNull(String s) {
        return notBlank(s) ? s.trim() : null;
    }

    /** Stops "%" or "_" typed by a user acting as LIKE wildcards. */
    static String escapeLike(String s) {
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
