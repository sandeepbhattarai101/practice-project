package com.practiceproject.auth;

import java.io.Serializable;
import java.security.Principal;
import java.util.Locale;

/**
 * What we keep about the logged-in user inside the session. Deliberately tiny:
 * the session is serialised into the spring_session_attributes table on every
 * change, and anything stale here (like a role) is refreshed by SessionUserRefreshFilter.
 *
 * Implementing Principal makes getName() the lower-cased email, which Spring Session
 * stores in spring_session.principal_name, so "log out all my sessions" is one DELETE.
 */
public record AuthUser(Long id, String email, User.Role role) implements Serializable, Principal {

    @Override
    public String getName() {
        return email.toLowerCase(Locale.ROOT);
    }

    public boolean isAdmin() {
        return role == User.Role.ADMIN;
    }

    public boolean isStaff() {
        return role == User.Role.ADMIN || role == User.Role.CINEMA_MANAGER;
    }
}
