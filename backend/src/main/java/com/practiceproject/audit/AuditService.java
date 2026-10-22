package com.practiceproject.audit;

import com.practiceproject.auth.AuthUser;
import com.practiceproject.auth.CurrentUser;
import com.practiceproject.common.Json;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Append-only audit trail. Called inside the same transaction as the change it
 * describes, so a rolled-back change leaves no misleading audit row behind.
 */
@Service
public class AuditService {

    private final JdbcTemplate jdbc;
    private final Json json;

    public AuditService(JdbcTemplate jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(String action, String entityType, Object entityId, Map<String, ?> details) {
        AuthUser actor = CurrentUser.get().orElse(null);
        jdbc.update("""
                insert into audit_events (actor_user_id, actor_email, action, entity_type, entity_id, details, ip_address)
                values (?, ?, ?, ?, ?, ?::jsonb, ?)
                """,
                actor == null ? null : actor.id(),
                actor == null ? "system" : actor.email(),
                action, entityType, entityId == null ? null : String.valueOf(entityId),
                json.write(details == null ? Map.of() : details), clientIp());
    }

    private static String clientIp() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            return attrs.getRequest().getRemoteAddr();
        }
        return null;
    }
}
