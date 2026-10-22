package com.practiceproject.notification;

import com.practiceproject.config.AppProperties;
import jakarta.mail.internet.MimeMessage;
import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sends emails from the outbox. Runs every few seconds.
 *
 * {@code FOR UPDATE SKIP LOCKED} is the key line: it locks the rows this run picked, and a
 * second app instance running the same job at the same moment skips them instead
 * of waiting or sending duplicates. That turns a plain table into a safe work queue.
 */
@Component
@ConditionalOnProperty(name = "app.jobs.enabled", havingValue = "true")
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);
    private static final int MAX_ATTEMPTS = 6;

    private record Pending(long id, String recipient, String subject, String text, String html, int attempts) {}

    private final JdbcTemplate jdbc;
    private final JavaMailSender mailSender;
    private final AppProperties props;

    public NotificationDispatcher(JdbcTemplate jdbc, JavaMailSender mailSender, AppProperties props) {
        this.jdbc = jdbc;
        this.mailSender = mailSender;
        this.props = props;
    }

    @Scheduled(fixedDelay = 5_000, initialDelay = 5_000)
    @Transactional
    public void dispatch() {
        List<Pending> batch = jdbc.query("""
                select id, recipient, subject, body_text, body_html, attempts
                from notifications
                where status = 'PENDING' and next_attempt_at <= now()
                order by next_attempt_at
                limit 20
                for update skip locked
                """, (rs, i) -> new Pending(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getInt(6)));

        for (Pending n : batch) {
            try {
                send(n);
                jdbc.update("update notifications set status = 'SENT', sent_at = now(), attempts = attempts + 1, last_error = null where id = ?", n.id());
            } catch (Exception e) {
                int attempts = n.attempts() + 1;
                // Exponential backoff: 30s, 1m, 2m, 4m, 8m, then give up.
                Duration wait = Duration.ofSeconds(30L << Math.min(attempts - 1, 5));
                String status = attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
                log.warn("Email {} failed (attempt {}): {}", n.id(), attempts, e.getMessage());
                jdbc.update("""
                        update notifications set status = ?, attempts = ?, last_error = ?,
                               next_attempt_at = now() + make_interval(secs => ?)
                        where id = ?
                        """, status, attempts, truncate(e.getMessage()), wait.toSeconds(), n.id());
            }
        }
    }

    private void send(Pending n) throws Exception {
        MimeMessage message = mailSender.createMimeMessage();
        var helper = new MimeMessageHelper(message, true, "UTF-8");
        helper.setFrom(props.mailFrom());
        helper.setTo(n.recipient());
        helper.setSubject(n.subject());
        helper.setText(n.text(), n.html());
        mailSender.send(message);
    }

    private static String truncate(String s) {
        if (s == null) {
            return "unknown error";
        }
        return s.length() > 500 ? s.substring(0, 500) : s;
    }
}
