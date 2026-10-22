package com.practiceproject.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.HashSet;
import java.util.Set;

/**
 * Guests (not logged in) can book. We remember which bookings this browser created
 * or unlocked (via "find my booking") as a set of ids in the server-side session.
 * Nothing about it is stored in the browser except the session cookie itself.
 */
public final class GuestBookings {

    private static final String ATTRIBUTE = "pp.guestBookingIds";

    private GuestBookings() {}

    @SuppressWarnings("unchecked")
    public static Set<Long> ids(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return Set.of();
        }
        Object value = session.getAttribute(ATTRIBUTE);
        return value instanceof Set<?> set ? (Set<Long>) set : Set.of();
    }

    @SuppressWarnings("unchecked")
    public static void add(HttpServletRequest request, Long bookingId) {
        HttpSession session = request.getSession(true);
        Object value = session.getAttribute(ATTRIBUTE);
        Set<Long> ids = value instanceof Set<?> set ? new HashSet<>((Set<Long>) set) : new HashSet<>();
        ids.add(bookingId);
        // Re-setting the attribute tells Spring Session the value changed and must be saved.
        session.setAttribute(ATTRIBUTE, ids);
    }
}
