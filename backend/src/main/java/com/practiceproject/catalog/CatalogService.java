package com.practiceproject.catalog;

import com.practiceproject.catalog.CatalogDtos.CastDto;
import com.practiceproject.catalog.CatalogDtos.CinemaCard;
import com.practiceproject.catalog.CatalogDtos.CinemaDetail;
import com.practiceproject.catalog.CatalogDtos.CinemaShowtimes;
import com.practiceproject.catalog.CatalogDtos.CityDto;
import com.practiceproject.catalog.CatalogDtos.Home;
import com.practiceproject.catalog.CatalogDtos.MovieCard;
import com.practiceproject.catalog.CatalogDtos.MovieDetail;
import com.practiceproject.catalog.CatalogDtos.MovieShowtimes;
import com.practiceproject.catalog.CatalogDtos.ShowtimeChip;
import com.practiceproject.catalog.CatalogQueries.ChipFilter;
import com.practiceproject.catalog.CatalogQueries.ChipRow;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import com.practiceproject.settings.SettingsService;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class CatalogService {

    private static final String DEFAULT_TZ = "Asia/Kathmandu";

    private final CatalogQueries queries;
    private final CatalogRepositories.CityRepository cities;
    private final CatalogRepositories.MovieRepository movies;
    private final SettingsService settings;

    public CatalogService(CatalogQueries queries, CatalogRepositories.CityRepository cities,
                          CatalogRepositories.MovieRepository movies, SettingsService settings) {
        this.queries = queries;
        this.cities = cities;
        this.movies = movies;
        this.settings = settings;
    }

    public List<CityDto> cities() {
        return queries.cities();
    }

    public Home home(String citySlug) {
        City city = cities(citySlug);
        String tz = city.getTimezone();
        int close = settings.booking().salesCloseMinutes();

        List<MovieCard> nowShowing = queries.movies(filter(city, "now", "popular"), tz, 0, 12).items();
        List<MovieCard> upcoming = queries.movies(filter(city, "upcoming", "release"), tz, 0, 12).items();
        List<MovieCard> featured = queries.featured(city.getId(), tz, 6);
        if (featured.isEmpty()) {
            featured = nowShowing.stream().limit(5).toList();
        }

        // Today's shows for the whole city in one query, then grouped by movie in memory.
        LocalDate today = LocalDate.now(ZoneId.of(tz));
        List<ChipRow> rows = queries.chips(new ChipFilter(null, null, city.getId(), today, null), close);
        Map<Long, List<ShowtimeChip>> byMovie = groupChips(rows, ChipRow::movieId);
        Map<Long, MovieCard> cards = queries.cardsByIds(byMovie.keySet(), city.getId(), tz).stream()
                .collect(Collectors.toMap(MovieCard::id, Function.identity()));
        List<MovieShowtimes> today_ = byMovie.entrySet().stream()
                .filter(e -> cards.containsKey(e.getKey()))
                .map(e -> new MovieShowtimes(cards.get(e.getKey()), e.getValue().stream()
                        .sorted((a, b) -> a.startsAt().compareTo(b.startsAt())).toList()))
                .limit(10)
                .toList();

        return new Home(toDto(city), featured, nowShowing, upcoming, queries.cinemas(city.getId(), null, null),
                queries.promotions(), today_);
    }

    public PageResponse<MovieCard> movies(CatalogQueries.MovieFilter filter, String citySlug, int page, int size) {
        City city = cities(citySlug);
        var f = new CatalogQueries.MovieFilter(city.getId(), filter.q(), filter.genre(), filter.language(), filter.format(),
                filter.cinemaSlug(), filter.when(), filter.date(), filter.sort());
        return queries.movies(f, city.getTimezone(), page, size);
    }

    public List<CatalogDtos.Suggestion> suggest(String q) {
        if (q == null || q.trim().length() < 2) {
            return List.of();
        }
        return queries.suggest(q.length() > 80 ? q.substring(0, 80) : q);
    }

    public CatalogDtos.FilterOptions filters(String citySlug) {
        return queries.filterOptions(cities(citySlug).getId());
    }

    public MovieDetail movie(String slug, String citySlug) {
        City city = cities(citySlug);
        MovieCard card = queries.cardBySlug(slug, city.getId(), city.getTimezone(), true)
                .orElseThrow(() -> ApiException.notFound("Movie"));
        Movie movie = movies.findBySlug(slug).orElseThrow(() -> ApiException.notFound("Movie"));
        List<CastDto> cast = movie.getCastMembers().stream().map(c -> new CastDto(c.name(), c.character())).toList();
        return new MovieDetail(card.id(), card.slug(), card.title(), card.tagline(), card.posterUrl(), card.backdropUrl(),
                card.trailerUrl(), card.runtimeMinutes(), card.releaseDate(), card.certification(), card.languages(),
                card.genres(), card.formats(), card.showingStatus(), card.isSampleData(), movie.getSynopsis(),
                movie.getDirector(), cast);
    }

    /** city=all means every city (null in the SQL filters); anything else resolves to one city. */
    private Long cityIdOrAll(String citySlug) {
        return ALL_CITIES.equalsIgnoreCase(citySlug) ? null : cities(citySlug).getId();
    }

    public static final String ALL_CITIES = "all";

    public List<LocalDate> movieDates(String slug, String citySlug) {
        Movie movie = publishedMovie(slug);
        return queries.showDates(movie.getId(), null, cityIdOrAll(citySlug));
    }

    public List<CinemaShowtimes> movieShowtimes(String slug, String citySlug, LocalDate date) {
        Movie movie = publishedMovie(slug);
        Long cityId = cityIdOrAll(citySlug);
        LocalDate day = date != null ? date
                : queries.showDates(movie.getId(), null, cityId).stream().findFirst().orElse(LocalDate.now(ZoneId.of(DEFAULT_TZ)));
        List<ChipRow> rows = queries.chips(new ChipFilter(movie.getId(), null, cityId, day, null),
                settings.booking().salesCloseMinutes());
        Map<Long, List<ShowtimeChip>> byCinema = groupChips(rows, ChipRow::cinemaId);
        Map<Long, CinemaCard> cinemas = queries.cinemas(cityId, null, null).stream()
                .collect(Collectors.toMap(CinemaCard::id, Function.identity()));
        return byCinema.entrySet().stream()
                .filter(e -> cinemas.containsKey(e.getKey()))
                .map(e -> new CinemaShowtimes(cinemas.get(e.getKey()), e.getValue()))
                .toList();
    }

    public List<MovieCard> related(String slug, String citySlug) {
        Movie movie = publishedMovie(slug);
        City city = cities(citySlug);
        return queries.related(movie.getId(), movie.getGenres(), city.getId(), city.getTimezone());
    }

    public List<CinemaCard> cinemas(String citySlug, String q, String format) {
        return queries.cinemas(cities(citySlug).getId(), q, format);
    }

    public CinemaDetail cinema(String slug) {
        CinemaCard c = queries.cinemaBySlug(slug).orElseThrow(() -> ApiException.notFound("Cinema"));
        return new CinemaDetail(c.id(), c.slug(), c.name(), c.address(), c.cityName(), c.citySlug(), c.imageUrl(),
                c.facilities(), c.formats(), c.phone(), c.latitude(), c.longitude(), c.directionsUrl(), c.timezone(),
                queries.cinemaDescription(c.id()), queries.auditoriums(c.id()));
    }

    public List<LocalDate> cinemaDates(String slug) {
        CinemaCard c = queries.cinemaBySlug(slug).orElseThrow(() -> ApiException.notFound("Cinema"));
        return queries.showDates(null, c.id(), null);
    }

    public List<MovieShowtimes> cinemaShowtimes(String slug, LocalDate date, String movieSlug) {
        CinemaCard cinema = queries.cinemaBySlug(slug).orElseThrow(() -> ApiException.notFound("Cinema"));
        Long movieId = movieSlug == null || movieSlug.isBlank() ? null : publishedMovie(movieSlug).getId();
        LocalDate day = date != null ? date
                : queries.showDates(movieId, cinema.id(), null).stream().findFirst().orElse(LocalDate.now(ZoneId.of(cinema.timezone())));
        List<ChipRow> rows = queries.chips(new ChipFilter(movieId, cinema.id(), null, day, null),
                settings.booking().salesCloseMinutes());
        Map<Long, List<ShowtimeChip>> byMovie = groupChips(rows, ChipRow::movieId);
        City city = cities.findById(cityIdOf(cinema)).orElse(null);
        Map<Long, MovieCard> cards = queries.cardsByIds(byMovie.keySet(), city == null ? null : city.getId(),
                        cinema.timezone()).stream()
                .collect(Collectors.toMap(MovieCard::id, Function.identity()));
        return byMovie.entrySet().stream()
                .filter(e -> cards.containsKey(e.getKey()))
                .map(e -> new MovieShowtimes(cards.get(e.getKey()), e.getValue()))
                .toList();
    }

    public List<CatalogDtos.PromotionDto> promotions() {
        return queries.promotions();
    }

    // ------------------------------------------------------------------ helpers

    private Long cityIdOf(CinemaCard cinema) {
        return cities.findBySlug(cinema.citySlug()).map(City::getId).orElse(null);
    }

    private Movie publishedMovie(String slug) {
        return movies.findBySlug(slug).filter(m -> m.getStatus() == Movie.Status.PUBLISHED)
                .orElseThrow(() -> ApiException.notFound("Movie"));
    }

    private City cities(String slug) {
        return queries.resolveCity(slug, cities).orElseThrow(() -> ApiException.notFound("City"));
    }

    private static CatalogQueries.MovieFilter filter(City city, String when, String sort) {
        return new CatalogQueries.MovieFilter(city.getId(), null, null, null, null, null, when, null, sort);
    }

    private static Map<Long, List<ShowtimeChip>> groupChips(List<ChipRow> rows, Function<ChipRow, Long> key) {
        Map<Long, List<ShowtimeChip>> grouped = new LinkedHashMap<>();
        for (ChipRow row : rows) {
            grouped.computeIfAbsent(key.apply(row), k -> new ArrayList<>()).add(row.chip());
        }
        return grouped;
    }

    static CityDto toDto(City c) {
        return new CityDto(c.getId(), c.getName(), c.getSlug(), c.isDefault());
    }

    static String defaultTimezone() {
        return DEFAULT_TZ;
    }
}
