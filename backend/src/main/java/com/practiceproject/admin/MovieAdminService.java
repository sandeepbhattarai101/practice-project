package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.catalog.CatalogRepositories.MovieRepository;
import com.practiceproject.catalog.Movie;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MovieAdminService {

    public record CastInput(@NotBlank @Size(max = 120) String name, @Size(max = 120) String character) {}

    public record MovieInput(
            @NotBlank @Size(max = 200) String title,
            @Size(max = 120) @Pattern(regexp = "^[a-z0-9-]*$", message = "Lower-case letters, digits and hyphens only") String slug,
            @Size(max = 200) String tagline,
            @Size(max = 5000) String synopsis,
            @NotNull @Min(1) @Max(600) Integer runtimeMinutes,
            @NotNull LocalDate releaseDate,
            @NotBlank @Size(max = 10) String certification,
            @NotNull @Size(max = 10) List<@NotBlank @Size(max = 40) String> languages,
            @NotNull @Size(max = 10) List<@NotBlank @Size(max = 40) String> genres,
            @Size(max = 120) String director,
            @Size(max = 40) List<@Valid CastInput> cast,
            @Size(max = 500) @Pattern(regexp = "^(https?://.*|/.*)?$", message = "Must be an http(s) URL") String trailerUrl,
            @Size(max = 1000) @Pattern(regexp = "^(https?://.*|/.*)?$", message = "Must be an http(s) URL") String posterUrl,
            @Size(max = 1000) @Pattern(regexp = "^(https?://.*|/.*)?$", message = "Must be an http(s) URL") String backdropUrl,
            Movie.Status status,
            boolean isFeatured) {}

    public record AdminMovie(Long id, String slug, String title, String tagline, String synopsis, int runtimeMinutes,
                             LocalDate releaseDate, String certification, List<String> languages, List<String> genres,
                             String director, List<Movie.CastMember> cast, String trailerUrl, String posterUrl,
                             String backdropUrl, Movie.Status status, boolean isFeatured, Long tmdbId, boolean isSampleData,
                             Instant createdAt, Instant updatedAt, long showtimeCount) {}

    private final MovieRepository movies;
    private final NamedParameterJdbcTemplate jdbc;
    private final AuditService audit;
    private final AppProperties props;

    public MovieAdminService(MovieRepository movies, NamedParameterJdbcTemplate jdbc, AuditService audit, AppProperties props) {
        this.movies = movies;
        this.jdbc = jdbc;
        this.audit = audit;
        this.props = props;
    }

    @Transactional(readOnly = true)
    public PageResponse<AdminMovie> list(String q, String status, int page, int size) {
        var params = new MapSqlParameterSource()
                .addValue("q", q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase() + "%")
                .addValue("status", status == null || status.isBlank() ? null : status)
                .addValue("limit", size).addValue("offset", (long) page * size);
        String where = " where (cast(:q as text) is null or lower(title) like :q) and (cast(:status as text) is null or status = :status)";
        long total = jdbc.queryForObject("select count(*) from movies" + where, params, Long.class);
        List<Long> ids = jdbc.queryForList("select id from movies" + where + " order by updated_at desc limit :limit offset :offset",
                params, Long.class);
        return PageResponse.of(ids.stream().map(this::get).toList(), page, size, total);
    }

    @Transactional(readOnly = true)
    public AdminMovie get(Long id) {
        Movie m = movies.findById(id).orElseThrow(() -> ApiException.notFound("Movie"));
        long shows = jdbc.queryForObject("select count(*) from showtimes where movie_id = :id", Map.of("id", id), Long.class);
        return new AdminMovie(m.getId(), m.getSlug(), m.getTitle(), m.getTagline(), m.getSynopsis(), m.getRuntimeMinutes(),
                m.getReleaseDate(), m.getCertification(), m.getLanguages(), m.getGenres(), m.getDirector(), m.getCastMembers(),
                m.getTrailerUrl(), props.absoluteUrl(m.getPosterUrl()), props.absoluteUrl(m.getBackdropUrl()), m.getStatus(),
                m.isFeatured(), m.getTmdbId(), m.isSampleData(), m.getCreatedAt(), m.getUpdatedAt(), shows);
    }

    @Transactional
    public AdminMovie create(MovieInput in) {
        var movie = new Movie();
        apply(movie, in, true);
        movies.saveAndFlush(movie);
        audit.record("movie.created", "movie", movie.getId(), Map.of("title", movie.getTitle()));
        return get(movie.getId());
    }

    @Transactional
    public AdminMovie update(Long id, MovieInput in) {
        Movie movie = movies.findById(id).orElseThrow(() -> ApiException.notFound("Movie"));
        apply(movie, in, false);
        movies.saveAndFlush(movie);
        audit.record("movie.updated", "movie", id, Map.of("title", movie.getTitle()));
        return get(id);
    }

    @Transactional
    public AdminMovie setStatus(Long id, Movie.Status status) {
        Movie movie = movies.findById(id).orElseThrow(() -> ApiException.notFound("Movie"));
        movie.setStatus(status);
        movies.saveAndFlush(movie);
        audit.record("movie.status", "movie", id, Map.of("status", status.name()));
        return get(id);
    }

    @Transactional
    public void delete(Long id) {
        Movie movie = movies.findById(id).orElseThrow(() -> ApiException.notFound("Movie"));
        long shows = jdbc.queryForObject("select count(*) from showtimes where movie_id = :id", Map.of("id", id), Long.class);
        if (shows > 0) {
            throw ApiException.conflict("MOVIE_HAS_SHOWTIMES", "This movie has showtimes, so it can't be deleted. Archive it instead.");
        }
        movies.delete(movie);
        audit.record("movie.deleted", "movie", id, Map.of("title", movie.getTitle()));
    }

    /** Creates or refreshes a DRAFT movie from TMDB data. */
    @Transactional
    public AdminMovie importFromTmdb(TmdbClient.TmdbMovie t) {
        Movie movie = movies.findByTmdbId(t.tmdbId()).orElseGet(Movie::new);
        boolean isNew = movie.getId() == null;
        movie.setTmdbId(t.tmdbId());
        movie.setTitle(t.title());
        if (isNew) {
            movie.setSlug(uniqueSlug(t.title(), null));
            movie.setStatus(Movie.Status.DRAFT);
        }
        movie.setTagline(t.tagline());
        movie.setSynopsis(t.overview() == null ? "" : t.overview());
        movie.setRuntimeMinutes(t.runtime() == null || t.runtime() <= 0 ? 120 : t.runtime());
        movie.setReleaseDate(t.releaseDate() == null ? LocalDate.now() : t.releaseDate());
        movie.setLanguages(t.languages().isEmpty() ? List.of("English") : t.languages());
        movie.setGenres(t.genres());
        movie.setDirector(t.director());
        movie.setCastMembers(t.cast());
        movie.setTrailerUrl(t.trailerUrl());
        movie.setPosterUrl(t.posterUrl());
        movie.setBackdropUrl(t.backdropUrl());
        movies.saveAndFlush(movie);
        audit.record("movie.tmdb_import", "movie", movie.getId(), Map.of("tmdbId", t.tmdbId()));
        return get(movie.getId());
    }

    private void apply(Movie m, MovieInput in, boolean creating) {
        m.setTitle(in.title().trim());
        String slug = in.slug() == null || in.slug().isBlank() ? null : in.slug();
        if (creating || slug != null) {
            m.setSlug(uniqueSlug(slug != null ? slug : in.title(), m.getId()));
        }
        m.setTagline(blank(in.tagline()));
        m.setSynopsis(in.synopsis() == null ? "" : in.synopsis().trim());
        m.setRuntimeMinutes(in.runtimeMinutes());
        m.setReleaseDate(in.releaseDate());
        m.setCertification(in.certification().trim());
        m.setLanguages(in.languages().stream().map(String::trim).distinct().toList());
        m.setGenres(in.genres().stream().map(String::trim).distinct().toList());
        m.setDirector(blank(in.director()));
        m.setCastMembers(in.cast() == null ? List.of()
                : in.cast().stream().map(c -> new Movie.CastMember(c.name().trim(), blank(c.character()))).toList());
        m.setTrailerUrl(blank(in.trailerUrl()));
        // Generated artwork for movies without images, so the catalogue never shows a broken image.
        String fallback = "/api/media/artwork/%s/" + m.getSlug() + ".svg?title="
                + java.net.URLEncoder.encode(m.getTitle(), java.nio.charset.StandardCharsets.UTF_8);
        m.setPosterUrl(blank(in.posterUrl()) != null ? in.posterUrl().trim() : fallback.formatted("poster"));
        m.setBackdropUrl(blank(in.backdropUrl()) != null ? in.backdropUrl().trim() : fallback.formatted("backdrop"));
        if (in.status() != null) {
            m.setStatus(in.status());
        }
        m.setFeatured(in.isFeatured());
    }

    private String uniqueSlug(String base, Long selfId) {
        String root = Tokens.slugify(base);
        String candidate = root;
        int n = 2;
        while (true) {
            var existing = movies.findBySlug(candidate);
            if (existing.isEmpty() || existing.get().getId().equals(selfId)) {
                return candidate;
            }
            candidate = root + "-" + n++;
        }
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
