package com.practiceproject.payment;

import java.util.Map;

/**
 * One payment gateway. The flow for every gateway:
 * <ol>
 *   <li>{@link #start}: build where to send the customer (a redirect or an auto-submitted form).</li>
 *   <li>The customer pays on the gateway's site; the gateway redirects the browser back to OUR backend.</li>
 *   <li>{@link #check}: we ask the gateway server-to-server what really happened. Only that answer
 *       confirms a booking. The browser redirect alone proves nothing: anyone can type a success URL.</li>
 * </ol>
 */
public interface PaymentProvider {

    Payment.Provider code();

    String displayName();

    /** TEST, LIVE or SIMULATOR, shown to customers so test mode is never mistaken for real. */
    String mode();

    boolean enabled();

    StartResult start(Payment payment, StartContext context);

    /** Rebuilds the redirect for an existing payment (an idempotent retry of "Pay"). */
    Redirect resume(Payment payment, StartContext context, Map<String, Object> initiatedEvent);

    /** Server-to-server status check. Must not trust anything the browser sent. */
    Verification check(Payment payment);

    record StartContext(String bookingReference, String description, String customerName, String customerEmail,
                        String customerPhone) {}

    record Redirect(String method, String url, Map<String, String> fields) {}

    /** providerTxnId is known at start for some gateways (Khalti pidx); eventPayload is logged to payment_events. */
    record StartResult(Redirect redirect, String providerTxnId, Map<String, Object> eventPayload) {}

    enum Outcome { SUCCEEDED, FAILED, CANCELLED, PENDING, NOT_FOUND }

    record Verification(Outcome outcome, String providerTxnId, Long amountMinor, String message, Map<String, Object> raw) {}

    /** The gateway could not be reached or rejected the request. */
    class ProviderException extends RuntimeException {
        public ProviderException(String message, Throwable cause) {
            super(message, cause);
        }

        public ProviderException(String message) {
            super(message);
        }
    }
}
