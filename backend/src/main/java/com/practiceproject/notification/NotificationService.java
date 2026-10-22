package com.practiceproject.notification;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes emails to the notifications outbox table. Nothing is sent here; see
 * NotificationDispatcher. Propagation.MANDATORY makes it a bug to call this outside a
 * transaction, because the whole point is to commit the email together with the change.
 */
@Service
public class NotificationService {

    private final JdbcTemplate jdbc;

    public NotificationService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void enqueue(String type, String recipient, EmailTemplates.Email email, Long bookingId) {
        if (recipient == null || recipient.isBlank()) {
            return;
        }
        jdbc.update("""
                insert into notifications (type, recipient, subject, body_text, body_html, booking_id)
                values (?, ?, ?, ?, ?, ?)
                """, type, recipient, email.subject(), email.text(), email.html(), bookingId);
    }
}
