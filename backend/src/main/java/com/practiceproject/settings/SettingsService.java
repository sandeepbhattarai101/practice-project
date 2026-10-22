package com.practiceproject.settings;

import com.fasterxml.jackson.databind.JsonNode;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Json;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Business settings stored in the app_settings table (JSONB values). Read on demand:
 * the table is tiny and Postgres keeps it in memory, so caching would add staleness
 * bugs for no measurable gain.
 */
@Service
public class SettingsService {

    public record Setting(String key, Object value, String description, Instant updatedAt) {}

    /** Typed snapshot of the settings the booking flow needs, read once per operation. */
    public record BookingSettings(int holdMinutes, int paymentWindowMinutes, int maxSeatsPerBooking, int salesCloseMinutes,
                                  long serviceFeeMinor, int taxRateBasisPoints, String taxLabel,
                                  int cancellationCutoffHours, int refundPercent) {}

    private static final Map<String, Validator> VALIDATORS = Map.of(
            "booking.holdMinutes", new Validator(1, 60),
            "booking.paymentWindowMinutes", new Validator(3, 60),
            "booking.maxSeatsPerBooking", new Validator(1, 20),
            "booking.salesCloseMinutes", new Validator(0, 240),
            "pricing.serviceFeeMinor", new Validator(0, 1_000_000),
            "pricing.taxRateBasisPoints", new Validator(0, 5000),
            "cancellation.cutoffHours", new Validator(0, 720),
            "cancellation.refundPercent", new Validator(0, 100));

    private record Validator(long min, long max) {}

    private final JdbcTemplate jdbc;
    private final Json json;

    public SettingsService(JdbcTemplate jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public BookingSettings booking() {
        Map<String, JsonNode> all = rawValues();
        return new BookingSettings(
                intValue(all, "booking.holdMinutes", 8),
                intValue(all, "booking.paymentWindowMinutes", 15),
                intValue(all, "booking.maxSeatsPerBooking", 10),
                intValue(all, "booking.salesCloseMinutes", 10),
                intValue(all, "pricing.serviceFeeMinor", 0),
                intValue(all, "pricing.taxRateBasisPoints", 0),
                textValue(all, "pricing.taxLabel", "Tax"),
                intValue(all, "cancellation.cutoffHours", 3),
                intValue(all, "cancellation.refundPercent", 0));
    }

    public String supportEmail() {
        return textValue(rawValues(), "site.supportEmail", "support@practice-project.local");
    }

    public List<Setting> list() {
        return jdbc.query("select key, value::text, description, updated_at from app_settings order by key",
                (rs, i) -> new Setting(rs.getString(1), json.read(rs.getString(2), Object.class), rs.getString(3),
                        rs.getTimestamp(4).toInstant()));
    }

    @Transactional
    public void update(Map<String, Object> changes, Long actorUserId) {
        Map<String, JsonNode> existing = rawValues();
        for (var entry : changes.entrySet()) {
            String key = entry.getKey();
            if (!existing.containsKey(key) && !VALIDATORS.containsKey(key)) {
                throw ApiException.badRequest("Unknown setting " + key);
            }
            Validator v = VALIDATORS.get(key);
            if (v != null) {
                if (!(entry.getValue() instanceof Number n) || n.doubleValue() != Math.floor(n.doubleValue())
                        || n.longValue() < v.min() || n.longValue() > v.max()) {
                    throw ApiException.badRequest(key + " must be a whole number between " + v.min() + " and " + v.max());
                }
            } else if (!(entry.getValue() instanceof String s) || s.isBlank() || s.length() > 200) {
                throw ApiException.badRequest(key + " must be text of up to 200 characters");
            }
            // Upsert: insert the row, or update it if the key already exists.
            jdbc.update("""
                    insert into app_settings (key, value, updated_at, updated_by) values (?, ?::jsonb, now(), ?)
                    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
                    """, key, json.write(entry.getValue()), actorUserId);
        }
    }

    private Map<String, JsonNode> rawValues() {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        jdbc.query("select key, value::text from app_settings", rs -> {
            values.put(rs.getString(1), json.read(rs.getString(2), JsonNode.class));
        });
        return values;
    }

    private static int intValue(Map<String, JsonNode> all, String key, int fallback) {
        JsonNode node = all.get(key);
        return node != null && node.isNumber() ? node.asInt() : fallback;
    }

    private static String textValue(Map<String, JsonNode> all, String key, String fallback) {
        JsonNode node = all.get(key);
        return node != null && node.isTextual() ? node.asText() : fallback;
    }
}
