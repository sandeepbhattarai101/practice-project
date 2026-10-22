package com.practiceproject.config;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Refuses to run the prod profile with development defaults (simulator payments, sample
 * data, test gateway keys, a guessable signing secret). Failing loudly at start-up beats
 * discovering it from a customer.
 */
@Component
@Profile("prod")
public class ProductionSafetyCheck {

    private final AppProperties props;

    public ProductionSafetyCheck(AppProperties props) {
        this.props = props;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void verify() {
        List<String> problems = new ArrayList<>();
        if (props.signingSecret() == null || props.signingSecret().length() < 32 || props.signingSecret().startsWith("dev-only")) {
            problems.add("APP_SIGNING_SECRET must be a random value of at least 32 characters");
        }
        if (props.payments().devSandboxEnabled()) {
            problems.add("PAYMENT_DEV_SANDBOX_ENABLED must be false");
        }
        if (props.seed().enabled()) {
            problems.add("SEED_SAMPLE_DATA must be false");
        }
        var esewa = props.payments().esewa();
        if (esewa.enabled() && (!esewa.live() || "EPAYTEST".equals(esewa.productCode()))) {
            problems.add("eSewa is enabled with test credentials: set ESEWA_LIVE=true and real ESEWA_PRODUCT_CODE / ESEWA_SECRET_KEY / URLs, or ESEWA_ENABLED=false");
        }
        if (props.payments().khalti().enabled() && !props.payments().khalti().live()) {
            problems.add("Khalti is enabled in sandbox mode: set KHALTI_LIVE=true with a live key and KHALTI_BASE_URL=https://khalti.com/api/v2");
        }
        if (!props.publicBaseUrl().startsWith("https://") || !props.frontendUrl().startsWith("https://")) {
            problems.add("PUBLIC_BASE_URL and FRONTEND_URL must be https");
        }
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Refusing to start in prod profile:\n - " + String.join("\n - ", problems));
        }
    }
}
