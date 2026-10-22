package com.practiceproject.admin;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.practiceproject.IntegrationTest;
import com.practiceproject.booking.BookingService;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;

/** Authentication, role checks and cinema-manager scoping, all over HTTP. */
class AccessControlTest extends IntegrationTest {

    @Autowired BookingService bookings;

    @Test
    void registerLoginMeLogout() throws Exception {
        var session = new MockHttpSession();
        mvc.perform(post("/api/auth/register").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"New@Example.com\",\"password\":\"short\",\"fullName\":\"N\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.fieldErrors[0].field").value("password"));
        mvc.perform(post("/api/auth/register").session(session).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"New@Example.com\",\"password\":\"correct-horse-1\",\"fullName\":\"New User\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.role").value("CUSTOMER"))
                .andExpect(jsonPath("$.user.emailVerified").value(false));
        // Case-insensitive uniqueness (the lower(email) unique index).
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"new@example.com\",\"password\":\"correct-horse-1\",\"fullName\":\"Dup\"}"))
                .andExpect(status().isConflict());

        var fresh = new MockHttpSession();
        mvc.perform(post("/api/auth/login").session(fresh).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"new@example.com\",\"password\":\"wrong-password-1\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));
        var login = mvc.perform(post("/api/auth/login").session(fresh).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"new@example.com\",\"password\":\"correct-horse-1\"}"))
                .andExpect(status().isOk()).andReturn();
        var loggedIn = (MockHttpSession) login.getRequest().getSession();
        mvc.perform(get("/api/auth/me").session(loggedIn)).andExpect(jsonPath("$.user.email").value("New@Example.com"));
        mvc.perform(post("/api/auth/logout").session(loggedIn).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void fiveWrongPasswordsLockTheAccount() throws Exception {
        createUser("lock@example.com", "CUSTOMER", "right-password-1");
        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"lock@example.com\",\"password\":\"nope-nope-1\"}")).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"lock@example.com\",\"password\":\"right-password-1\"}"))
                .andExpect(status().isLocked());
    }

    @Test
    void customersCannotReachAdminAndAnonymousGets401() throws Exception {
        mvc.perform(get("/api/admin/dashboard")).andExpect(status().isUnauthorized());
        var customer = login(createUser("c@example.com", "CUSTOMER", "customer-pass-1"), "c@example.com", "customer-pass-1");
        mvc.perform(get("/api/admin/dashboard").session(customer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/me/bookings").session(customer)).andExpect(status().isOk());
    }

    @Test
    void managerSeesOnlyTheirCinemaAndCannotUseAdminOnlyAreas() throws Exception {
        long managerId = createUser("m@example.com", "CINEMA_MANAGER", "manager-pass-1");
        jdbc.update("insert into manager_cinemas (user_id, cinema_id) values (?, ?)", managerId, fx.otherCinemaId());
        var manager = login(managerId, "m@example.com", "manager-pass-1");

        // A booking at Test Cinema (not theirs).
        var booking = bookings.hold(fx.showtimeId(), List.of(fx.seatIds().getFirst()), null, Set.of());

        mvc.perform(get("/api/admin/bookings").session(manager)).andExpect(jsonPath("$.totalItems").value(0));
        mvc.perform(get("/api/admin/bookings/" + booking.getReference()).session(manager)).andExpect(status().isNotFound());
        mvc.perform(get("/api/admin/dashboard").param("cinemaId", String.valueOf(fx.cinemaId())).session(manager))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/movies").session(manager)).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/settings").session(manager)).andExpect(status().isForbidden());

        var admin = login(createUser("a@example.com", "ADMIN", "admin-pass-12"), "a@example.com", "admin-pass-12");
        mvc.perform(get("/api/admin/bookings").session(admin)).andExpect(jsonPath("$.totalItems").value(1));
    }

    @Test
    void roleChangeTakesEffectOnTheNextRequest() throws Exception {
        long id = createUser("promote@example.com", "CUSTOMER", "promote-pass-1");
        var session = login(id, "promote@example.com", "promote-pass-1");
        mvc.perform(get("/api/admin/movies").session(session)).andExpect(status().isForbidden());
        jdbc.update("update users set role = 'ADMIN' where id = ?", id);
        mvc.perform(get("/api/admin/movies").session(session)).andExpect(status().isOk());
        jdbc.update("update users set status = 'DISABLED' where id = ?", id);
        mvc.perform(get("/api/admin/movies").session(session)).andExpect(status().isUnauthorized());
    }

    @Test
    void overlappingShowtimeIsRejectedByTheDatabaseConstraint() throws Exception {
        var admin = login(createUser("a2@example.com", "ADMIN", "admin-pass-12"), "a2@example.com", "admin-pass-12");
        Instant clash = jdbc.queryForObject("select starts_at from showtimes where id = ?", java.sql.Timestamp.class, fx.showtimeId())
                .toInstant().plus(30, ChronoUnit.MINUTES);
        String body = """
                {"movieId":%d,"auditoriumId":%d,"startsAt":"%s","format":"2D","language":"English",
                 "prices":[{"categoryId":%d,"priceMinor":40000},{"categoryId":%d,"priceMinor":60000}]}
                """.formatted(fx.movieId(), fx.auditoriumId(), clash, fx.classicId(), fx.premiumId());
        mvc.perform(post("/api/admin/showtimes").session(admin).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("SHOWTIME_OVERLAP"));

        String later = body.replace(clash.toString(), clash.plus(5, ChronoUnit.HOURS).toString());
        mvc.perform(post("/api/admin/showtimes").session(admin).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(later))
                .andExpect(status().isOk()).andExpect(jsonPath("$.capacity").value(10));
    }

    @Test
    void layoutIsLockedWhileUpcomingShowsHaveHolds() throws Exception {
        var admin = login(createUser("a3@example.com", "ADMIN", "admin-pass-12"), "a3@example.com", "admin-pass-12");
        bookings.hold(fx.showtimeId(), List.of(fx.seatIds().getFirst()), null, Set.of());
        mvc.perform(get("/api/admin/auditoriums/" + fx.auditoriumId() + "/layout").session(admin))
                .andExpect(jsonPath("$.locked").value(true)).andExpect(jsonPath("$.seats.length()").value(10));
        mvc.perform(put("/api/admin/auditoriums/" + fx.auditoriumId() + "/layout").session(admin).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"gridRows\":1,\"gridCols\":1,\"categories\":[{\"code\":\"CLASSIC\",\"name\":\"Classic\",\"color\":\"#8B8B95\",\"sortOrder\":1}],"
                                + "\"seats\":[{\"rowLabel\":\"A\",\"seatNumber\":1,\"gridRow\":1,\"gridCol\":1,\"categoryCode\":\"CLASSIC\",\"seatType\":\"STANDARD\",\"isActive\":true}]}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("LAYOUT_LOCKED"));
    }

    private MockHttpSession login(long userId, String email, String password) throws Exception {
        var result = mvc.perform(post("/api/auth/login").session(new MockHttpSession()).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk()).andReturn();
        return (MockHttpSession) result.getRequest().getSession();
    }
}
