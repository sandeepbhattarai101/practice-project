package com.practiceproject.config;

import java.util.Arrays;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed view of the {@code app.*} block in application.yml. Binding config into a
 * record means a typo in a property name fails at start-up instead of at 3am.
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String frontendUrl,
        String publicBaseUrl,
        String allowedOrigins,
        String signingSecret,
        String currency,
        String currencySymbol,
        String mailFrom,
        Jobs jobs,
        Seed seed,
        Payments payments,
        Tmdb tmdb) {

    public record Jobs(boolean enabled) {}

    public record Seed(boolean enabled, String adminPassword) {}

    public record Payments(boolean devSandboxEnabled, Esewa esewa, Khalti khalti) {}

    public record Esewa(boolean enabled, String productCode, String secretKey, String formUrl, String statusUrl, boolean live) {}

    public record Khalti(String secretKey, String baseUrl, boolean live) {
        public boolean enabled() {
            return secretKey != null && !secretKey.isBlank();
        }
    }

    public record Tmdb(String apiKey) {
        public boolean enabled() {
            return apiKey != null && !apiKey.isBlank();
        }
    }

    public List<String> allowedOriginList() {
        return Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** Turns a server-relative path like /api/media/... into an absolute URL. */
    public String absoluteUrl(String url) {
        if (url == null || url.isBlank()) {
            return url;
        }
        return url.startsWith("/") ? publicBaseUrl.replaceAll("/$", "") + url : url;
    }
}
