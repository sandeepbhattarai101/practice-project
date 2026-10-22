package com.practiceproject.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Request/response records for auth endpoints. Bean Validation annotations are checked
 * by @Valid in the controller before any of our code runs.
 */
public final class AuthDtos {

    private AuthDtos() {}

    static final String PASSWORD_RULE = "^(?=.*[A-Za-z])(?=.*\\d).{10,128}$";
    static final String PASSWORD_MESSAGE = "Use 10–128 characters with at least one letter and one number";

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Pattern(regexp = PASSWORD_RULE, message = PASSWORD_MESSAGE) String password,
            @NotBlank @Size(max = 120) String fullName,
            @Size(max = 30) @Pattern(regexp = "^[0-9+\\- ]*$", message = "Use digits, spaces, + or -") String phone) {}

    public record LoginRequest(@NotBlank @Email String email, @NotBlank @Size(max = 128) String password) {}

    public record TokenRequest(@NotBlank @Size(max = 200) String token) {}

    public record ForgotPasswordRequest(@NotBlank @Email String email) {}

    public record ResetPasswordRequest(
            @NotBlank @Size(max = 200) String token,
            @NotBlank @Pattern(regexp = PASSWORD_RULE, message = PASSWORD_MESSAGE) String password) {}

    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank @Pattern(regexp = PASSWORD_RULE, message = PASSWORD_MESSAGE) String newPassword) {}

    public record ProfileRequest(
            @NotBlank @Size(max = 120) String fullName,
            @Size(max = 30) @Pattern(regexp = "^[0-9+\\- ]*$", message = "Use digits, spaces, + or -") String phone,
            @Size(max = 80) String preferredCitySlug,
            boolean marketingOptIn) {}

    public record UserDto(Long id, String email, String fullName, String phone, User.Role role, boolean emailVerified,
                          String preferredCitySlug, boolean marketingOptIn, List<Long> managedCinemaIds) {}

    public record UserEnvelope(UserDto user) {}
}
