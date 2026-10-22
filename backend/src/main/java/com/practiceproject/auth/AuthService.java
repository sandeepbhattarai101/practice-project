package com.practiceproject.auth;

import com.practiceproject.audit.AuditService;
import com.practiceproject.auth.AuthDtos.UserDto;
import com.practiceproject.common.ApiException;
import com.practiceproject.common.Tokens;
import com.practiceproject.config.AppProperties;
import com.practiceproject.notification.EmailTemplates;
import com.practiceproject.notification.NotificationService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final int MAX_FAILED_LOGINS = 5;
    private static final Duration LOCK_DURATION = Duration.ofMinutes(15);
    private static final Duration VERIFY_TTL = Duration.ofHours(48);
    private static final Duration RESET_TTL = Duration.ofHours(1);

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final EmailTemplates templates;
    private final AppProperties props;
    private final AuditService audit;
    // Hash of a random password, used to spend the same time on unknown emails as on known ones.
    private final String dummyHash;

    public AuthService(UserRepository users, PasswordEncoder passwordEncoder, JdbcTemplate jdbc,
                       NotificationService notifications, EmailTemplates templates, AppProperties props, AuditService audit) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.templates = templates;
        this.props = props;
        this.audit = audit;
        this.dummyHash = passwordEncoder.encode(Tokens.urlToken());
    }

    @Transactional
    public User register(AuthDtos.RegisterRequest req) {
        String email = req.email().trim();
        if (users.findByEmailIgnoreCase(email).isPresent()) {
            throw ApiException.conflict("EMAIL_TAKEN", "An account with this email already exists. Try signing in.");
        }
        var user = new User();
        user.setEmail(email);
        user.setFullName(req.fullName().trim());
        user.setPhone(blankToNull(req.phone()));
        // The encoder salts and stretches the password (bcrypt by default). We never store or log the raw value.
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        users.saveAndFlush(user);
        sendVerification(user);
        return user;
    }

    /**
     * Checks credentials. Runs in its own transaction so the failed-attempt counter is
     * saved even though we then throw.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public User authenticate(String email, String password) {
        Optional<User> found = users.findByEmailIgnoreCase(email.trim());
        if (found.isEmpty()) {
            passwordEncoder.matches(password, dummyHash);
            throw invalidCredentials();
        }
        User user = found.get();
        Instant now = Instant.now();
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new ApiException(HttpStatus.LOCKED, "ACCOUNT_LOCKED",
                    "Too many failed attempts. Try again in a few minutes or reset your password.");
        }
        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            int failures = user.getFailedLoginCount() + 1;
            user.setFailedLoginCount(failures);
            if (failures >= MAX_FAILED_LOGINS) {
                user.setLockedUntil(now.plus(LOCK_DURATION));
                user.setFailedLoginCount(0);
            }
            throw invalidCredentials();
        }
        if (user.getStatus() == User.Status.DISABLED) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_DISABLED", "This account has been disabled. Contact support.");
        }
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
        if (passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(password));
        }
        return user;
    }

    @Transactional
    public void verifyEmail(String rawToken) {
        Long userId = consumeToken(rawToken, "VERIFY_EMAIL");
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(Instant.now());
        }
    }

    @Transactional
    public void resendVerification(Long userId) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        if (user.getEmailVerifiedAt() == null) {
            sendVerification(user);
        }
    }

    /** Always succeeds from the caller's point of view, so it cannot be used to discover registered emails. */
    @Transactional
    public void forgotPassword(String email) {
        users.findByEmailIgnoreCase(email.trim())
                .filter(u -> u.getStatus() == User.Status.ACTIVE)
                .ifPresent(user -> {
                    String token = createToken(user.getId(), "RESET_PASSWORD", RESET_TTL);
                    String link = props.frontendUrl() + "/reset-password?token=" + token;
                    notifications.enqueue("PASSWORD_RESET", user.getEmail(), templates.passwordReset(user.getFullName(), link), null);
                });
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        Long userId = consumeToken(rawToken, "RESET_PASSWORD");
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
        // Clicking the emailed link proves they own the address.
        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(Instant.now());
        }
        // Log out every other session of this user: a reset usually means "someone else may have my password".
        jdbc.update("delete from spring_session where principal_name = ?", user.getEmail().toLowerCase());
        audit.record("user.password_reset", "user", user.getId(), Map.of());
    }

    @Transactional
    public void changePassword(Long userId, String current, String next) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        if (!passwordEncoder.matches(current, user.getPasswordHash())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Your current password is incorrect");
        }
        user.setPasswordHash(passwordEncoder.encode(next));
    }

    @Transactional
    public User updateProfile(Long userId, AuthDtos.ProfileRequest req) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        user.setFullName(req.fullName().trim());
        user.setPhone(blankToNull(req.phone()));
        user.setMarketingOptIn(req.marketingOptIn());
        if (req.preferredCitySlug() == null || req.preferredCitySlug().isBlank()) {
            user.setPreferredCityId(null);
        } else {
            List<Long> ids = jdbc.queryForList("select id from cities where slug = ?", Long.class, req.preferredCitySlug());
            if (ids.isEmpty()) {
                throw ApiException.badRequest("Unknown city");
            }
            user.setPreferredCityId(ids.getFirst());
        }
        return user;
    }

    /** Gives a newly logged-in user the bookings they made as a guest in this browser. */
    @Transactional
    public void claimGuestBookings(Long userId, java.util.Set<Long> bookingIds) {
        if (bookingIds.isEmpty()) {
            return;
        }
        jdbc.update("update bookings set user_id = ? where user_id is null and id = any(?::bigint[])",
                userId, "{" + String.join(",", bookingIds.stream().map(String::valueOf).toList()) + "}");
    }

    @Transactional(readOnly = true)
    public UserDto toDto(User user) {
        String citySlug = user.getPreferredCityId() == null ? null
                : jdbc.queryForList("select slug from cities where id = ?", String.class, user.getPreferredCityId())
                        .stream().findFirst().orElse(null);
        List<Long> managed = user.getRole() == User.Role.CINEMA_MANAGER ? users.findManagedCinemaIds(user.getId()) : List.of();
        return new UserDto(user.getId(), user.getEmail(), user.getFullName(), user.getPhone(), user.getRole(),
                user.getEmailVerifiedAt() != null, citySlug, user.isMarketingOptIn(), managed);
    }

    private void sendVerification(User user) {
        String token = createToken(user.getId(), "VERIFY_EMAIL", VERIFY_TTL);
        String link = props.frontendUrl() + "/verify-email?token=" + token;
        notifications.enqueue("VERIFY_EMAIL", user.getEmail(), templates.verifyEmail(user.getFullName(), link), null);
    }

    private String createToken(Long userId, String purpose, Duration ttl) {
        // Invalidate older unused tokens of the same purpose so only the newest link works.
        jdbc.update("update user_tokens set used_at = now() where user_id = ? and purpose = ? and used_at is null", userId, purpose);
        String raw = Tokens.urlToken();
        jdbc.update("insert into user_tokens (user_id, purpose, token_hash, expires_at) values (?, ?, ?, ?)",
                userId, purpose, Tokens.sha256Hex(raw), java.sql.Timestamp.from(Instant.now().plus(ttl)));
        return raw;
    }

    /**
     * Marks a token used and returns its user, in ONE statement. If two requests race with
     * the same token, only one UPDATE can match "used_at is null", so the token works once.
     */
    private Long consumeToken(String rawToken, String purpose) {
        List<Long> ids = jdbc.queryForList("""
                update user_tokens set used_at = now()
                where token_hash = ? and purpose = ? and used_at is null and expires_at > now()
                returning user_id
                """, Long.class, Tokens.sha256Hex(rawToken), purpose);
        if (ids.isEmpty()) {
            throw ApiException.unprocessable("TOKEN_INVALID", "This link is invalid or has expired. Please request a new one.");
        }
        return ids.getFirst();
    }

    private static ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
