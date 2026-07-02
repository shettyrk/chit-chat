package com.example.messaging.user;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PhoneNumberNormalizer phoneNumbers;
    private final OtpService otpService;
    private final SecretKey key;

    public UserController(
            UserRepository users,
            PasswordEncoder passwordEncoder,
            PhoneNumberNormalizer phoneNumbers,
            OtpService otpService,
            @Value("${app.jwt-secret}") String secret
    ) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.phoneNumbers = phoneNumbers;
        this.otpService = otpService;
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/otp/start")
    public OtpStartView startOtp(@RequestBody OtpStartRequest request) {
        String phone = normalizePhone(request.phone());
        OtpStartResult result = otpService.start(phone);
        return new OtpStartView(phone, result.expiresInSeconds(), result.devCode());
    }

    @PostMapping("/otp/verify")
    public ResponseEntity<?> verifyOtp(@RequestBody OtpVerifyRequest request) {
        String phone = normalizePhone(request.phone());
        otpService.verify(phone, request.code());

        User user = findByNormalizedOrRawPhone(request.phone(), phone).orElseGet(() -> {
            User created = new User();
            created.setPhone(phone);
            created.setName(displayName(request.name(), phone));
            created.setPhoneVerified(true);
            return users.save(created);
        });

        boolean changed = false;
        if (!phone.equals(user.getPhone())) {
            user.setPhone(phone);
            changed = true;
        }
        if (!user.isPhoneVerified()) {
            user.setPhoneVerified(true);
            changed = true;
        }
        if (request.name() != null && !request.name().isBlank() && !request.name().trim().equals(user.getName())) {
            user.setName(request.name().trim());
            changed = true;
        }
        if (changed) {
            user = users.save(user);
        }

        return ResponseEntity.ok(sessionPayload(user));
    }

    @PostMapping("/register")
    public UserView register(@RequestBody RegisterRequest request) {
        String phone = normalizePhone(request.phone());
        if (request.password() == null || request.password().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password is required");
        }
        if (users.findByPhone(phone).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Phone is already registered");
        }

        User user = new User();
        user.setName(displayName(request.name(), phone));
        user.setPhone(phone);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        return UserView.from(users.save(user));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        String phone = normalizePhone(request.phone());
        Optional<User> user = findByNormalizedOrRawPhone(request.phone(), phone)
                .filter(candidate -> candidate.getPasswordHash() != null && passwordEncoder.matches(request.password(), candidate.getPasswordHash()));
        if (user.isEmpty()) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid credentials"));
        }
        return ResponseEntity.ok(sessionPayload(user.get()));
    }

    @PostMapping("/contacts/lookup")
    public List<UserView> lookupContacts(
            @RequestHeader(value = "X-User-Id", required = false) Long currentUserId,
            @RequestBody ContactLookupRequest request
    ) {
        if (request.phones() == null || request.phones().isEmpty()) return List.of();

        Set<String> phones = new LinkedHashSet<>();
        for (String phone : request.phones()) {
            tryNormalizePhone(phone).ifPresent(phones::add);
        }
        if (phones.isEmpty()) return List.of();

        return users.findByPhoneIn(phones).stream()
                .filter(user -> currentUserId == null || !user.getId().equals(currentUserId))
                .map(UserView::from)
                .toList();
    }

    @GetMapping
    public List<UserView> list() {
        return users.findAll().stream().map(UserView::from).toList();
    }

    @GetMapping("/{id}")
    public UserView get(@PathVariable("id") Long id) {
        return UserView.from(users.findById(id).orElseThrow());
    }

    @PatchMapping("/{id}/status")
    public UserView status(@PathVariable("id") Long id, @RequestBody Map<String, String> body) {
        User user = users.findById(id).orElseThrow();
        user.setStatus(body.getOrDefault("status", "OFFLINE"));
        return UserView.from(users.save(user));
    }

    private Map<String, Object> sessionPayload(User user) {
        String token = Jwts.builder()
                .subject(user.getId().toString())
                .claim("phone", user.getPhone())
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(86400)))
                .signWith(key)
                .compact();
        return Map.of("token", token, "user", UserView.from(user));
    }

    private String normalizePhone(String phone) {
        try {
            return phoneNumbers.normalize(phone);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    private Optional<String> tryNormalizePhone(String phone) {
        try {
            return Optional.of(phoneNumbers.normalize(phone));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    private Optional<User> findByNormalizedOrRawPhone(String rawPhone, String normalizedPhone) {
        Optional<User> normalized = users.findByPhone(normalizedPhone);
        if (normalized.isPresent()) return normalized;

        String raw = rawPhone == null ? "" : rawPhone.trim();
        if (!raw.isBlank() && !raw.equals(normalizedPhone)) {
            return users.findByPhone(raw);
        }
        return Optional.empty();
    }

    private String displayName(String name, String phone) {
        if (name != null && !name.isBlank()) return name.trim();
        return "User " + phone.substring(Math.max(0, phone.length() - 4));
    }
}

record OtpStartRequest(String phone) {}
record OtpVerifyRequest(String phone, String code, String name) {}
record OtpStartView(String phone, int expiresInSeconds, String devCode) {}
record ContactLookupRequest(List<String> phones) {}
record RegisterRequest(String name, String phone, String password) {}
record LoginRequest(String phone, String password) {}
record UserView(Long id, String name, String phone, String status, String avatarUrl, boolean phoneVerified) {
    static UserView from(User user) {
        return new UserView(
                user.getId(),
                user.getName(),
                user.getPhone(),
                user.getStatus(),
                user.getAvatarUrl(),
                user.isPhoneVerified()
        );
    }
}
