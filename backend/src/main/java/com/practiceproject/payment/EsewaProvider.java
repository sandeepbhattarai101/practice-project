package com.practiceproject.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.practiceproject.common.Json;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * eSewa ePay v2 (form POST + HMAC-SHA256 signature + status-check API).
 * Reference: https://developer.esewa.com.np/pages/Epay
 *
 * Default configuration uses eSewa's public UAT merchant (EPAYTEST), so the full redirect
 * flow works against their test environment with their documented test wallet. No real
 * money moves. Live credentials come from eSewa merchant onboarding.
 */
@Component
public class EsewaProvider implements PaymentProvider {

    static final String SIGNED_FIELDS = "total_amount,transaction_uuid,product_code";

    private final AppProperties.Esewa config;
    private final AppProperties props;
    private final RestClient http;
    private final Json json;

    public EsewaProvider(AppProperties props, RestClient.Builder builder, Json json) {
        this.props = props;
        this.config = props.payments().esewa();
        this.http = builder.build();
        this.json = json;
    }

    @Override
    public Payment.Provider code() {
        return Payment.Provider.ESEWA;
    }

    @Override
    public String displayName() {
        return "eSewa";
    }

    @Override
    public String mode() {
        return config.live() ? "LIVE" : "TEST";
    }

    @Override
    public boolean enabled() {
        return config.enabled();
    }

    @Override
    public StartResult start(Payment payment, StartContext context) {
        return new StartResult(buildForm(payment), null, Map.of("formUrl", config.formUrl()));
    }

    @Override
    public Redirect resume(Payment payment, StartContext context, Map<String, Object> initiatedEvent) {
        return buildForm(payment);
    }

    private Redirect buildForm(Payment payment) {
        String total = rupees(payment.getAmountMinor());
        String base = props.publicBaseUrl().replaceAll("/$", "") + "/api/payments/esewa/callback/" + payment.getId();
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("amount", total);
        fields.put("tax_amount", "0");
        fields.put("total_amount", total);
        fields.put("transaction_uuid", payment.getMerchantTxnId());
        fields.put("product_code", config.productCode());
        fields.put("product_service_charge", "0");
        fields.put("product_delivery_charge", "0");
        fields.put("success_url", base + "/success");
        fields.put("failure_url", base + "/failure");
        fields.put("signed_field_names", SIGNED_FIELDS);
        fields.put("signature", sign("total_amount=" + total + ",transaction_uuid=" + payment.getMerchantTxnId()
                + ",product_code=" + config.productCode()));
        return new Redirect("POST", config.formUrl(), fields);
    }

    /**
     * Checks the signature on the base64 "data" eSewa appends to success_url. A valid
     * signature proves eSewa produced the message; we STILL call check() before confirming.
     */
    public SignedCallback decodeCallback(String data) {
        String decoded = new String(Base64.getDecoder().decode(data), StandardCharsets.UTF_8);
        JsonNode node = json.read(decoded, JsonNode.class);
        String signedNames = node.path("signed_field_names").asText("");
        var message = new StringBuilder();
        for (String name : signedNames.split(",")) {
            if (message.length() > 0) {
                message.append(',');
            }
            message.append(name).append('=').append(node.path(name).asText(""));
        }
        boolean valid = !signedNames.isBlank()
                && Tokens.constantTimeEquals(sign(message.toString()), node.path("signature").asText(""));
        @SuppressWarnings("unchecked")
        Map<String, Object> raw = json.mapper().convertValue(node, Map.class);
        return new SignedCallback(valid, node.path("transaction_uuid").asText(null), node.path("status").asText(null), raw);
    }

    public record SignedCallback(boolean signatureValid, String transactionUuid, String status, Map<String, Object> raw) {}

    @Override
    public Verification check(Payment payment) {
        String url = UriComponentsBuilder.fromUriString(config.statusUrl())
                .queryParam("product_code", config.productCode())
                .queryParam("total_amount", rupees(payment.getAmountMinor()))
                .queryParam("transaction_uuid", payment.getMerchantTxnId())
                .build().toUriString();
        JsonNode body;
        try {
            body = http.get().uri(url).retrieve().body(JsonNode.class);
        } catch (Exception e) {
            throw new ProviderException("eSewa status check failed: " + e.getMessage(), e);
        }
        if (body == null) {
            throw new ProviderException("eSewa returned an empty status response");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> raw = json.mapper().convertValue(body, Map.class);
        String status = body.path("status").asText("");
        String refId = body.path("ref_id").isNull() ? null : body.path("ref_id").asText(null);
        Long amount = body.has("total_amount") ? toMinor(body.path("total_amount").asText()) : null;
        Outcome outcome = switch (status) {
            case "COMPLETE" -> Outcome.SUCCEEDED;
            case "PENDING", "AMBIGUOUS" -> Outcome.PENDING;
            case "CANCELED" -> Outcome.CANCELLED;
            case "NOT_FOUND" -> Outcome.NOT_FOUND;
            // A refund made outside this system (merchant portal) means it did not succeed for us.
            case "FULL_REFUND", "PARTIAL_REFUND" -> Outcome.FAILED;
            default -> Outcome.PENDING;
        };
        return new Verification(outcome, refId, amount, "eSewa status " + status, raw);
    }

    String sign(String message) {
        return Tokens.hmacSha256Base64(config.secretKey(), message);
    }

    /** 125050 paisa -> "1250.5"; whole rupees -> "1250". */
    static String rupees(long minor) {
        return BigDecimal.valueOf(minor, 2).stripTrailingZeros().toPlainString();
    }

    static Long toMinor(String rupees) {
        try {
            return new BigDecimal(rupees.replace(",", "")).setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValueExact();
        } catch (Exception e) {
            return null;
        }
    }
}
