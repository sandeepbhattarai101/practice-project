package com.practiceproject.payment;

import com.practiceproject.common.Formats;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

/**
 * The development payment simulator's "gateway page". Only active when
 * PAYMENT_DEV_SANDBOX_ENABLED=true. Every request must carry the HMAC signature
 * issued for that payment.
 */
@RestController
@RequestMapping("/api/payments/dev")
public class DevSandboxController {

    private static final Set<String> DECISIONS = Set.of("approve", "decline", "cancel");

    private final DevSandboxProvider sandbox;
    private final PaymentRepository payments;
    private final PaymentService paymentService;
    private final JdbcTemplate jdbc;
    private final AppProperties props;

    public DevSandboxController(DevSandboxProvider sandbox, PaymentRepository payments, PaymentService paymentService,
                                JdbcTemplate jdbc, AppProperties props) {
        this.sandbox = sandbox;
        this.payments = payments;
        this.paymentService = paymentService;
        this.jdbc = jdbc;
        this.props = props;
    }

    @GetMapping(value = "/checkout/{paymentId}", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> page(@PathVariable Long paymentId, @RequestParam String sig) {
        Payment payment = valid(paymentId, sig);
        if (payment == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.TEXT_PLAIN).body("Not found");
        }
        String reference = jdbc.queryForObject("select reference from bookings where id = ?", String.class, payment.getBookingId());
        String amount = Formats.money(payment.getAmountMinor(), props.currencySymbol());
        String action = "/api/payments/dev/checkout/" + paymentId;
        String html = """
                <!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Payment simulator</title><style>
                body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#ececf1;font-family:system-ui,sans-serif}
                main{width:min(420px,92vw);background:#16161d;border:1px solid #2a2a35;border-radius:10px;padding:28px}
                .tag{display:inline-block;background:#3b2a07;color:#f5b544;border-radius:4px;padding:3px 8px;font-size:12px;letter-spacing:.06em}
                h1{font-size:20px;margin:14px 0 4px} p{color:#a3a3b2;font-size:14px;line-height:1.5}
                .amt{font-size:32px;font-weight:700;margin:18px 0;color:#fff}
                button{width:100%%;padding:13px;margin-top:10px;border-radius:6px;border:1px solid #333;font-size:15px;font-weight:600;cursor:pointer}
                .ok{background:#f5b544;color:#111;border-color:#f5b544}.no{background:#1f1f28;color:#ececf1}
                button:focus-visible{outline:3px solid #fff;outline-offset:2px}
                </style></head><body><main>
                <span class="tag">DEVELOPMENT SIMULATOR · NO REAL MONEY</span>
                <h1>Pay for booking %s</h1>
                <p>This page stands in for a payment gateway so the full flow can be tested locally. Pick an outcome.</p>
                <div class="amt">%s</div>
                <form method="post" action="%s">
                  <input type="hidden" name="sig" value="%s">
                  <button class="ok" name="decision" value="approve">Approve payment</button>
                  <button class="no" name="decision" value="decline">Decline (card failure)</button>
                  <button class="no" name="decision" value="cancel">Cancel and go back</button>
                </form></main></body></html>
                """.formatted(HtmlUtils.htmlEscape(reference), HtmlUtils.htmlEscape(amount), action, HtmlUtils.htmlEscape(sig));
        return ResponseEntity.ok()
                // form-action must also allow the frontend: browsers apply it to the redirect after the POST.
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "
                        + props.frontendUrl() + "; frame-ancestors 'none'")
                .contentType(MediaType.TEXT_HTML)
                .body(html);
    }

    @PostMapping(value = "/checkout/{paymentId}", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
    public ResponseEntity<Void> decide(@PathVariable Long paymentId, @RequestParam String sig, @RequestParam String decision) {
        Payment payment = valid(paymentId, sig);
        if (payment == null || !DECISIONS.contains(decision)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        paymentService.event(paymentId, "SIMULATOR_DECISION", Map.of("decision", decision));
        Payment.Status status = paymentService.reconcile(paymentId, "simulator-return");
        return ResponseEntity.status(HttpStatus.SEE_OTHER).location(URI.create(paymentService.returnUrl(paymentId, status))).build();
    }

    private Payment valid(Long paymentId, String sig) {
        if (!sandbox.enabled() || !Tokens.constantTimeEquals(sandbox.signature(paymentId), sig)) {
            return null;
        }
        return payments.findById(paymentId).filter(p -> p.getProvider() == Payment.Provider.DEV_SANDBOX).orElse(null);
    }
}
