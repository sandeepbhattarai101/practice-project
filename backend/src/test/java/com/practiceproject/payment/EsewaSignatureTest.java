package com.practiceproject.payment;

import static org.assertj.core.api.Assertions.assertThat;

import com.practiceproject.common.Tokens;
import org.junit.jupiter.api.Test;

class EsewaSignatureTest {

    @Test
    void producesTheSignatureEsewaAccepts() {
        // Pinned value: this algorithm was checked against eSewa's live UAT form on 22/10/2026.
        // A correctly signed form got HTTP 302 to the payment page; a tampered signature got
        // 400 {"code":"ES104","message":"Invalid payload signature."}.
        String message = "total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST";
        assertThat(Tokens.hmacSha256Base64("8gBm/:&EnhH.1/q", message)).isEqualTo("5DZywcrTKD0gia/rsSMcrRHmJl+4Tbol6S+lWgdJ94E=");
    }

    @Test
    void amountsAreFormattedWithoutTrailingZeros() {
        assertThat(EsewaProvider.rupees(10000)).isEqualTo("100");
        assertThat(EsewaProvider.rupees(125050)).isEqualTo("1250.5");
        assertThat(EsewaProvider.toMinor("1,250.50")).isEqualTo(125050L);
        assertThat(EsewaProvider.toMinor("100.0")).isEqualTo(10000L);
    }
}
