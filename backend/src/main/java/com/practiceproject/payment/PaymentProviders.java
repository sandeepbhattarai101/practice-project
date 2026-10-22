package com.practiceproject.payment;

import com.practiceproject.common.ApiException;
import java.util.Comparator;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Registry of gateways; Spring injects every PaymentProvider bean into the list. */
@Component
public class PaymentProviders {

    private final List<PaymentProvider> all;

    public PaymentProviders(List<PaymentProvider> all) {
        this.all = all.stream().sorted(Comparator.comparing(p -> p.code().ordinal())).toList();
    }

    public List<PaymentProvider> enabled() {
        return all.stream().filter(PaymentProvider::enabled).toList();
    }

    public PaymentProvider get(Payment.Provider code) {
        return all.stream().filter(p -> p.code() == code).findFirst()
                .orElseThrow(() -> new IllegalStateException("No provider " + code));
    }

    public PaymentProvider requireEnabled(Payment.Provider code) {
        PaymentProvider p = get(code);
        if (!p.enabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENT_PROVIDER_UNAVAILABLE",
                    p.displayName() + " is not available right now");
        }
        return p;
    }
}
