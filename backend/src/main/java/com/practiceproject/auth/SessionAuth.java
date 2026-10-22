package com.practiceproject.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Component;

/** Puts a user into (or removes them from) the current HTTP session. */
@Component
public class SessionAuth {

    private final SecurityContextRepository contextRepository;

    public SessionAuth(SecurityContextRepository contextRepository) {
        this.contextRepository = contextRepository;
    }

    public static UsernamePasswordAuthenticationToken token(AuthUser user) {
        return UsernamePasswordAuthenticationToken.authenticated(user, null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.role().name())));
    }

    public void login(User user, HttpServletRequest request, HttpServletResponse response) {
        // Session fixation defence: give the browser a NEW session id at login, so an
        // attacker who planted a known session id cannot ride the logged-in session.
        // Attributes (like guest booking ids) carry over.
        if (request.getSession(false) != null) {
            request.changeSessionId();
        } else {
            request.getSession(true);
        }
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(token(new AuthUser(user.getId(), user.getEmail(), user.getRole())));
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
    }

    public void logout(HttpServletRequest request) {
        SecurityContextHolder.clearContext();
        var session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
    }
}
