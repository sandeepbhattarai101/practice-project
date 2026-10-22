package com.practiceproject.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Sessions last up to 14 days, but an admin may disable a user or change their role at
 * any time. On each authenticated request we re-read the user row (a primary-key lookup,
 * about a millisecond) and log them out or update their role if it changed.
 */
public class SessionUserRefreshFilter extends OncePerRequestFilter {

    private final UserRepository users;
    private final SecurityContextRepository contextRepository;

    public SessionUserRefreshFilter(UserRepository users, SecurityContextRepository contextRepository) {
        this.users = users;
        this.contextRepository = contextRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var current = CurrentUser.get();
        if (current.isPresent()) {
            AuthUser sessionUser = current.get();
            var fresh = users.findById(sessionUser.id());
            if (fresh.isEmpty() || fresh.get().getStatus() == User.Status.DISABLED) {
                SecurityContextHolder.clearContext();
                var session = request.getSession(false);
                if (session != null) {
                    session.invalidate();
                }
            } else if (fresh.get().getRole() != sessionUser.role() || !fresh.get().getEmail().equals(sessionUser.email())) {
                SecurityContext context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(SessionAuth.token(new AuthUser(fresh.get().getId(), fresh.get().getEmail(), fresh.get().getRole())));
                SecurityContextHolder.setContext(context);
                contextRepository.saveContext(context, request, response);
            }
        }
        chain.doFilter(request, response);
    }
}
