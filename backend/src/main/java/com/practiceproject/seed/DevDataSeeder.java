package com.practiceproject.seed;

import com.practiceproject.config.AppProperties;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Inserts CLEARLY LABELLED sample data (fictional movies, cinemas and showtimes) into an
 * empty database, and keeps sample showtimes rolling seven days ahead. Every sample movie
 * has is_sample_data = true and the UI shows a "Development data" badge on it.
 * Disabled in production (SEED_SAMPLE_DATA=false; ProductionSafetyCheck enforces it).
 */
@Component
@ConditionalOnProperty(name = "app.seed.enabled", havingValue = "true")
public class DevDataSeeder {

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);
    private static final ZoneId KTM = ZoneId.of("Asia/Kathmandu");
    private static final List<LocalTime> SLOTS = List.of(LocalTime.of(10, 15), LocalTime.of(13, 30), LocalTime.of(16, 45), LocalTime.of(20, 0));
    private static final int BUFFER_MINUTES = 20;

    record SampleMovie(String slug, String title, String tagline, String synopsis, int runtime, int releaseOffsetDays,
                       String cert, List<String> languages, List<String> genres, String director, List<String[]> cast,
                       boolean featured) {}

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final AppProperties props;
    private final TransactionTemplate tx;

    public DevDataSeeder(JdbcTemplate jdbc, PasswordEncoder encoder, AppProperties props, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.props = props;
        this.tx = tx;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        Integer cities = jdbc.queryForObject("select count(*) from cities", Integer.class);
        if (cities != null && cities == 0) {
            tx.executeWithoutResult(s -> seed());
            log.info("Sample data inserted (development only)");
        }
        topUpShowtimes();
    }

    /** Runs nightly so sample shows never run out. */
    @Scheduled(cron = "0 15 0 * * *", zone = "Asia/Kathmandu")
    public void topUpShowtimes() {
        tx.executeWithoutResult(s -> {
            int created = createRollingShowtimes();
            if (created > 0) {
                log.info("Created {} sample showtimes for the coming week", created);
            }
        });
    }

    // ------------------------------------------------------------------ seed

    private void seed() {
        long ktm = insertCity("Kathmandu", "kathmandu", true, 1);
        long lalitpur = insertCity("Lalitpur", "lalitpur", false, 2);
        long pokhara = insertCity("Pokhara", "pokhara", false, 3);

        long durbar = insertCinema(ktm, "Practice Project Durbar Marg", "practice-project-durbar-marg",
                "Durbar Marg, Kathmandu 44600", 27.7115, 85.3176, "01-4000001",
                "Our flagship: three screens including the Prime recliner lounge and the city's largest 3D/IMAX-format screen.",
                List.of("Parking", "Food & drinks", "Wheelchair access", "Dolby Atmos", "Recliners", "3D glasses"));
        long chabahil = insertCinema(ktm, "Practice Project Chabahil", "practice-project-chabahil",
                "Chabahil Chowk, Kathmandu 44600", 27.7172, 85.3466, "01-4000002",
                "A neighbourhood favourite with two comfortable screens and late-night shows at weekends.",
                List.of("Food & drinks", "Wheelchair access", "3D glasses"));
        long jhamsikhel = insertCinema(lalitpur, "Practice Project Jhamsikhel", "practice-project-jhamsikhel",
                "Jhamsikhel Road, Lalitpur 44700", 27.6795, 85.3080, "01-5000003",
                "Boutique two-screen cinema with a café, close to Jhamsikhel's restaurants.",
                List.of("Parking", "Café", "Wheelchair access", "Dolby Atmos"));
        long lakeside = insertCinema(pokhara, "Practice Project Lakeside", "practice-project-lakeside",
                "Lakeside Road, Pokhara 33700", 28.2096, 83.9586, "061-600004",
                "Two screens a short walk from Phewa Lake.",
                List.of("Parking", "Food & drinks", "Wheelchair access"));

        // Auditoriums with generated layouts.
        standardHall(durbar, "Audi 1", List.of("2D", "3D", "IMAX"), 12, 20);
        standardHall(durbar, "Audi 2", List.of("2D", "3D"), 10, 16);
        primeHall(durbar, "Prime Lounge");
        standardHall(chabahil, "Audi 1", List.of("2D", "3D"), 10, 18);
        standardHall(chabahil, "Audi 2", List.of("2D"), 8, 14);
        standardHall(jhamsikhel, "Audi 1", List.of("2D", "3D"), 9, 16);
        primeHall(jhamsikhel, "Prime Lounge");
        standardHall(lakeside, "Audi 1", List.of("2D", "3D"), 10, 16);
        standardHall(lakeside, "Audi 2", List.of("2D"), 8, 12);

        // Real current titles + poster links from the QFX snapshot (scripts/import-qfx-catalogue.mjs) when present;
        // otherwise the fictional catalogue. Never both: mixing invented films with real ones would be confusing.
        if (insertQfxSnapshot() == 0) {
            for (SampleMovie m : movies()) {
                insertMovie(m);
            }
        }

        String admin = props.seed().adminPassword();
        long adminId = insertUser("admin@practice-project.local", "Asha Admin", "ADMIN", admin);
        long managerId = insertUser("manager@practice-project.local", "Milan Manager", "CINEMA_MANAGER", "Manager@12345");
        insertUser("customer@practice-project.local", "Kiran Customer", "CUSTOMER", "Customer@12345");
        jdbc.update("insert into manager_cinemas (user_id, cinema_id) values (?, ?)", managerId, durbar);
        log.info("Seeded admin user id {} (admin@practice-project.local)", adminId);

        jdbc.update("""
                insert into coupons (code, description, discount_type, discount_value, max_discount_minor, min_subtotal_minor, per_user_limit)
                values ('WELCOME10', '10% off your first booking (max Rs. 150)', 'PERCENT', 1000, 15000, 0, 1),
                       ('FLAT100', 'Rs. 100 off when you spend Rs. 800 or more', 'FIXED', 10000, null, 80000, null),
                       ('FAMILY15', '15% off orders of Rs. 1,600 or more', 'PERCENT', 1500, 50000, 160000, null)
                """);
        jdbc.update("""
                insert into promotions (title, subtitle, cta_label, cta_url, coupon_code, sort_order) values
                ('First booking? Save 10%', 'Use code WELCOME10 at checkout. One use per customer, up to Rs. 150 off.', 'Browse movies', '/movies', 'WELCOME10', 1),
                ('Bring the whole family', '15% off orders of Rs. 1,600 or more with FAMILY15.', 'See what''s showing', '/movies?when=now', 'FAMILY15', 2),
                ('Recline in the Prime Lounge', 'Leather recliners, table service and the best sound in the valley.', 'Find a Prime show', '/cinemas/practice-project-durbar-marg', null, 3)
                """);
    }

    private int createRollingShowtimes() {
        List<Map<String, Object>> halls = jdbc.queryForList("""
                select a.id, a.formats, a.name, (select count(*) from seat_categories sc where sc.auditorium_id = a.id) as cats
                from auditoriums a join cinemas c on c.id = a.cinema_id
                where c.slug like 'practice-project-%' and a.is_active
                order by a.id
                """);
        List<Map<String, Object>> movies = jdbc.queryForList("""
                select id, slug, runtime_minutes, release_date, languages, genres from movies
                where is_sample_data and status = 'PUBLISHED' and release_date <= current_date + 7
                order by id
                """);
        if (halls.isEmpty() || movies.isEmpty()) {
            return 0;
        }
        LocalDate today = LocalDate.now(KTM);
        int created = 0;
        for (int h = 0; h < halls.size(); h++) {
            var hall = halls.get(h);
            long hallId = ((Number) hall.get("id")).longValue();
            List<String> formats = toList(hall.get("formats"));
            boolean prime = String.valueOf(hall.get("name")).startsWith("Prime");
            for (int d = 0; d < 7; d++) {
                LocalDate date = today.plusDays(d);
                for (int s = 0; s < SLOTS.size(); s++) {
                    ZonedDateTime start = date.atTime(SLOTS.get(s)).atZone(KTM);
                    if (start.toInstant().isBefore(Instant.now().plusSeconds(3600))) {
                        continue;
                    }
                    // Deterministic rotation so the schedule looks curated, not random.
                    var movie = pick(movies, date, h * 7 + d * 3 + s);
                    if (movie == null) {
                        continue;
                    }
                    int runtime = ((Number) movie.get("runtime_minutes")).intValue();
                    List<String> genres = toList(movie.get("genres"));
                    String format = "2D";
                    if (formats.contains("IMAX") && s == 3 && genres.contains("Sci-Fi")) {
                        format = "IMAX";
                    } else if (formats.contains("3D") && (s + d) % 3 == 0
                            && (genres.contains("Action") || genres.contains("Animation") || genres.contains("Sci-Fi"))) {
                        format = "3D";
                    }
                    String language = toList(movie.get("languages")).getFirst();
                    Instant startsAt = start.toInstant();
                    Instant endsAt = startsAt.plusSeconds((runtime + BUFFER_MINUTES) * 60L);
                    // ON CONFLICT DO NOTHING also works with EXCLUDE constraints: an overlapping
                    // show (e.g. from an earlier run) is silently skipped instead of failing.
                    List<Long> ids = jdbc.queryForList("""
                            insert into showtimes (movie_id, auditorium_id, starts_at, ends_at, format, language)
                            values (?, ?, ?, ?, ?, ?)
                            on conflict do nothing
                            returning id
                            """, Long.class, movie.get("id"), hallId, Timestamp.from(startsAt), Timestamp.from(endsAt), format, language);
                    if (ids.isEmpty()) {
                        continue;
                    }
                    long showId = ids.getFirst();
                    long surcharge = switch (format) {
                        case "IMAX" -> 25000;
                        case "3D" -> 10000;
                        default -> 0;
                    };
                    long matinee = s == 0 ? -5000 : 0;
                    long tuesday = date.getDayOfWeek() == DayOfWeek.TUESDAY ? -5000 : 0;
                    jdbc.update("""
                            insert into showtime_prices (showtime_id, seat_category_id, price_minor)
                            select ?, sc.id, case sc.code when 'CLASSIC' then 40000 when 'PREMIUM' then 55000
                                                          when 'RECLINER' then 120000 when 'COUPLE' then 250000 else 40000 end + ?
                            from seat_categories sc where sc.auditorium_id = ?
                            """, showId, surcharge + matinee + tuesday + (prime ? 0 : 0), hallId);
                    created++;
                }
            }
        }
        return created;
    }

    private static Map<String, Object> pick(List<Map<String, Object>> movies, LocalDate date, int seed) {
        List<Map<String, Object>> eligible = new ArrayList<>();
        for (var m : movies) {
            LocalDate release = ((java.sql.Date) m.get("release_date")).toLocalDate();
            if (!release.isAfter(date)) {
                eligible.add(m);
            }
        }
        return eligible.isEmpty() ? null : eligible.get(Math.floorMod(seed, eligible.size()));
    }

    // ------------------------------------------------------------------ halls

    /** Rows A.. from the screen back; two aisles; last three rows Premium; wheelchair spaces in row A. */
    private void standardHall(long cinemaId, String name, List<String> formats, int rows, int seatsPerRow) {
        int aisleLeft = seatsPerRow / 4;
        int aisleRight = seatsPerRow - seatsPerRow / 4;
        int cols = seatsPerRow + 2;
        long hall = insertHall(cinemaId, name, formats, rows, cols);
        long classic = insertCategory(hall, "CLASSIC", "Classic", "#8B8B95", 1);
        long premium = insertCategory(hall, "PREMIUM", "Premium", "#F5B544", 2);
        List<Object[]> seats = new ArrayList<>();
        for (int r = 0; r < rows; r++) {
            String label = String.valueOf((char) ('A' + r));
            long category = r >= rows - 3 ? premium : classic;
            int number = 1;
            int col = 1;
            for (int i = 0; i < seatsPerRow; i++) {
                if (i == aisleLeft || i == aisleRight) {
                    col++; // leave an empty grid cell = aisle
                }
                String type = "STANDARD";
                if (r == 0 && (i == 0 || i == seatsPerRow - 1)) {
                    type = "WHEELCHAIR";
                } else if (r == 0 && (i == 1 || i == seatsPerRow - 2)) {
                    type = "COMPANION";
                }
                seats.add(new Object[] {hall, category, label, number++, r + 1, col++, type});
            }
        }
        insertSeats(seats);
    }

    /** Six rows of recliners with a centre aisle; the back row is couple sofas. */
    private void primeHall(long cinemaId, String name) {
        long hall = insertHall(cinemaId, name, List.of("2D"), 6, 11);
        long recliner = insertCategory(hall, "RECLINER", "Recliner", "#C9A2FF", 1);
        long couple = insertCategory(hall, "COUPLE", "Couple sofa", "#FF8FA3", 2);
        List<Object[]> seats = new ArrayList<>();
        for (int r = 0; r < 6; r++) {
            String label = String.valueOf((char) ('A' + r));
            int number = 1;
            if (r == 5) {
                for (int col : new int[] {1, 3, 7, 9}) {
                    seats.add(new Object[] {hall, couple, label, number++, r + 1, col, "COUPLE"});
                }
                continue;
            }
            for (int col = 1; col <= 11; col++) {
                if (col == 6) {
                    continue;
                }
                String type = r == 0 && (col == 1 || col == 11) ? "WHEELCHAIR" : "STANDARD";
                seats.add(new Object[] {hall, recliner, label, number++, r + 1, col, type});
            }
        }
        insertSeats(seats);
    }

    // ------------------------------------------------------------------ inserts

    private long insertCity(String name, String slug, boolean isDefault, int order) {
        return jdbc.queryForObject("insert into cities (name, slug, is_default, sort_order) values (?, ?, ?, ?) returning id",
                Long.class, name, slug, isDefault, order);
    }

    private long insertCinema(long cityId, String name, String slug, String address, double lat, double lng, String phone,
                              String description, List<String> facilities) {
        return jdbc.queryForObject("""
                insert into cinemas (city_id, name, slug, address, latitude, longitude, phone, description, facilities, image_url)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?::text[], ?) returning id
                """, Long.class, cityId, name, slug, address, lat, lng, phone, description, pgText(facilities),
                "/api/media/artwork/cinema/" + slug + ".svg?title=" + java.net.URLEncoder.encode(name.replace("Practice Project ", ""),
                        java.nio.charset.StandardCharsets.UTF_8));
    }

    private long insertHall(long cinemaId, String name, List<String> formats, int rows, int cols) {
        return jdbc.queryForObject("""
                insert into auditoriums (cinema_id, name, formats, grid_rows, grid_cols) values (?, ?, ?::text[], ?, ?) returning id
                """, Long.class, cinemaId, name, pgText(formats), rows, cols);
    }

    private long insertCategory(long hall, String code, String name, String color, int order) {
        return jdbc.queryForObject("""
                insert into seat_categories (auditorium_id, code, name, color, sort_order) values (?, ?, ?, ?, ?) returning id
                """, Long.class, hall, code, name, color, order);
    }

    private void insertSeats(List<Object[]> seats) {
        jdbc.batchUpdate("""
                insert into seats (auditorium_id, category_id, row_label, seat_number, grid_row, grid_col, seat_type)
                values (?, ?, ?, ?, ?, ?, ?)
                """, seats);
    }

    private void insertMovie(SampleMovie m) {
        var cast = new StringBuilder("[");
        for (int i = 0; i < m.cast().size(); i++) {
            String[] c = m.cast().get(i);
            if (i > 0) {
                cast.append(',');
            }
            cast.append("{\"name\":\"").append(c[0]).append("\",\"character\":\"").append(c[1]).append("\"}");
        }
        cast.append(']');
        String titleParam = java.net.URLEncoder.encode(m.title(), java.nio.charset.StandardCharsets.UTF_8);
        String taglineParam = java.net.URLEncoder.encode(m.genres().getFirst(), java.nio.charset.StandardCharsets.UTF_8);
        jdbc.update("""
                insert into movies (slug, title, tagline, synopsis, runtime_minutes, release_date, certification, languages, genres,
                                    director, cast_members, poster_url, backdrop_url, status, is_featured, is_sample_data)
                values (?, ?, ?, ?, ?, current_date + ?, ?, ?::text[], ?::text[], ?, ?::jsonb, ?, ?, 'PUBLISHED', ?, true)
                """, m.slug(), m.title(), m.tagline(), m.synopsis(), m.runtime(), m.releaseOffsetDays(), m.cert(),
                pgText(m.languages()), pgText(m.genres()), m.director(), cast.toString(),
                "/api/media/artwork/poster/" + m.slug() + ".svg?title=" + titleParam + "&subtitle=" + taglineParam,
                "/api/media/artwork/backdrop/" + m.slug() + ".svg?title=" + titleParam, m.featured());
    }

    /**
     * Inserts movies from seed/qfx-now-showing.json. Posters stay on QFX's CDN (hotlinked, not copied).
     * Local development only: the images and synopses are copyrighted; see the script's header.
     */
    private int insertQfxSnapshot() {
        var resource = new org.springframework.core.io.ClassPathResource("seed/qfx-now-showing.json");
        if (!resource.exists()) {
            return 0;
        }
        try (var in = resource.getInputStream()) {
            var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(in);
            int n = 0;
            for (var m : root.path("movies")) {
                var cast = new com.fasterxml.jackson.databind.ObjectMapper().createArrayNode();
                m.path("cast").forEach(c -> cast.addObject().put("name", c.asText()).putNull("character"));
                List<String> languages = new ArrayList<>();
                m.path("languages").forEach(l -> languages.add(l.asText()));
                List<String> genres = new ArrayList<>();
                m.path("genres").forEach(g -> genres.add(g.asText()));
                String poster = m.path("posterUrl").asText();
                jdbc.update("""
                        insert into movies (slug, title, synopsis, runtime_minutes, release_date, certification, languages, genres,
                                            director, cast_members, trailer_url, poster_url, backdrop_url, status, is_featured, is_sample_data)
                        values (?, ?, ?, ?, ?::date, ?, ?::text[], ?::text[], ?, ?::jsonb, ?, ?, ?, 'PUBLISHED', ?, true)
                        on conflict (slug) do nothing
                        """, m.path("slug").asText(), m.path("title").asText(), m.path("synopsis").asText(""),
                        m.path("runtimeMinutes").asInt(120), m.path("releaseDate").asText(), m.path("certification").asText("PG"),
                        pgText(languages.isEmpty() ? List.of("English") : languages), pgText(genres),
                        m.path("director").isNull() ? null : m.path("director").asText(null), cast.toString(),
                        m.path("trailerUrl").isNull() ? null : m.path("trailerUrl").asText(null),
                        // QFX only publishes portrait artwork; the frontend shows it blurred behind the hero.
                        poster, poster, n < 5);
                n++;
            }
            log.info("Imported {} movies from the QFX snapshot ({})", n, root.path("fetchedAt").asText());
            return n;
        } catch (java.io.IOException e) {
            log.warn("Could not read QFX snapshot, using fictional movies: {}", e.getMessage());
            return 0;
        }
    }

    private long insertUser(String email, String name, String role, String password) {
        return jdbc.queryForObject("""
                insert into users (email, password_hash, full_name, role, email_verified_at) values (?, ?, ?, ?, now()) returning id
                """, Long.class, email, encoder.encode(password), name, role);
    }

    private static String pgText(List<String> values) {
        return values.stream().map(v -> "\"" + v.replace("\"", "\\\"") + "\"")
                .collect(java.util.stream.Collectors.joining(",", "{", "}"));
    }

    @SuppressWarnings("unchecked")
    private static List<String> toList(Object array) {
        try {
            if (array instanceof java.sql.Array a) {
                return List.of((String[]) a.getArray());
            }
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
        }
        return (List<String>) array;
    }

    // ------------------------------------------------------------------ fictional catalogue

    static List<SampleMovie> movies() {
        return List.of(
                new SampleMovie("the-last-monsoon", "The Last Monsoon", "Some promises outlast the rain.",
                        "When a retired mountain guide receives a letter from the woman he left behind forty years ago, he sets out on one last trek across a Nepal he barely recognises, chasing a promise made in the rain.",
                        142, -20, "PG", List.of("Nepali", "English"), List.of("Drama", "Romance"), "Sabina Thapa",
                        List.of(new String[] {"Rajan Gurung", "Hari"}, new String[] {"Mina Shrestha", "Sunita"}, new String[] {"Bikash Rai", "Young Hari"}), true),
                new SampleMovie("himalayan-heist", "Himalayan Heist", "The highest-stakes job on Earth.",
                        "A crew of misfit climbers is hired to steal a priceless relic from a monastery vault at 5,000 metres, but the mountain has plans of its own.",
                        128, -12, "PG", List.of("English", "Hindi"), List.of("Action", "Thriller"), "Arjun Mehra",
                        List.of(new String[] {"Dev Malhotra", "Kabir"}, new String[] {"Lena Ortiz", "Sasha"}, new String[] {"Pemba Sherpa", "Dorje"}), true),
                new SampleMovie("starlight-over-pokhara", "Starlight Over Pokhara", "Love, lakeside.",
                        "A burnt-out Kathmandu architect and a paragliding instructor clash over the redesign of a lakeside guesthouse, and slowly fall for each other.",
                        118, -9, "U", List.of("Nepali"), List.of("Romance", "Comedy"), "Prakriti Karki",
                        List.of(new String[] {"Anisha Lama", "Riya"}, new String[] {"Sujan Adhikari", "Aakash"}), false),
                new SampleMovie("orbit-nine", "Orbit Nine", "Nine days. One way home.",
                        "The crew of a damaged survey ship has nine days to rebuild their engine from salvage before their orbit decays into an uncharted gas giant.",
                        151, -6, "PG", List.of("English"), List.of("Sci-Fi", "Adventure"), "Helena Voss",
                        List.of(new String[] {"Marcus Hale", "Commander Reyes"}, new String[] {"Aiko Tanaka", "Dr. Imai"}, new String[] {"Samuel Okafor", "Brooks"}), true),
                new SampleMovie("midnight-express-to-janakpur", "Midnight Express to Janakpur", "Everyone on board has a secret.",
                        "An overnight bus, a missing passenger and a junior police inspector who has until dawn to work out which of the twelve travellers is lying.",
                        133, -15, "PG", List.of("Nepali"), List.of("Mystery", "Thriller"), "Nabin Joshi",
                        List.of(new String[] {"Saugat Malla", "Inspector Rana"}, new String[] {"Pooja Bista", "Kamala"}), false),
                new SampleMovie("paper-kites", "Paper Kites", "Fly higher together.",
                        "Two siblings build a kite big enough to carry a wish to their grandmother in the mountains, an animated adventure for the whole family.",
                        96, -4, "U", List.of("English", "Nepali"), List.of("Animation", "Family"), "Lila Moreau",
                        List.of(new String[] {"Asha Karki", "Mira (voice)"}, new String[] {"Tom Bennett", "Pip (voice)"}), true),
                new SampleMovie("brass-and-bone", "Brass & Bone", "Forge your own legend.",
                        "In a city powered by clockwork, a blacksmith's apprentice discovers that the ancient automaton in her workshop is the last of an army.",
                        162, -25, "PG", List.of("English"), List.of("Action", "Fantasy"), "Owen Carter",
                        List.of(new String[] {"Iris Calloway", "Wren"}, new String[] {"Victor Lang", "The Regent"}), false),
                new SampleMovie("quiet-hours", "Quiet Hours", "Don't make a sound after midnight.",
                        "A night-shift nurse at a remote hospital notices the patients on ward seven stop breathing at exactly the same time each night.",
                        104, -3, "A", List.of("English"), List.of("Horror", "Thriller"), "Grace Whitlock",
                        List.of(new String[] {"Nora Quinn", "Ellie"}, new String[] {"Daniel Reyes", "Dr. Marsh"}), false),
                new SampleMovie("rhythm-of-the-valley", "Rhythm of the Valley", "Every heart keeps time.",
                        "A village brass band with one month to save their music school enters the national championship, with a teenage drummer who has never played in public.",
                        139, -30, "U", List.of("Hindi", "Nepali"), List.of("Musical", "Drama"), "Ritu Sharma",
                        List.of(new String[] {"Aarav Singh", "Monu"}, new String[] {"Kavya Iyer", "Teacher Gita"}), false),
                new SampleMovie("ironwood", "Ironwood", "The frontier remembers.",
                        "A widowed rancher must defend the last stand of ironwood trees from a railway baron in this slow-burning modern western.",
                        121, -18, "PG", List.of("English"), List.of("Western", "Drama"), "Caleb Moore",
                        List.of(new String[] {"Ruth Delaney", "Maggie"}, new String[] {"Hank Brody", "Silas Crane"}), false),
                new SampleMovie("ember-protocol", "Ember Protocol", "Advance bookings open now.",
                        "A cyber-security analyst uncovers a plan to switch off a continent's power grid, and has six hours to prove it before it happens.",
                        137, 4, "PG", List.of("English"), List.of("Sci-Fi", "Action"), "Marta Lindqvist",
                        List.of(new String[] {"Jonah Pierce", "Eli Navarro"}, new String[] {"Zara Khan", "Agent Moss"}), true),
                new SampleMovie("the-kathmandu-files", "The Kathmandu Files", "Some stories refuse to stay buried.",
                        "A journalist reopens a decades-old disappearance case in the old city's courtyards and finds that the witnesses are still afraid.",
                        126, 20, "PG", List.of("Nepali", "English"), List.of("Drama", "Mystery"), "Sanjay Pradhan",
                        List.of(new String[] {"Reshma Thapa", "Anu"}, new String[] {"Bipin Karki", "Old Man Shakya"}), false),
                new SampleMovie("lantern-festival", "Lantern Festival", "Light the way home.",
                        "A lost firefly and a grumpy temple cat must cross a city during the lantern festival to find the firefly's family.",
                        92, 35, "U", List.of("English", "Nepali"), List.of("Animation", "Family"), "Yuki Morita",
                        List.of(new String[] {"Sita Rai", "Jun (voice)"}, new String[] {"Oliver Grant", "Mr. Whiskers (voice)"}), false));
    }
}
