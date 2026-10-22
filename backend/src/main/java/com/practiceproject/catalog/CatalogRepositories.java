package com.practiceproject.catalog;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Spring Data generates the implementations of these interfaces at start-up. */
public final class CatalogRepositories {

    private CatalogRepositories() {}

    public interface CityRepository extends JpaRepository<City, Long> {
        Optional<City> findBySlug(String slug);
    }

    public interface CinemaRepository extends JpaRepository<Cinema, Long> {
        Optional<Cinema> findBySlug(String slug);
        boolean existsBySlug(String slug);
    }

    public interface AuditoriumRepository extends JpaRepository<Auditorium, Long> {}

    public interface MovieRepository extends JpaRepository<Movie, Long> {
        Optional<Movie> findBySlug(String slug);
        boolean existsBySlug(String slug);
        Optional<Movie> findByTmdbId(Long tmdbId);
    }

    public interface ShowtimeRepository extends JpaRepository<Showtime, Long> {}
}
