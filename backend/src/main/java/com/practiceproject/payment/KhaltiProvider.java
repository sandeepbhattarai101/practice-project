package com.practiceproject.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.practiceproject.common.Json;
import com.practiceproject.config.AppProperties;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Khalti ePayment (KPG-2): server-side initiate returns a pidx and payment_url; after payment
 * Khalti redirects to return_url and we confirm with the lookup API.
 * Reference: https://docs.khalti.com/khalti-epayment/
 *
 * Disabled until KHALTI_SECRET_KEY is set (sandbox keys: https://test-admin.khalti.com).
 */
@Component
public class KhaltiProvider implements PaymentProvider {

    private final AppProperties props;
    private final AppProperties.Khalti config;
    private final RestClient http;
    private final Json json;

    public KhaltiProvider(AppProperties props, RestClient.Builder builder, Json json) {
        this.props = props;
        this.config = props.payments().khalti();
        this.http = builder.build();
        this.json = json;
    }

    @Override
    public Payment.Provider code() {
        return Payment.Provider.KHALTI;
    }

    @Override
    public String displayName() {
        return "Khalti";
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
        Map<String, Object> customer = new LinkedHashMap<>();
        customer.put("name", context.customerName());
        customer.put("email", context.customerEmail());
        if (context.customerPhone() != null) {
            customer.put("phone", context.customerPhone());
        }
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("return_url", props.publicBaseUrl().replaceAll("/$", "") + "/api/payments/khalti/callback/" + payment.getId());
        request.put("website_url", props.frontendUrl());
        request.put("amount", payment.getAmountMinor()); // Khalti expects paisa
        request.put("purchase_order_id", payment.getMerchantTxnId());
        request.put("purchase_order_name", context.description());
        request.put("customer_info", customer);

        JsonNode body = post("/epayment/initiate/", request);
        String pidx = body.path("pidx").asText(null);
        String paymentUrl = body.path("payment_url").asText(null);
        if (pidx == null || paymentUrl == null) {
            throw new ProviderException("Khalti did not return a payment URL");
        }
        return new StartResult(new Redirect("GET", paymentUrl, Map.of()), pidx,
                Map.of("pidx", pidx, "paymentUrl", paymentUrl, "expiresAt", body.path("expires_at").asText("")));
    }

    @Override
    public Redirect resume(Payment payment, StartContext context, Map<String, Object> initiatedEvent) {
        Object url = initiatedEvent == null ? null : initiatedEvent.get("paymentUrl");
        if (url == null) {
            throw new ProviderException("Original Khalti payment link not found");
        }
        return new Redirect("GET", url.toString(), Map.of());
    }

    @Override
    public Verification check(Payment payment) {
        if (payment.getProviderTxnId() == null) {
            return new Verification(Outcome.NOT_FOUND, null, null, "No pidx recorded", Map.of());
        }
        JsonNode body = post("/epayment/lookup/", Map.of("pidx", payment.getProviderTxnId()));
        @SuppressWarnings("unchecked")
        Map<String, Object> raw = json.mapper().convertValue(body, Map.class);
        String status = body.path("status").asText("");
        Outcome outcome = switch (status) {
            case "Completed" -> Outcome.SUCCEEDED;
            case "Pending", "Initiated" -> Outcome.PENDING;
            case "User canceled" -> Outcome.CANCELLED;
            case "Expired" -> Outcome.NOT_FOUND;
            case "Refunded", "Partially Refunded" -> Outcome.FAILED;
            default -> Outcome.PENDING;
        };
        Long amount = body.has("total_amount") ? body.path("total_amount").asLong() : null;
        return new Verification(outcome, payment.getProviderTxnId(), amount, "Khalti status " + status, raw);
    }

    private JsonNode post(String path, Object body) {
        try {
            JsonNode node = http.post()
                    .uri(config.baseUrl().replaceAll("/$", "") + path)
                    .header("Authorization", "Key " + config.secretKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(JsonNode.class);
            if (node == null) {
                throw new ProviderException("Empty response from Khalti");
            }
            return node;
        } catch (ProviderException e) {
            throw e;
        } catch (Exception e) {
            throw new ProviderException("Khalti request failed: " + e.getMessage(), e);
        }
    }
}
