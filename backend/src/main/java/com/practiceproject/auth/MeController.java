package com.practiceproject.auth;

import com.practiceproject.auth.AuthDtos.UserEnvelope;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Endpoints about the logged-in user. SecurityConfig requires authentication for /api/me/**. */
@RestController
@RequestMapping("/api/me")
public class MeController {

    private final AuthService auth;

    public MeController(AuthService auth) {
        this.auth = auth;
    }

    @PutMapping("/profile")
    public UserEnvelope updateProfile(@Valid @RequestBody AuthDtos.ProfileRequest body) {
        User user = auth.updateProfile(CurrentUser.require().id(), body);
        return new UserEnvelope(auth.toDto(user));
    }

    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@Valid @RequestBody AuthDtos.ChangePasswordRequest body) {
        auth.changePassword(CurrentUser.require().id(), body.currentPassword(), body.newPassword());
    }
}
