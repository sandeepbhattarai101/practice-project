package com.practiceproject.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Fixed-window rate limiting for the endpoints people abuse: login, sign-up,
 * password reset, seat holds, coupons, booking lookup and payment start.
 *
 * Counters live in this JVM's memory. That is fine for one instance; with several
 * instances behind a load balancer, move the counters to Redis (or rate limit at the
 * proxy) so a client cannot multiply its allowance by hitting different instances.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RateLimitFilter extends OncePerRequestFilter {

    record Rule(String name, String method, String pathRegex, int limit, Duration window) {
        boolean matches(HttpServletRequest req) {
            return method.equals(req.getMethod()) && req.getRequestURI().matches(pathRegex);
        }
    }

    private static final List<Rule> RULES = List.of(
            new Rule("login", "POST", "/api/auth/login", 10, Duration.ofMinutes(1)),
            new Rule("register", "POST", "/api/auth/register", 5, Duration.ofMinutes(10)),
            new Rule("forgot", "POST", "/api/auth/(forgot-password|resend-verification)", 5, Duration.ofMinutes(15)),
            new Rule("hold", "POST", "/api/bookings", 20, Duration.ofMinutes(5)),
            new Rule("coupon", "POST", "/api/bookings/[^/]+/coupon", 15, Duration.ofMinutes(5)),
            new Rule("lookup", "POST", "/api/bookings/lookup", 10, Duration.ofMinutes(5)),
            new Rule("pay", "POST", "/api/bookings/[^/]+/payments(/verify)?", 30, Duration.ofMinutes(5)),
            new Rule("checkin", "POST", "/api/admin/checkin/.*", 120, Duration.ofMinutes(1)));

    private record Window(long startedAtMillis, AtomicInteger count) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private volatile boolean enabled = true;

    public RateLimitFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** Tests switch this off so they can hammer endpoints. */
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (enabled) {
            for (Rule rule : RULES) {
                if (rule.matches(request) && !allow(rule, request.getRemoteAddr())) {
                    response.setStatus(429);
                    response.setHeader("Retry-After", String.valueOf(rule.window().toSeconds()));
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    objectMapper.writeValue(response.getOutputStream(), ErrorResponse.of("RATE_LIMITED",
                            "Too many attempts. Please wait a moment and try again.", MDC.get(RequestIdFilter.MDC_KEY)));
                    return;
                }
            }
        }
        chain.doFilter(request, response);
    }

    private boolean allow(Rule rule, String clientIp) {
        long now = System.currentTimeMillis();
        String key = rule.name() + "|" + clientIp;
        Window window = windows.compute(key, (k, existing) ->
                existing == null || now - existing.startedAtMillis() >= rule.window().toMillis()
                        ? new Window(now, new AtomicInteger())
                        : existing);
        return window.count().incrementAndGet() <= rule.limit();
    }

    @Scheduled(fixedDelay = 60_000)
    void evictOldWindows() {
        long cutoff = System.currentTimeMillis() - Duration.ofMinutes(30).toMillis();
        windows.entrySet().removeIf(e -> e.getValue().startedAtMillis() < cutoff);
    }
}
