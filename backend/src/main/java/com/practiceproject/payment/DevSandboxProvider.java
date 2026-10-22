package com.practiceproject.payment;

import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * DEVELOPMENT-ONLY payment simulator. It behaves like a real gateway (redirect away, choose
 * an outcome, redirect back, server-side check), so the whole flow can be exercised offline.
 * No money moves. ProductionSafetyCheck refuses to start the prod profile while it is on.
 *
 * The "gateway's truth" is the decision row written to payment_events by DevSandboxController.
 */
@Component
public class DevSandboxProvider implements PaymentProvider {

    private final AppProperties props;
    private final JdbcTemplate jdbc;

    public DevSandboxProvider(AppProperties props, JdbcTemplate jdbc) {
        this.props = props;
        this.jdbc = jdbc;
    }

    @Override
    public Payment.Provider code() {
        return Payment.Provider.DEV_SANDBOX;
    }

    @Override
    public String displayName() {
        return "Payment simulator (development)";
    }

    @Override
    public String mode() {
        return "SIMULATOR";
    }

    @Override
    public boolean enabled() {
        return props.payments().devSandboxEnabled();
    }

    @Override
    public StartResult start(Payment payment, StartContext context) {
        return new StartResult(redirect(payment), "SIM-" + payment.getMerchantTxnId(), Map.of());
    }

    @Override
    public Redirect resume(Payment payment, StartContext context, Map<String, Object> initiatedEvent) {
        return redirect(payment);
    }

    @Override
    public Verification check(Payment payment) {
        List<String> decisions = jdbc.queryForList("""
                select payload->>'decision' from payment_events
                where payment_id = ? and event_type = 'SIMULATOR_DECISION'
                order by id desc limit 1
                """, String.class, payment.getId());
        if (decisions.isEmpty()) {
            return new Verification(Outcome.PENDING, payment.getProviderTxnId(), null, "Simulator: no decision yet", Map.of());
        }
        String decision = decisions.getFirst();
        Outcome outcome = switch (decision) {
            case "approve" -> Outcome.SUCCEEDED;
            case "decline" -> Outcome.FAILED;
            default -> Outcome.CANCELLED;
        };
        return new Verification(outcome, payment.getProviderTxnId(), payment.getAmountMinor(),
                "Simulator decision: " + decision, Map.of("decision", decision));
    }

    /** Signature binding the simulator page to one payment, so it can't be replayed for another. */
    public String signature(Long paymentId) {
        return Tokens.hmacSha256Base64(props.signingSecret(), "dev-sandbox:" + paymentId)
                .replace('+', '-').replace('/', '_').replace("=", "");
    }

    private Redirect redirect(Payment payment) {
        String url = props.publicBaseUrl().replaceAll("/$", "") + "/api/payments/dev/checkout/" + payment.getId()
                + "?sig=" + signature(payment.getId());
        return new Redirect("GET", url, Map.of());
    }
}
