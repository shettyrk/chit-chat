package com.example.messaging.user;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final SecretKey key;

    public UserController(UserRepository users, PasswordEncoder passwordEncoder, @Value("${app.jwt-secret}") String secret) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/register")
    public UserView register(@RequestBody RegisterRequest request) {
        User user = new User();
        user.setName(request.name());
        user.setPhone(request.phone());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        return UserView.from(users.save(user));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        return users.findByPhone(request.phone())
                .filter(user -> passwordEncoder.matches(request.password(), user.getPasswordHash()))
                .map(user -> {
                    String token = Jwts.builder()
                            .subject(user.getId().toString())
                            .claim("phone", user.getPhone())
                            .issuedAt(Date.from(Instant.now()))
                            .expiration(Date.from(Instant.now().plusSeconds(86400)))
                            .signWith(key)
                            .compact();
                    return ResponseEntity.ok(Map.of("token", token, "user", UserView.from(user)));
                })
                .orElseGet(() -> ResponseEntity.status(401).body(Map.of("error", "Invalid credentials")));
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
}

record RegisterRequest(String name, String phone, String password) {}
record LoginRequest(String phone, String password) {}
record UserView(Long id, String name, String phone, String status, String avatarUrl) {
    static UserView from(User user) {
        return new UserView(user.getId(), user.getName(), user.getPhone(), user.getStatus(), user.getAvatarUrl());
    }
}
