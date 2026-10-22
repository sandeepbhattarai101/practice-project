package com.practiceproject.catalog;

import com.practiceproject.catalog.CatalogDtos.CinemaCard;
import com.practiceproject.catalog.CatalogDtos.CinemaDetail;
import com.practiceproject.catalog.CatalogDtos.CinemaShowtimes;
import com.practiceproject.catalog.CatalogDtos.CityDto;
import com.practiceproject.catalog.CatalogDtos.FilterOptions;
import com.practiceproject.catalog.CatalogDtos.Home;
import com.practiceproject.catalog.CatalogDtos.MovieCard;
import com.practiceproject.catalog.CatalogDtos.MovieDetail;
import com.practiceproject.catalog.CatalogDtos.MovieShowtimes;
import com.practiceproject.catalog.CatalogDtos.PromotionDto;
import com.practiceproject.catalog.CatalogDtos.Suggestion;
import com.practiceproject.common.PageResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public, read-only catalogue endpoints. No login needed. */
@RestController
@RequestMapping("/api")
public class CatalogController {

    private final CatalogService catalog;

    public CatalogController(CatalogService catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/cities")
    public ResponseEntity<List<CityDto>> cities() {
        // Cities hardly ever change: let browsers and CDNs reuse the answer for 5 minutes.
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic()).body(catalog.cities());
    }

    @GetMapping("/home")
    public Home home(@RequestParam(required = false) String city) {
        return catalog.home(city);
    }

    @GetMapping("/movies")
    public PageResponse<MovieCard> movies(@RequestParam(required = false) String city,
                                          @RequestParam(required = false) String q,
                                          @RequestParam(required = false) String genre,
                                          @RequestParam(required = false) String language,
                                          @RequestParam(required = false) String format,
                                          @RequestParam(required = false) String cinema,
                                          @RequestParam(required = false) String when,
                                          @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                          @RequestParam(required = false) String sort,
                                          @RequestParam(required = false) Integer page,
                                          @RequestParam(required = false) Integer size) {
        var filter = new CatalogQueries.MovieFilter(null, q, genre, language, format, cinema, when, date, sort);
        return catalog.movies(filter, city, PageResponse.clampPage(page), PageResponse.clampSize(size));
    }

    @GetMapping("/movies/suggest")
    public List<Suggestion> suggest(@RequestParam(required = false) String q) {
        return catalog.suggest(q);
    }

    @GetMapping("/movies/filters")
    public FilterOptions filters(@RequestParam(required = false) String city) {
        return catalog.filters(city);
    }

    @GetMapping("/movies/{slug}")
    public MovieDetail movie(@PathVariable String slug, @RequestParam(required = false) String city) {
        return catalog.movie(slug, city);
    }

    @GetMapping("/movies/{slug}/dates")
    public List<LocalDate> movieDates(@PathVariable String slug, @RequestParam(required = false) String city) {
        return catalog.movieDates(slug, city);
    }

    @GetMapping("/movies/{slug}/showtimes")
    public List<CinemaShowtimes> movieShowtimes(@PathVariable String slug, @RequestParam(required = false) String city,
                                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return catalog.movieShowtimes(slug, city, date);
    }

    @GetMapping("/movies/{slug}/related")
    public List<MovieCard> related(@PathVariable String slug, @RequestParam(required = false) String city) {
        return catalog.related(slug, city);
    }

    @GetMapping("/cinemas")
    public List<CinemaCard> cinemas(@RequestParam(required = false) String city, @RequestParam(required = false) String q,
                                    @RequestParam(required = false) String format) {
        return catalog.cinemas(city, q, format);
    }

    @GetMapping("/cinemas/{slug}")
    public CinemaDetail cinema(@PathVariable String slug) {
        return catalog.cinema(slug);
    }

    @GetMapping("/cinemas/{slug}/dates")
    public List<LocalDate> cinemaDates(@PathVariable String slug) {
        return catalog.cinemaDates(slug);
    }

    @GetMapping("/cinemas/{slug}/showtimes")
    public List<MovieShowtimes> cinemaShowtimes(@PathVariable String slug,
                                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                                @RequestParam(required = false) String movie) {
        return catalog.cinemaShowtimes(slug, date, movie);
    }

    @GetMapping("/promotions")
    public List<PromotionDto> promotions() {
        return catalog.promotions();
    }
}
