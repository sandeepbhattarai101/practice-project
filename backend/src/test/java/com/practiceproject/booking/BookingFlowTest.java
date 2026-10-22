package com.practiceproject.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.practiceproject.IntegrationTest;
import com.practiceproject.payment.DevSandboxProvider;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;

/** The customer journey over real HTTP (MockMvc), from seat hold to ticket, invoice and refund. */
class BookingFlowTest extends IntegrationTest {

    @Autowired ObjectMapper json;
    @Autowired DevSandboxProvider sandbox;
    @Autowired BookingService bookings;

    private final MockHttpSession guest = new MockHttpSession();

    @Test
    void guestBooksPaysAndGetsTicketInvoiceThenCancelsWithRefundAndCreditNote() throws Exception {
        String ref = holdSeats(guest, fx.seatIds().get(0), fx.seatIds().get(5)); // one Classic (400) + one Premium (600)

        mvc.perform(put("/api/bookings/" + ref + "/customer").session(guest).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Asha\",\"email\":\"asha@example.com\",\"phone\":\"9800000000\"}"))
                .andExpect(status().isOk());

        jdbc.update("insert into coupons (code, discount_type, discount_value) values ('TEN', 'PERCENT', 1000)");
        mvc.perform(post("/api/bookings/" + ref + "/coupon").session(guest).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"code\":\"ten\"}"))
                .andExpect(status().isOk())
                // 1000.00 - 10% = 900; fees 2 x 25 = 50; VAT 13% of 950 = 123.50; total 1073.50
                .andExpect(jsonPath("$.pricing.subtotalMinor").value(100000))
                .andExpect(jsonPath("$.pricing.discountMinor").value(10000))
                .andExpect(jsonPath("$.pricing.feeMinor").value(5000))
                .andExpect(jsonPath("$.pricing.taxMinor").value(12350))
                .andExpect(jsonPath("$.pricing.totalMinor").value(107350));

        String key = UUID.randomUUID().toString();
        JsonNode start = startPayment(ref, key);
        long paymentId = start.path("paymentId").asLong();
        assertThat(start.path("redirect").path("url").asText()).contains("/api/payments/dev/checkout/" + paymentId);

        // Same Idempotency-Key = same payment, not a second charge.
        assertThat(startPayment(ref, key).path("paymentId").asLong()).isEqualTo(paymentId);

        // A redirect "success" in the URL proves nothing; only the gateway's answer counts.
        mvc.perform(get("/api/bookings/" + ref).session(guest)).andExpect(jsonPath("$.status").value("PAYMENT_PENDING"));

        approve(paymentId);
        approve(paymentId); // duplicate callback: must be harmless

        mvc.perform(get("/api/bookings/" + ref).session(guest))
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                .andExpect(jsonPath("$.ticket.qrPayload").value(org.hamcrest.Matchers.startsWith("PP1:" + ref + ":")))
                .andExpect(jsonPath("$.invoices[0].number").value("PP-INV-" + java.time.Year.now() + "-000001"))
                .andExpect(jsonPath("$.cancellable").value(true));
        assertThat(jdbc.queryForObject("select count(*) from payments where status = 'SUCCEEDED'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from seat_reservations where status = 'BOOKED'", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select status from coupon_redemptions", String.class)).isEqualTo("REDEEMED");
        assertThat(jdbc.queryForObject("select count(*) from notifications where type = 'BOOKING_CONFIRMED'", Integer.class)).isEqualTo(1);

        // Someone else's browser cannot see it (404, so references can't be probed).
        mvc.perform(get("/api/bookings/" + ref).session(new MockHttpSession())).andExpect(status().isNotFound());

        // Customer cancels: 90% refund, seats back on sale, credit note issued.
        mvc.perform(post("/api/bookings/" + ref + "/cancel").session(guest).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Plans changed\"}"))
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.refund.amountMinor").value(96615));
        assertThat(jdbc.queryForObject("select count(*) from seat_reservations", Integer.class)).isZero();
        var creditNote = jdbc.queryForMap("select * from invoices where kind = 'CREDIT_NOTE'");
        assertThat(creditNote.get("total_minor")).isEqualTo(96615L);

        // Issued invoices are immutable: the database trigger refuses edits.
        assertThatThrownBy(() -> jdbc.update("update invoices set total_minor = 1 where kind = 'INVOICE'"))
                .hasMessageContaining("immutable");
    }

    @Test
    void declinedPaymentLetsTheCustomerRetryWhileTheHoldLasts() throws Exception {
        String ref = holdSeats(guest, fx.seatIds().get(1));
        mvc.perform(put("/api/bookings/" + ref + "/customer").session(guest).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Bo\",\"email\":\"bo@example.com\"}")).andExpect(status().isOk());
        long first = startPayment(ref, UUID.randomUUID().toString()).path("paymentId").asLong();
        decide(first, "decline");
        mvc.perform(get("/api/bookings/" + ref).session(guest)).andExpect(jsonPath("$.status").value("HELD"))
                .andExpect(jsonPath("$.payments[0].status").value("FAILED"));

        long second = startPayment(ref, UUID.randomUUID().toString()).path("paymentId").asLong();
        approve(second);
        mvc.perform(get("/api/bookings/" + ref).session(guest)).andExpect(jsonPath("$.status").value("CONFIRMED"));
    }

    @Test
    void paymentThatArrivesAfterTheSeatWasResold_isRefundedNotDoubleSold() throws Exception {
        Long seat = fx.seatIds().get(3);
        String ref = holdSeats(guest, seat);
        mvc.perform(put("/api/bookings/" + ref + "/customer").session(guest).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Late\",\"email\":\"late@example.com\"}")).andExpect(status().isOk());
        long paymentId = startPayment(ref, UUID.randomUUID().toString()).path("paymentId").asLong();

        // The customer dawdles on the gateway; the hold expires and someone else buys the seat.
        jdbc.update("update seat_reservations set expires_at = now() - interval '1 minute'");
        jdbc.update("update bookings set hold_expires_at = now() - interval '1 minute'");
        Booking other = bookings.hold(fx.showtimeId(), List.of(seat), null, Set.of());
        assertThat(other.getStatus()).isEqualTo(Booking.Status.HELD);

        approve(paymentId); // money arrives late

        mvc.perform(get("/api/bookings/" + ref).session(guest))
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.refund.status").value("PROCESSED")); // simulator refunds instantly
        assertThat(jdbc.queryForObject("select booking_id from seat_reservations where seat_id = ?", Long.class, seat))
                .isEqualTo(other.getId());
    }

    @Test
    void missingCsrfTokenIsRejected() throws Exception {
        mvc.perform(post("/api/bookings").session(guest).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"showtimeId\":" + fx.showtimeId() + ",\"seatIds\":[" + fx.seatIds().getFirst() + "]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_INVALID"));
    }

    @Test
    void forgedSimulatorSignatureIsRefused() throws Exception {
        mvc.perform(post("/api/payments/dev/checkout/1").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .param("sig", "forged").param("decision", "approve")).andExpect(status().isNotFound());
    }

    @Test
    void seatMapShowsHeldSeatsToOthersAndMineToMe() throws Exception {
        holdSeats(guest, fx.seatIds().get(0));
        String mine = mvc.perform(get("/api/showtimes/" + fx.showtimeId() + "/seats").session(guest))
                .andReturn().getResponse().getContentAsString();
        String theirs = mvc.perform(get("/api/showtimes/" + fx.showtimeId() + "/seats").session(new MockHttpSession()))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(mine).path("seats").get(0).path("state").asText()).isEqualTo("MINE");
        assertThat(json.readTree(theirs).path("seats").get(0).path("state").asText()).isEqualTo("HELD");
        assertThat(json.readTree(theirs).path("seats").get(1).path("state").asText()).isEqualTo("AVAILABLE");
    }

    // ------------------------------------------------------------------ helpers

    private String holdSeats(MockHttpSession session, Long... seatIds) throws Exception {
        String body = "{\"showtimeId\":" + fx.showtimeId() + ",\"seatIds\":" + json.writeValueAsString(List.of(seatIds)) + "}";
        String response = mvc.perform(post("/api/bookings").session(session).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("reference").asText();
    }

    private JsonNode startPayment(String ref, String key) throws Exception {
        String response = mvc.perform(post("/api/bookings/" + ref + "/payments").session(guest).with(csrf())
                        .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content("{\"provider\":\"DEV_SANDBOX\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response);
    }

    private void approve(long paymentId) throws Exception {
        decide(paymentId, "approve");
    }

    private void decide(long paymentId, String decision) throws Exception {
        mvc.perform(post("/api/payments/dev/checkout/" + paymentId).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("sig", sandbox.signature(paymentId)).param("decision", decision))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("http://frontend.test/bookings/")));
    }
}
