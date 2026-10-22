package com.practiceproject.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.practiceproject.auth.SessionUserRefreshFilter;
import com.practiceproject.auth.UserRepository;
import com.practiceproject.common.ErrorResponse;
import com.practiceproject.common.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.function.Supplier;
import org.slf4j.MDC;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.util.StringUtils;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Security model:
 * <ul>
 *   <li>Session cookie auth (PPSESSION, httpOnly, SameSite=Lax), sessions stored in Postgres.</li>
 *   <li>CSRF: double-submit cookie. The browser can read XSRF-TOKEN and must echo it in the
 *       X-XSRF-TOKEN header. Another site can make the browser send our cookies, but it
 *       cannot read our cookie to copy it into a header, so forged requests fail.</li>
 *   <li>Coarse URL rules here; fine-grained checks (e.g. "is this your booking?") in services.</li>
 * </ul>
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    PasswordEncoder passwordEncoder() {
        // "{bcrypt}$2a$10$..." format: the prefix records the algorithm so we can upgrade later
        // without breaking existing hashes (AuthService re-hashes on login when needed).
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, ObjectMapper mapper, UserRepository users,
                                    SecurityContextRepository contextRepository, AppProperties props) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsSource(props)))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler())
                        // Gateway callbacks come from the gateway's redirect, not our SPA; they are
                        // verified with signatures and server-to-server status checks instead.
                        .ignoringRequestMatchers("/api/payments/esewa/**", "/api/payments/khalti/**", "/api/payments/dev/**"))
                .securityContext(sc -> sc.securityContextRepository(contextRepository))
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .headers(h -> h
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
                                        + "script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"))
                        .referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                        .frameOptions(f -> f.deny()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers("/api/admin/**").hasAnyRole("ADMIN", "CINEMA_MANAGER")
                        .requestMatchers("/api/me/**", "/api/auth/resend-verification").authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) ->
                                writeError(mapper, res, 401, "UNAUTHENTICATED", "Please sign in"))
                        .accessDeniedHandler((req, res, ex) -> {
                            if (ex instanceof CsrfException) {
                                writeError(mapper, res, 403, "CSRF_INVALID", "Your session token is missing or expired. Refresh the page and try again.");
                            } else {
                                writeError(mapper, res, 403, "FORBIDDEN", "You do not have access to this resource");
                            }
                        }))
                .addFilterAfter(new SessionUserRefreshFilter(users, contextRepository), SecurityContextHolderFilter.class);
        return http.build();
    }

    private static CorsConfigurationSource corsSource(AppProperties props) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(props.allowedOriginList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        config.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN", "Idempotency-Key", "X-Request-Id"));
        config.setExposedHeaders(List.of("X-Request-Id", "Content-Disposition"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    private static void writeError(ObjectMapper mapper, HttpServletResponse res, int status, String code, String message)
            throws IOException {
        res.setStatus(status);
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(res.getOutputStream(), ErrorResponse.of(code, message, MDC.get(RequestIdFilter.MDC_KEY)));
    }

    /**
     * The handler Spring Security documents for single-page apps: it accepts the raw token
     * from the header, keeps BREACH protection (XOR masking) for server-rendered forms, and
     * loads the token on every request so the cookie is always present.
     */
    static final class SpaCsrfTokenRequestHandler implements CsrfTokenRequestHandler {
        private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
        private final CsrfTokenRequestHandler xor = new XorCsrfTokenRequestAttributeHandler();

        @Override
        public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
            xor.handle(request, response, csrfToken);
            csrfToken.get();
        }

        @Override
        public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
            String header = request.getHeader(csrfToken.getHeaderName());
            return (StringUtils.hasText(header) ? plain : xor).resolveCsrfTokenValue(request, csrfToken);
        }
    }
}
