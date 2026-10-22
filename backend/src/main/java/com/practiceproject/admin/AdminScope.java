package com.practiceproject.admin;

import com.practiceproject.auth.AuthUser;
import com.practiceproject.auth.CurrentUser;
import com.practiceproject.auth.UserRepository;
import com.practiceproject.common.ApiException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Which cinemas the current staff member may act on. Admins: all (null). Cinema managers:
 * only those in manager_cinemas. Every manager-accessible query passes this list into SQL
 * ({@code cinema_id = any(...)}) so the restriction is enforced where the data is read.
 */
@Component
public class AdminScope {

    private final UserRepository users;
    private final JdbcTemplate jdbc;

    public AdminScope(UserRepository users, JdbcTemplate jdbc) {
        this.users = users;
        this.jdbc = jdbc;
    }

    /** null = every cinema. */
    public List<Long> cinemaIds() {
        AuthUser user = CurrentUser.require();
        return user.isAdmin() ? null : users.findManagedCinemaIds(user.id());
    }

    /** Narrows an optional cinema filter to what the caller may see. */
    public List<Long> narrow(Long requestedCinemaId) {
        List<Long> allowed = cinemaIds();
        if (requestedCinemaId == null) {
            return allowed;
        }
        if (allowed != null && !allowed.contains(requestedCinemaId)) {
            throw ApiException.forbidden();
        }
        return List.of(requestedCinemaId);
    }

    public void requireCinema(Long cinemaId) {
        List<Long> allowed = cinemaIds();
        if (allowed != null && !allowed.contains(cinemaId)) {
            throw ApiException.forbidden();
        }
    }

    public void requireAuditorium(Long auditoriumId) {
        Long cinemaId = jdbc.queryForList("select cinema_id from auditoriums where id = ?", Long.class, auditoriumId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound("Auditorium"));
        requireCinema(cinemaId);
    }

    public void requireShowtime(Long showtimeId) {
        Long cinemaId = jdbc.queryForList("""
                select a.cinema_id from showtimes s join auditoriums a on a.id = s.auditorium_id where s.id = ?
                """, Long.class, showtimeId).stream().findFirst().orElseThrow(() -> ApiException.notFound("Showtime"));
        requireCinema(cinemaId);
    }

    /** "{1,2,3}" for SQL, or null meaning no restriction. */
    public static String sqlArray(List<Long> ids) {
        if (ids == null) {
            return null;
        }
        return ids.stream().map(String::valueOf).collect(java.util.stream.Collectors.joining(",", "{", "}"));
    }
}
