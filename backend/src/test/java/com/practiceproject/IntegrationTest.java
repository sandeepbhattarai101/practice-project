package com.practiceproject;

import com.practiceproject.common.RateLimitFilter;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Base class: boots the whole app against the practice_test database and wipes data before
 * each test. TRUNCATE ... RESTART IDENTITY CASCADE is far faster than DELETE, and resets ids.
 * Flyway history and app_settings are kept so the schema and default settings stay in place.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class IntegrationTest {

    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected MockMvc mvc;
    @Autowired protected PasswordEncoder passwordEncoder;
    @Autowired private RateLimitFilter rateLimitFilter;

    /** Ids of the fixture created for each test. */
    protected record Fixture(long cityId, long cinemaId, long otherCinemaId, long auditoriumId, long classicId,
                             long premiumId, long movieId, long showtimeId, List<Long> seatIds) {}

    protected Fixture fx;

    @BeforeEach
    void resetDatabase() {
        rateLimitFilter.setEnabled(false);
        List<String> tables = jdbc.queryForList("""
                select tablename from pg_tables where schemaname = 'public'
                  and tablename not in ('flyway_schema_history', 'app_settings')
                """, String.class);
        jdbc.execute("truncate table " + String.join(", ", tables) + " restart identity cascade");
        // Lesson learned: app_settings.updated_by references users, so "truncate users CASCADE"
        // empties app_settings too. Re-run the default settings inserts from the migrations.
        restoreDefaultSettings();
        fx = createFixture();
    }

    private void restoreDefaultSettings() {
        jdbc.execute("truncate table app_settings");
        try {
            var resolver = new org.springframework.core.io.support.PathMatchingResourcePatternResolver();
            for (var migration : resolver.getResources("classpath:db/migration/V*.sql")) {
                String sql = migration.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
                var matcher = java.util.regex.Pattern.compile("(?is)INSERT INTO app_settings.*?;").matcher(sql);
                while (matcher.find()) {
                    jdbc.execute(matcher.group());
                }
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private Fixture createFixture() {
        long city = id("insert into cities (name, slug, is_default) values ('Kathmandu', 'kathmandu', true) returning id");
        long cinema = id("insert into cinemas (city_id, name, slug, address) values (" + city + ", 'Test Cinema', 'test-cinema', 'Durbar Marg') returning id");
        long other = id("insert into cinemas (city_id, name, slug, address) values (" + city + ", 'Other Cinema', 'other-cinema', 'Chabahil') returning id");
        long hall = id("insert into auditoriums (cinema_id, name, formats, grid_rows, grid_cols) values (" + cinema + ", 'Audi 1', '{2D,3D}', 2, 5) returning id");
        long classic = id("insert into seat_categories (auditorium_id, code, name) values (" + hall + ", 'CLASSIC', 'Classic') returning id");
        long premium = id("insert into seat_categories (auditorium_id, code, name) values (" + hall + ", 'PREMIUM', 'Premium') returning id");
        List<Long> seats = new ArrayList<>();
        for (int row = 1; row <= 2; row++) {
            for (int col = 1; col <= 5; col++) {
                long category = row == 2 ? premium : classic;
                seats.add(id("insert into seats (auditorium_id, category_id, row_label, seat_number, grid_row, grid_col) values ("
                        + hall + ", " + category + ", '" + (char) ('A' + row - 1) + "', " + col + ", " + row + ", " + col + ") returning id"));
            }
        }
        long movie = id("""
                insert into movies (slug, title, runtime_minutes, release_date, languages, genres, status)
                values ('test-movie', 'Test Movie', 120, current_date - 7, '{English}', '{Drama}', 'PUBLISHED') returning id""");
        long show = createShowtime(movie, hall, Instant.now().plus(2, ChronoUnit.DAYS));
        jdbc.update("insert into showtime_prices (showtime_id, seat_category_id, price_minor) values (?, ?, 40000), (?, ?, 60000)",
                show, classic, show, premium);
        return new Fixture(city, cinema, other, hall, classic, premium, movie, show, seats);
    }

    protected long createShowtime(long movieId, long auditoriumId, Instant start) {
        return jdbc.queryForObject("""
                insert into showtimes (movie_id, auditorium_id, starts_at, ends_at, language) values (?, ?, ?, ?, 'English') returning id
                """, Long.class, movieId, auditoriumId, Timestamp.from(start), Timestamp.from(start.plus(140, ChronoUnit.MINUTES)));
    }

    protected long createUser(String email, String role, String password) {
        return jdbc.queryForObject("""
                insert into users (email, password_hash, full_name, role, email_verified_at) values (?, ?, ?, ?, now()) returning id
                """, Long.class, email, passwordEncoder.encode(password), "Test " + role, role);
    }

    protected long id(String sql) {
        return jdbc.queryForObject(sql, Long.class);
    }
}
