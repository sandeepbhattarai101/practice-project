package com.practiceproject.notification;

import com.practiceproject.common.Formats;
import com.practiceproject.config.AppProperties;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

/**
 * Builds transactional emails. Every user-supplied value passes through esc() so a
 * name like {@code <script>} is shown as text, not run as HTML.
 */
@Component
public class EmailTemplates {

    public record Email(String subject, String text, String html) {}

    /** Everything an email about a booking needs, captured at the moment of the change. */
    public record BookingInfo(String reference, String customerName, String movieTitle, String cinemaName,
                              String cinemaAddress, String auditoriumName, Instant startsAt, String timezone,
                              String format, List<String> seatLabels, long totalMinor, String ticketCode,
                              String accessLink) {}

    private final AppProperties props;

    public EmailTemplates(AppProperties props) {
        this.props = props;
    }

    public Email verifyEmail(String name, String link) {
        String subject = "Confirm your email address";
        String text = "Hi " + name + ",\n\nPlease confirm your email address for Practice Project:\n" + link
                + "\n\nThe link expires in 48 hours. If you did not create an account, ignore this email.";
        String html = layout(subject, "<p>Hi " + esc(name) + ",</p><p>Please confirm your email address for Practice Project.</p>"
                + button(link, "Confirm email") + "<p class=muted>The link expires in 48 hours. If you did not create an account, you can ignore this email.</p>");
        return new Email(subject, text, html);
    }

    public Email passwordReset(String name, String link) {
        String subject = "Reset your password";
        String text = "Hi " + name + ",\n\nReset your Practice Project password here:\n" + link
                + "\n\nThe link expires in 1 hour and works once. If you did not ask for this, ignore this email; your password is unchanged.";
        String html = layout(subject, "<p>Hi " + esc(name) + ",</p><p>We received a request to reset your password.</p>"
                + button(link, "Choose a new password")
                + "<p class=muted>The link expires in 1 hour and works once. If you did not ask for this, ignore this email; your password is unchanged.</p>");
        return new Email(subject, text, html);
    }

    public Email bookingConfirmed(BookingInfo b) {
        String subject = "Your tickets: " + b.movieTitle() + " · " + Formats.dateTime(b.startsAt(), b.timezone());
        String seats = String.join(", ", b.seatLabels());
        String text = """
                Hi %s,

                Your booking is confirmed.

                Booking reference: %s
                Ticket code: %s
                Movie: %s (%s)
                When: %s
                Where: %s, %s — %s
                Seats: %s
                Total paid: %s

                View or print your ticket: %s

                Please arrive 15 minutes early and show the QR code on your ticket at the entrance.
                """.formatted(b.customerName(), b.reference(), b.ticketCode(), b.movieTitle(), b.format(),
                Formats.dateTime(b.startsAt(), b.timezone()), b.cinemaName(), b.cinemaAddress(), b.auditoriumName(),
                seats, money(b.totalMinor()), b.accessLink());
        String html = layout(subject, "<p>Hi " + esc(b.customerName()) + ",</p><p>Your booking is confirmed. Enjoy the show!</p>"
                + table(new String[][] {
                        {"Booking reference", b.reference()},
                        {"Ticket code", b.ticketCode()},
                        {"Movie", b.movieTitle() + " (" + b.format() + ")"},
                        {"When", Formats.dateTime(b.startsAt(), b.timezone())},
                        {"Where", b.cinemaName() + " — " + b.auditoriumName()},
                        {"Address", b.cinemaAddress()},
                        {"Seats", seats},
                        {"Total paid", money(b.totalMinor())}})
                + button(b.accessLink(), "View ticket & QR code")
                + "<p class=muted>Please arrive 15 minutes early and show the QR code at the entrance.</p>");
        return new Email(subject, text, html);
    }

    public Email bookingCancelled(BookingInfo b, long refundMinor, String reason) {
        String subject = "Booking " + b.reference() + " cancelled";
        String refundLine = refundMinor > 0
                ? "A refund of " + money(refundMinor) + " has been recorded and will be returned to your original payment method."
                : "No refund is due for this cancellation.";
        String text = "Hi " + b.customerName() + ",\n\nYour booking " + b.reference() + " for " + b.movieTitle() + " on "
                + Formats.dateTime(b.startsAt(), b.timezone()) + " has been cancelled.\nReason: " + reason + "\n\n" + refundLine
                + "\n\nDetails: " + b.accessLink();
        String html = layout(subject, "<p>Hi " + esc(b.customerName()) + ",</p><p>Your booking <strong>" + esc(b.reference())
                + "</strong> for <strong>" + esc(b.movieTitle()) + "</strong> on " + esc(Formats.dateTime(b.startsAt(), b.timezone()))
                + " has been cancelled.</p><p>Reason: " + esc(reason) + "</p><p>" + esc(refundLine) + "</p>"
                + button(b.accessLink(), "View booking"));
        return new Email(subject, text, html);
    }

    private String money(long minor) {
        return Formats.money(minor, props.currencySymbol());
    }

    private static String button(String href, String label) {
        return "<p><a class=btn href=\"" + esc(href) + "\">" + esc(label) + "</a></p>";
    }

    private static String table(String[][] rows) {
        var sb = new StringBuilder("<table>");
        for (String[] row : rows) {
            sb.append("<tr><th>").append(esc(row[0])).append("</th><td>").append(esc(row[1])).append("</td></tr>");
        }
        return sb.append("</table>").toString();
    }

    private static String layout(String title, String body) {
        return """
                <!doctype html><html><head><meta charset="utf-8"><title>%s</title><style>
                body{margin:0;background:#0e0e13;font-family:Arial,Helvetica,sans-serif;color:#ececf1}
                .wrap{max-width:560px;margin:0 auto;padding:32px 24px}
                .brand{font-size:20px;font-weight:bold;letter-spacing:.04em;color:#f5b544;margin-bottom:24px}
                .card{background:#17171f;border-radius:8px;padding:24px}
                th{text-align:left;color:#9d9dab;font-weight:normal;padding:6px 16px 6px 0;vertical-align:top}
                td{padding:6px 0}
                .btn{display:inline-block;background:#f5b544;color:#111!important;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold}
                .muted{color:#9d9dab;font-size:13px}
                </style></head><body><div class="wrap"><div class="brand">PRACTICE PROJECT</div><div class="card">%s</div>
                <p class="muted">This is a practice project, not a real cinema.</p></div></body></html>
                """.formatted(esc(title), body);
    }

    private static String esc(String value) {
        return value == null ? "" : HtmlUtils.htmlEscape(value);
    }
}
