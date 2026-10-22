package com.practiceproject.booking;

import com.practiceproject.auth.AuthUser;
import com.practiceproject.auth.CurrentUser;
import com.practiceproject.auth.GuestBookings;
import com.practiceproject.auth.UserRepository;
import com.practiceproject.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * "May this caller see or change this booking?" Ownership is checked on every request on
 * the server. A missing permission answers 404 rather than 403, so nobody can probe which
 * booking references exist.
 */
@Component
public class BookingAccess {

    /** A permission check bound to the current request, passed into service methods. */
    @FunctionalInterface
    public interface Check {
        void require(Booking booking);
    }

    private final JdbcTemplate jdbc;
    private final UserRepository users;

    public BookingAccess(JdbcTemplate jdbc, UserRepository users) {
        this.jdbc = jdbc;
        this.users = users;
    }

    /** Customer access: the booking's owner, or the guest session that created/unlocked it. */
    public Check customer(HttpServletRequest request) {
        AuthUser user = CurrentUser.get().orElse(null);
        Set<Long> guestIds = GuestBookings.ids(request);
        return booking -> {
            boolean owner = user != null && user.id().equals(booking.getUserId());
            boolean guest = guestIds.contains(booking.getId());
            if (!owner && !guest && !canStaffAccess(user, booking)) {
                throw ApiException.notFound("Booking");
            }
        };
    }

    /** Staff access: admins see everything, managers only bookings at their cinemas. */
    public Check staff() {
        AuthUser user = CurrentUser.require();
        return booking -> {
            if (!canStaffAccess(user, booking)) {
                throw ApiException.notFound("Booking");
            }
        };
    }

    private boolean canStaffAccess(AuthUser user, Booking booking) {
        if (user == null || !user.isStaff()) {
            return false;
        }
        if (user.isAdmin()) {
            return true;
        }
        List<Long> managed = users.findManagedCinemaIds(user.id());
        Long cinemaId = jdbc.queryForObject("""
                select a.cinema_id from showtimes s join auditoriums a on a.id = s.auditorium_id where s.id = ?
                """, Long.class, booking.getShowtimeId());
        return managed.contains(cinemaId);
    }
}
