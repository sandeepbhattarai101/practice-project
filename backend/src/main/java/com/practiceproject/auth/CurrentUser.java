package com.practiceproject.auth;

import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Static helpers to read the logged-in user from Spring Security's per-request context. */
public final class CurrentUser {

    private CurrentUser() {}

    public static Optional<AuthUser> get() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthUser user) {
            return Optional.of(user);
        }
        return Optional.empty();
    }

    public static AuthUser require() {
        return get().orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("Not signed in"));
    }
}
