package com.practiceproject.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import java.time.Clock;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import java.net.http.HttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.client.RestClient;

@Configuration
public class PlatformConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * HTTP client for payment gateways and TMDB. Explicit timeouts: without them a slow
     * gateway can hold a request thread (and its DB connection) for minutes.
     */
    @Bean
    RestClient.Builder outboundRestClientBuilder() {
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        var factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofSeconds(15));
        return RestClient.builder().requestFactory(factory);
    }

    @Bean
    OpenAPI openApi() {
        return new OpenAPI().info(new Info().title("Practice Project API").version("v1")
                .description("Cinema booking platform. See docs/API.md for the contract."));
    }

    /** Background jobs (hold expiry, payment reconciliation, email outbox). Off in tests. */
    @Configuration
    @EnableScheduling
    @ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true")
    static class SchedulingConfig {}
}
