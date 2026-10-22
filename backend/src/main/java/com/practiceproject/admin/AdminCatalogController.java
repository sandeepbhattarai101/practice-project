package com.practiceproject.admin;

import com.practiceproject.audit.AuditService;
import com.practiceproject.catalog.Auditorium;
import com.practiceproject.catalog.CatalogRepositories.AuditoriumRepository;
import com.practiceproject.catalog.CatalogRepositories.CinemaRepository;
import com.practiceproject.catalog.CatalogRepositories.CityRepository;
import com.practiceproject.catalog.Cinema;
import com.practiceproject.catalog.City;
import com.practiceproject.catalog.Movie;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.PageResponse;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import com.practiceproject.coupon.Coupon;
import com.practiceproject.coupon.CouponRepository;
import com.practiceproject.coupon.CouponService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Catalogue management: movies, venues, layouts, coupons, promotions. Platform admins only. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminCatalogController {

    // ------------------------------------------------------------------ DTOs

    public record StatusRequest(@NotNull Movie.Status status) {}

    public record ImportRequest(@NotNull Long tmdbId) {}

    public record CityInput(@NotBlank @Size(max = 80) String name, @Size(max = 80) String slug,
                            @NotBlank String timezone, boolean isDefault) {}

    public record CinemaInput(@NotNull Long cityId, @NotBlank @Size(max = 120) String name, @Size(max = 120) String slug,
                              @NotBlank @Size(max = 300) String address,
                              @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
                              @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude,
                              @Size(max = 30) String phone, @Size(max = 2000) String description,
                              @Size(max = 20) List<@NotBlank @Size(max = 40) String> facilities,
                              @Size(max = 1000) @Pattern(regexp = "^(https?://.*|/.*)?$") String imageUrl,
                              @Pattern(regexp = "^(ACTIVE|INACTIVE)$") String status) {}

    public record AuditoriumCreate(@NotBlank @Size(max = 60) String name, @NotEmpty List<@Pattern(regexp = "^[A-Z0-9]{2,8}$") String> formats,
                                   @NotNull @Min(1) @Max(60) Integer gridRows, @NotNull @Min(1) @Max(80) Integer gridCols) {}

    public record AuditoriumUpdate(@NotBlank @Size(max = 60) String name, @NotEmpty List<@Pattern(regexp = "^[A-Z0-9]{2,8}$") String> formats,
                                   boolean isActive) {}

    public record AdminCinema(Long id, Long cityId, String cityName, String name, String slug, String address,
                              BigDecimal latitude, BigDecimal longitude, String phone, String description,
                              List<String> facilities, String imageUrl, String status, int auditoriumCount,
                              List<AdminAuditorium> auditoriums) {}

    public record AdminAuditorium(Long id, String name, List<String> formats, int gridRows, int gridCols, boolean isActive,
                                  int seatCount, boolean layoutLocked) {}

    public record CouponInput(@NotBlank @Size(max = 40) @Pattern(regexp = "^[A-Za-z0-9_-]+$") String code,
                              @Size(max = 300) String description, @NotNull Coupon.DiscountType discountType,
                              @NotNull @Min(1) Long discountValue, @Min(1) Long maxDiscountMinor,
                              @Min(0) Long minSubtotalMinor, Instant validFrom, Instant validUntil,
                              @Min(1) Integer usageLimit, @Min(1) Integer perUserLimit, Long movieId, Long cinemaId,
                              boolean isActive) {}

    public record AdminCoupon(Long id, String code, String description, Coupon.DiscountType discountType, long discountValue,
                              Long maxDiscountMinor, long minSubtotalMinor, Instant validFrom, Instant validUntil,
                              Integer usageLimit, Integer perUserLimit, Long movieId, Long cinemaId, boolean isActive,
                              long usedCount, Instant createdAt) {}

    public record PromotionInput(@NotBlank @Size(max = 120) String title, @Size(max = 300) String subtitle,
                                 @Size(max = 1000) @Pattern(regexp = "^(https?://.*|/.*)?$") String imageUrl,
                                 @Size(max = 40) String ctaLabel, @Size(max = 500) @Pattern(regexp = "^(https?://.*|/.*)?$") String ctaUrl,
                                 @Size(max = 40) String couponCode, Instant startsAt, Instant endsAt, boolean isActive,
                                 int sortOrder) {}

    private final MovieAdminService movieAdmin;
    private final TmdbClient tmdb;
    private final CityRepository cities;
    private final CinemaRepository cinemas;
    private final AuditoriumRepository auditoriums;
    private final LayoutService layouts;
    private final CouponRepository coupons;
    private final CouponService couponService;
    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final AppProperties props;

    public AdminCatalogController(MovieAdminService movieAdmin, TmdbClient tmdb, CityRepository cities, CinemaRepository cinemas,
                                  AuditoriumRepository auditoriums, LayoutService layouts, CouponRepository coupons,
                                  CouponService couponService, JdbcTemplate jdbc, AuditService audit, AppProperties props) {
        this.movieAdmin = movieAdmin;
        this.tmdb = tmdb;
        this.cities = cities;
        this.cinemas = cinemas;
        this.auditoriums = auditoriums;
        this.layouts = layouts;
        this.coupons = coupons;
        this.couponService = couponService;
        this.jdbc = jdbc;
        this.audit = audit;
        this.props = props;
    }

    // ------------------------------------------------------------------ movies

    @GetMapping("/movies")
    public PageResponse<MovieAdminService.AdminMovie> movies(@RequestParam(required = false) String q,
                                                             @RequestParam(required = false) String status,
                                                             @RequestParam(required = false) Integer page,
                                                             @RequestParam(required = false) Integer size) {
        return movieAdmin.list(q, status, PageResponse.clampPage(page), PageResponse.clampSize(size));
    }

    @GetMapping("/movies/{id}")
    public MovieAdminService.AdminMovie movie(@PathVariable Long id) {
        return movieAdmin.get(id);
    }

    @PostMapping("/movies")
    @ResponseStatus(HttpStatus.CREATED)
    public MovieAdminService.AdminMovie createMovie(@Valid @RequestBody MovieAdminService.MovieInput body) {
        return movieAdmin.create(body);
    }

    @PutMapping("/movies/{id}")
    public MovieAdminService.AdminMovie updateMovie(@PathVariable Long id, @Valid @RequestBody MovieAdminService.MovieInput body) {
        return movieAdmin.update(id, body);
    }

    @PostMapping("/movies/{id}/status")
    public MovieAdminService.AdminMovie movieStatus(@PathVariable Long id, @Valid @RequestBody StatusRequest body) {
        return movieAdmin.setStatus(id, body.status());
    }

    @DeleteMapping("/movies/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteMovie(@PathVariable Long id) {
        movieAdmin.delete(id);
    }

    @GetMapping("/tmdb/search")
    public List<TmdbClient.SearchResult> tmdbSearch(@RequestParam String q) {
        if (q.isBlank() || q.length() > 100) {
            throw ApiException.badRequest("Enter a search term of up to 100 characters");
        }
        return tmdb.search(q.trim());
    }

    @PostMapping("/tmdb/import")
    public MovieAdminService.AdminMovie tmdbImport(@Valid @RequestBody ImportRequest body) {
        return movieAdmin.importFromTmdb(tmdb.details(body.tmdbId()));
    }

    // ------------------------------------------------------------------ cities

    @GetMapping("/cities")
    public List<City> cities() {
        return cities.findAll().stream().sorted((a, b) -> Integer.compare(a.getSortOrder(), b.getSortOrder())).toList();
    }

    @PostMapping("/cities")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public City createCity(@Valid @RequestBody CityInput body) {
        return saveCity(new City(), body);
    }

    @PutMapping("/cities/{id}")
    @Transactional
    public City updateCity(@PathVariable Long id, @Valid @RequestBody CityInput body) {
        return saveCity(cities.findById(id).orElseThrow(() -> ApiException.notFound("City")), body);
    }

    private City saveCity(City city, CityInput body) {
        try {
            ZoneId.of(body.timezone());
        } catch (Exception e) {
            throw ApiException.badRequest("Unknown timezone " + body.timezone());
        }
        if (body.isDefault()) {
            // Clear the old default first: the partial unique index allows only one.
            jdbc.update("update cities set is_default = false where is_default and id is distinct from ?", city.getId());
        }
        city.setName(body.name().trim());
        city.setSlug(Tokens.slugify(body.slug() == null || body.slug().isBlank() ? body.name() : body.slug()));
        city.setTimezone(body.timezone());
        city.setDefault(body.isDefault());
        City saved = cities.saveAndFlush(city);
        audit.record("city.saved", "city", saved.getId(), Map.of("name", saved.getName()));
        return saved;
    }

    // ------------------------------------------------------------------ cinemas & auditoriums

    @GetMapping("/cinemas")
    public List<AdminCinema> cinemas() {
        return cinemas.findAll().stream().sorted((a, b) -> a.getName().compareTo(b.getName()))
                .map(c -> toAdmin(c, false)).toList();
    }

    @GetMapping("/cinemas/{id}")
    public AdminCinema cinema(@PathVariable Long id) {
        return toAdmin(cinemas.findById(id).orElseThrow(() -> ApiException.notFound("Cinema")), true);
    }

    @PostMapping("/cinemas")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public AdminCinema createCinema(@Valid @RequestBody CinemaInput body) {
        return saveCinema(new Cinema(), body);
    }

    @PutMapping("/cinemas/{id}")
    @Transactional
    public AdminCinema updateCinema(@PathVariable Long id, @Valid @RequestBody CinemaInput body) {
        return saveCinema(cinemas.findById(id).orElseThrow(() -> ApiException.notFound("Cinema")), body);
    }

    private AdminCinema saveCinema(Cinema c, CinemaInput body) {
        cities.findById(body.cityId()).orElseThrow(() -> ApiException.badRequest("Unknown city"));
        c.setCityId(body.cityId());
        c.setName(body.name().trim());
        String slug = Tokens.slugify(body.slug() == null || body.slug().isBlank() ? body.name() : body.slug());
        var clash = cinemas.findBySlug(slug);
        if (clash.isPresent() && !clash.get().getId().equals(c.getId())) {
            throw ApiException.conflict("SLUG_TAKEN", "Another cinema already uses the address /cinemas/" + slug);
        }
        c.setSlug(slug);
        c.setAddress(body.address().trim());
        c.setLatitude(body.latitude());
        c.setLongitude(body.longitude());
        c.setPhone(body.phone());
        c.setDescription(body.description());
        c.setFacilities(body.facilities() == null ? List.of() : body.facilities());
        c.setImageUrl(body.imageUrl() == null || body.imageUrl().isBlank()
                ? "/api/media/artwork/cinema/" + slug + ".svg" : body.imageUrl());
        c.setStatus(body.status() == null ? "ACTIVE" : body.status());
        Cinema saved = cinemas.saveAndFlush(c);
        audit.record("cinema.saved", "cinema", saved.getId(), Map.of("name", saved.getName()));
        return toAdmin(saved, true);
    }

    @PostMapping("/cinemas/{cinemaId}/auditoriums")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public AdminAuditorium createAuditorium(@PathVariable Long cinemaId, @Valid @RequestBody AuditoriumCreate body) {
        cinemas.findById(cinemaId).orElseThrow(() -> ApiException.notFound("Cinema"));
        var a = new Auditorium();
        a.setCinemaId(cinemaId);
        a.setName(body.name().trim());
        a.setFormats(body.formats().stream().distinct().toList());
        a.setGridRows(body.gridRows());
        a.setGridCols(body.gridCols());
        Auditorium saved = auditoriums.saveAndFlush(a);
        // Every hall starts with one category so a layout can be drawn straight away.
        jdbc.update("insert into seat_categories (auditorium_id, code, name, color, sort_order) values (?, 'CLASSIC', 'Classic', '#8B8B95', 1)",
                saved.getId());
        audit.record("auditorium.created", "auditorium", saved.getId(), Map.of("cinemaId", cinemaId));
        return toAdmin(saved);
    }

    @PutMapping("/auditoriums/{id}")
    @Transactional
    public AdminAuditorium updateAuditorium(@PathVariable Long id, @Valid @RequestBody AuditoriumUpdate body) {
        Auditorium a = auditoriums.findById(id).orElseThrow(() -> ApiException.notFound("Auditorium"));
        a.setName(body.name().trim());
        a.setFormats(body.formats().stream().distinct().toList());
        a.setActive(body.isActive());
        auditoriums.saveAndFlush(a);
        audit.record("auditorium.updated", "auditorium", id, Map.of());
        return toAdmin(a);
    }

    @GetMapping("/auditoriums/{id}/layout")
    public LayoutService.Layout layout(@PathVariable Long id) {
        return layouts.get(id);
    }

    @PutMapping("/auditoriums/{id}/layout")
    public LayoutService.Layout saveLayout(@PathVariable Long id, @Valid @RequestBody LayoutService.LayoutInput body) {
        return layouts.save(id, body);
    }

    private AdminCinema toAdmin(Cinema c, boolean withHalls) {
        String cityName = cities.findById(c.getCityId()).map(City::getName).orElse("");
        List<AdminAuditorium> halls = jdbc.queryForList("select id from auditoriums where cinema_id = ? order by name", Long.class, c.getId())
                .stream().map(id -> toAdmin(auditoriums.findById(id).orElseThrow())).toList();
        return new AdminCinema(c.getId(), c.getCityId(), cityName, c.getName(), c.getSlug(), c.getAddress(), c.getLatitude(),
                c.getLongitude(), c.getPhone(), c.getDescription(), c.getFacilities(), props.absoluteUrl(c.getImageUrl()),
                c.getStatus(), halls.size(), withHalls ? halls : List.of());
    }

    private AdminAuditorium toAdmin(Auditorium a) {
        Integer seats = jdbc.queryForObject("select count(*) from seats where auditorium_id = ? and is_active", Integer.class, a.getId());
        return new AdminAuditorium(a.getId(), a.getName(), a.getFormats(), a.getGridRows(), a.getGridCols(), a.isActive(),
                seats == null ? 0 : seats, layouts.isLocked(a.getId()));
    }

    // ------------------------------------------------------------------ coupons

    @GetMapping("/coupons")
    public PageResponse<AdminCoupon> coupons(@RequestParam(required = false) Integer page, @RequestParam(required = false) Integer size) {
        var p = org.springframework.data.domain.PageRequest.of(PageResponse.clampPage(page), PageResponse.clampSize(size),
                org.springframework.data.domain.Sort.by("createdAt").descending());
        return PageResponse.from(coupons.findAll(p), this::toAdmin);
    }

    @PostMapping("/coupons")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public AdminCoupon createCoupon(@Valid @RequestBody CouponInput body) {
        if (coupons.findByCode(body.code()).isPresent()) {
            throw ApiException.conflict("COUPON_EXISTS", "A coupon with this code already exists");
        }
        return saveCoupon(new Coupon(), body);
    }

    @PutMapping("/coupons/{id}")
    @Transactional
    public AdminCoupon updateCoupon(@PathVariable Long id, @Valid @RequestBody CouponInput body) {
        Coupon c = coupons.findById(id).orElseThrow(() -> ApiException.notFound("Coupon"));
        var clash = coupons.findByCode(body.code());
        if (clash.isPresent() && !clash.get().getId().equals(id)) {
            throw ApiException.conflict("COUPON_EXISTS", "A coupon with this code already exists");
        }
        return saveCoupon(c, body);
    }

    private AdminCoupon saveCoupon(Coupon c, CouponInput in) {
        if (in.discountType() == Coupon.DiscountType.PERCENT && in.discountValue() > 10_000) {
            throw ApiException.badRequest("A percentage discount can't exceed 100%");
        }
        if (in.validFrom() != null && in.validUntil() != null && !in.validUntil().isAfter(in.validFrom())) {
            throw ApiException.badRequest("The end date must be after the start date");
        }
        c.setCode(in.code().trim().toUpperCase());
        c.setDescription(in.description() == null ? "" : in.description().trim());
        c.setDiscountType(in.discountType());
        c.setDiscountValue(in.discountValue());
        c.setMaxDiscountMinor(in.maxDiscountMinor());
        c.setMinSubtotalMinor(in.minSubtotalMinor() == null ? 0 : in.minSubtotalMinor());
        c.setValidFrom(in.validFrom());
        c.setValidUntil(in.validUntil());
        c.setUsageLimit(in.usageLimit());
        c.setPerUserLimit(in.perUserLimit());
        c.setMovieId(in.movieId());
        c.setCinemaId(in.cinemaId());
        c.setActive(in.isActive());
        Coupon saved = coupons.saveAndFlush(c);
        audit.record("coupon.saved", "coupon", saved.getId(), Map.of("code", saved.getCode()));
        return toAdmin(saved);
    }

    private AdminCoupon toAdmin(Coupon c) {
        return new AdminCoupon(c.getId(), c.getCode(), c.getDescription(), c.getDiscountType(), c.getDiscountValue(),
                c.getMaxDiscountMinor(), c.getMinSubtotalMinor(), c.getValidFrom(), c.getValidUntil(), c.getUsageLimit(),
                c.getPerUserLimit(), c.getMovieId(), c.getCinemaId(), c.isActive(), couponService.usedCount(c.getId()),
                c.getCreatedAt());
    }

    // ------------------------------------------------------------------ promotions

    @GetMapping("/promotions")
    public List<Map<String, Object>> promotions() {
        return jdbc.queryForList("""
                select id, title, subtitle, image_url as "imageUrl", cta_label as "ctaLabel", cta_url as "ctaUrl",
                       coupon_code as "couponCode", starts_at as "startsAt", ends_at as "endsAt", is_active as "isActive",
                       sort_order as "sortOrder", created_at as "createdAt"
                from promotions order by sort_order, id
                """);
    }

    @PostMapping("/promotions")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> createPromotion(@Valid @RequestBody PromotionInput in) {
        Long id = jdbc.queryForObject("""
                insert into promotions (title, subtitle, image_url, cta_label, cta_url, coupon_code, starts_at, ends_at, is_active, sort_order)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id
                """, Long.class, promoArgs(in));
        audit.record("promotion.created", "promotion", id, Map.of("title", in.title()));
        return promotion(id);
    }

    @PutMapping("/promotions/{id}")
    @Transactional
    public Map<String, Object> updatePromotion(@PathVariable Long id, @Valid @RequestBody PromotionInput in) {
        Object[] base = promoArgs(in);
        Object[] args = java.util.Arrays.copyOf(base, base.length + 1);
        args[base.length] = id;
        int n = jdbc.update("""
                update promotions set title = ?, subtitle = ?, image_url = ?, cta_label = ?, cta_url = ?, coupon_code = ?,
                       starts_at = ?, ends_at = ?, is_active = ?, sort_order = ? where id = ?
                """, args);
        if (n == 0) {
            throw ApiException.notFound("Promotion");
        }
        audit.record("promotion.updated", "promotion", id, Map.of());
        return promotion(id);
    }

    @DeleteMapping("/promotions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void deletePromotion(@PathVariable Long id) {
        jdbc.update("delete from promotions where id = ?", id);
        audit.record("promotion.deleted", "promotion", id, Map.of());
    }

    private Map<String, Object> promotion(Long id) {
        return promotions().stream().filter(p -> id.equals(((Number) p.get("id")).longValue())).findFirst()
                .orElseThrow(() -> ApiException.notFound("Promotion"));
    }

    private static Object[] promoArgs(PromotionInput in) {
        return new Object[] {in.title().trim(), in.subtitle(), blank(in.imageUrl()), blank(in.ctaLabel()), blank(in.ctaUrl()),
                in.couponCode() == null || in.couponCode().isBlank() ? null : in.couponCode().trim().toUpperCase(),
                in.startsAt() == null ? null : java.sql.Timestamp.from(in.startsAt()),
                in.endsAt() == null ? null : java.sql.Timestamp.from(in.endsAt()), in.isActive(), in.sortOrder()};
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
