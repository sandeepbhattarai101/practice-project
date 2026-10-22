package com.practiceproject.auth;

import com.practiceproject.auth.AuthDtos.UserEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final UserRepository users;
    private final SessionAuth sessionAuth;

    public AuthController(AuthService auth, UserRepository users, SessionAuth sessionAuth) {
        this.auth = auth;
        this.users = users;
        this.sessionAuth = sessionAuth;
    }

    /** The SPA calls this once at start-up. Touching the token makes Spring set the XSRF-TOKEN cookie. */
    @GetMapping("/csrf")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void csrf(CsrfToken token) {
        token.getToken();
    }

    @GetMapping("/me")
    public UserEnvelope me() {
        return new UserEnvelope(CurrentUser.get()
                .flatMap(u -> users.findById(u.id()))
                .map(auth::toDto)
                .orElse(null));
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserEnvelope register(@Valid @RequestBody AuthDtos.RegisterRequest body,
                                 HttpServletRequest request, HttpServletResponse response) {
        User user = auth.register(body);
        return completeLogin(user, request, response);
    }

    @PostMapping("/login")
    public UserEnvelope login(@Valid @RequestBody AuthDtos.LoginRequest body,
                              HttpServletRequest request, HttpServletResponse response) {
        User user = auth.authenticate(body.email(), body.password());
        return completeLogin(user, request, response);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request) {
        sessionAuth.logout(request);
    }

    @PostMapping("/verify-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verifyEmail(@Valid @RequestBody AuthDtos.TokenRequest body) {
        auth.verifyEmail(body.token());
    }

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resendVerification() {
        auth.resendVerification(CurrentUser.require().id());
    }

    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void forgotPassword(@Valid @RequestBody AuthDtos.ForgotPasswordRequest body) {
        auth.forgotPassword(body.email());
    }

    @PostMapping("/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@Valid @RequestBody AuthDtos.ResetPasswordRequest body) {
        auth.resetPassword(body.token(), body.password());
    }

    private UserEnvelope completeLogin(User user, HttpServletRequest request, HttpServletResponse response) {
        var guestBookings = GuestBookings.ids(request);
        sessionAuth.login(user, request, response);
        auth.claimGuestBookings(user.getId(), guestBookings);
        return new UserEnvelope(auth.toDto(users.findById(user.getId()).orElseThrow()));
    }
}
