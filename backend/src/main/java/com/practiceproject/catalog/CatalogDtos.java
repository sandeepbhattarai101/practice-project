package com.practiceproject.catalog;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Read models returned by the public catalogue API (see docs/API.md, "Shared shapes"). */
public final class CatalogDtos {

    private CatalogDtos() {}

    public record CityDto(Long id, String name, String slug, boolean isDefault) {}

    public record MovieCard(Long id, String slug, String title, String tagline, String posterUrl, String backdropUrl,
                            String trailerUrl, int runtimeMinutes, LocalDate releaseDate, String certification,
                            List<String> languages, List<String> genres, List<String> formats, String showingStatus,
                            boolean isSampleData) {}

    public record CastDto(String name, String character) {}

    public record MovieDetail(Long id, String slug, String title, String tagline, String posterUrl, String backdropUrl,
                              String trailerUrl, int runtimeMinutes, LocalDate releaseDate, String certification,
                              List<String> languages, List<String> genres, List<String> formats, String showingStatus,
                              boolean isSampleData, String synopsis, String director, List<CastDto> cast) {}

    public record CinemaCard(Long id, String slug, String name, String address, String cityName, String citySlug,
                             String imageUrl, List<String> facilities, List<String> formats, String phone,
                             BigDecimal latitude, BigDecimal longitude, String directionsUrl, String timezone) {}

    public record AuditoriumSummary(Long id, String name, List<String> formats, int seatCount) {}

    public record CinemaDetail(Long id, String slug, String name, String address, String cityName, String citySlug,
                               String imageUrl, List<String> facilities, List<String> formats, String phone,
                               BigDecimal latitude, BigDecimal longitude, String directionsUrl, String timezone,
                               String description, List<AuditoriumSummary> auditoriums) {}

    public record ShowtimeChip(Long id, Instant startsAt, String format, String language, String cinemaSlug,
                               String cinemaName, String auditoriumName, String timezone, int seatsAvailable,
                               int seatsTotal, String availability, long minPriceMinor, long maxPriceMinor,
                               boolean salesOpen) {}

    public record PromotionDto(Long id, String title, String subtitle, String imageUrl, String ctaLabel, String ctaUrl,
                               String couponCode) {}

    public record Suggestion(String slug, String title, String posterUrl, LocalDate releaseDate, List<String> genres) {}

    public record FilterOptions(List<String> genres, List<String> languages, List<String> formats, List<CinemaOption> cinemas) {}

    public record CinemaOption(String slug, String name) {}

    public record CinemaShowtimes(CinemaCard cinema, List<ShowtimeChip> showtimes) {}

    public record MovieShowtimes(MovieCard movie, List<ShowtimeChip> showtimes) {}

    public record Home(CityDto city, List<MovieCard> featured, List<MovieCard> nowShowing, List<MovieCard> upcoming,
                       List<CinemaCard> cinemas, List<PromotionDto> promotions, List<MovieShowtimes> todayShowtimes) {}

    public record ShowtimePrice(Long categoryId, String code, String name, String color, long priceMinor) {}

    public record ShowtimeDetail(Long id, Instant startsAt, Instant endsAt, String format, String language, String status,
                                 boolean salesOpen, Instant salesCloseAt, String timezone, MovieCard movie,
                                 CinemaCard cinema, AuditoriumRef auditorium, List<ShowtimePrice> prices) {}

    public record AuditoriumRef(Long id, String name) {}
}
