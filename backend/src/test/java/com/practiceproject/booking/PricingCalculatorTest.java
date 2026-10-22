package com.practiceproject.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Plain unit tests: no Spring, no database, run in milliseconds. */
class PricingCalculatorTest {

    @Test
    void appliesDiscountThenFeesThenTax() {
        var p = PricingCalculator.calculate(80000, 8000, 2, 2500, 1300);
        assertThat(p.discountMinor()).isEqualTo(8000);
        assertThat(p.feeMinor()).isEqualTo(5000);
        assertThat(p.taxMinor()).isEqualTo(10010);       // 13% of 770.00
        assertThat(p.totalMinor()).isEqualTo(87010);
    }

    @Test
    void discountNeverExceedsSubtotal() {
        var p = PricingCalculator.calculate(30000, 999999, 1, 0, 0);
        assertThat(p.discountMinor()).isEqualTo(30000);
        assertThat(p.totalMinor()).isZero();
    }

    @Test
    void taxRoundsHalfUp() {
        // 13% of 0.50 = 0.065 -> 0.07 (half-up), never truncated
        assertThat(PricingCalculator.calculate(50, 0, 0, 0, 1300).taxMinor()).isEqualTo(7);
    }

    @Test
    void refundsRoundDown() {
        assertThat(PricingCalculator.refund(107350, 90)).isEqualTo(96615);
        assertThat(PricingCalculator.refund(999, 90)).isEqualTo(899);
        assertThat(PricingCalculator.refund(999, 100)).isEqualTo(999);
        assertThat(PricingCalculator.refund(999, 0)).isZero();
    }

    @Test
    void rejectsNegativeInputs() {
        assertThatThrownBy(() -> PricingCalculator.calculate(-1, 0, 0, 0, 0)).isInstanceOf(IllegalArgumentException.class);
    }
}
