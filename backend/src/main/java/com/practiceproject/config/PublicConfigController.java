package com.practiceproject.config;

import com.practiceproject.payment.PaymentProviders;
import com.practiceproject.settings.SettingsService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Settings the frontend needs to render prices, limits and payment options. No secrets here. */
@RestController
public class PublicConfigController {

    public record ProviderInfo(String code, String name, String mode) {}

    public record Cancellation(int cutoffHours, int refundPercent) {}

    public record PublicConfig(String currency, String currencySymbol, int holdMinutes, int maxSeatsPerBooking,
                               long serviceFeeMinor, int taxRateBasisPoints, String taxLabel, Cancellation cancellation,
                               List<ProviderInfo> paymentProviders, String supportEmail, boolean tmdbEnabled) {}

    private final AppProperties props;
    private final SettingsService settings;
    private final PaymentProviders providers;

    public PublicConfigController(AppProperties props, SettingsService settings, PaymentProviders providers) {
        this.props = props;
        this.settings = settings;
        this.providers = providers;
    }

    @GetMapping("/api/config")
    public PublicConfig config() {
        var b = settings.booking();
        var list = providers.enabled().stream()
                .map(p -> new ProviderInfo(p.code().name(), p.displayName(), p.mode()))
                .toList();
        return new PublicConfig(props.currency(), props.currencySymbol(), b.holdMinutes(), b.maxSeatsPerBooking(),
                b.serviceFeeMinor(), b.taxRateBasisPoints(), b.taxLabel(),
                new Cancellation(b.cancellationCutoffHours(), b.refundPercent()), list, settings.supportEmail(),
                props.tmdb().enabled());
    }
}
