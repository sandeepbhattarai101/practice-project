package com.practiceproject.payment;

import java.net.URI;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Where gateways send the customer's browser back to. We treat everything in these
 * requests as untrusted hints: whatever they say, we ask the gateway ourselves (reconcile)
 * and redirect the browser to the booking page, which shows the stored result.
 */
@RestController
@RequestMapping("/api/payments")
public class PaymentCallbackController {

    private static final Logger log = LoggerFactory.getLogger(PaymentCallbackController.class);

    private final PaymentService payments;
    private final EsewaProvider esewa;
    private final PaymentRepository paymentRepository;

    public PaymentCallbackController(PaymentService payments, EsewaProvider esewa, PaymentRepository paymentRepository) {
        this.payments = payments;
        this.esewa = esewa;
        this.paymentRepository = paymentRepository;
    }

    @GetMapping("/esewa/callback/{paymentId}/{result}")
    public ResponseEntity<Void> esewaCallback(@PathVariable Long paymentId, @PathVariable String result,
                                              @RequestParam(required = false) String data) {
        Payment payment = paymentRepository.findById(paymentId).orElse(null);
        if (payment == null || payment.getProvider() != Payment.Provider.ESEWA) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        if (data != null) {
            try {
                var cb = esewa.decodeCallback(data);
                payments.event(paymentId, "CALLBACK", Map.of("result", result, "signatureValid", cb.signatureValid(),
                        "data", cb.raw()));
                if (!cb.signatureValid() || !payment.getMerchantTxnId().equals(cb.transactionUuid())) {
                    log.warn("Rejected eSewa callback for payment {}: signature or transaction mismatch", paymentId);
                }
            } catch (IllegalArgumentException e) {
                payments.event(paymentId, "CALLBACK_UNREADABLE", Map.of("result", result));
            }
        } else {
            payments.event(paymentId, "CALLBACK", Map.of("result", result));
        }
        // The decision is made by the server-to-server status check, never by the callback.
        Payment.Status status = payments.reconcile(paymentId, "esewa-callback");
        return redirect(payments.returnUrl(paymentId, status));
    }

    @GetMapping("/khalti/callback/{paymentId}")
    public ResponseEntity<Void> khaltiCallback(@PathVariable Long paymentId, @RequestParam Map<String, String> params) {
        Payment payment = paymentRepository.findById(paymentId).orElse(null);
        if (payment == null || payment.getProvider() != Payment.Provider.KHALTI) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        // Keep only the fields Khalti documents; never log arbitrary query strings.
        var safe = new java.util.LinkedHashMap<String, String>();
        for (String key : new String[] {"pidx", "status", "transaction_id", "amount", "purchase_order_id"}) {
            if (params.containsKey(key)) {
                safe.put(key, params.get(key));
            }
        }
        payments.event(paymentId, "CALLBACK", Map.of("params", safe));
        Payment.Status status = payments.reconcile(paymentId, "khalti-callback");
        return redirect(payments.returnUrl(paymentId, status));
    }

    private static ResponseEntity<Void> redirect(String url) {
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create(url)).build();
    }
}
