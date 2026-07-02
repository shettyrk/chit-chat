package com.example.messaging.user;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Duration;

@Service
public class OtpService {
    private static final Logger log = LoggerFactory.getLogger(OtpService.class);

    private final StringRedisTemplate redis;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom secureRandom = new SecureRandom();
    private final int ttlSeconds;
    private final int resendSeconds;
    private final int maxAttempts;
    private final boolean returnCode;

    public OtpService(
            StringRedisTemplate redis,
            PasswordEncoder passwordEncoder,
            @Value("${app.otp.ttl-seconds:300}") int ttlSeconds,
            @Value("${app.otp.resend-seconds:30}") int resendSeconds,
            @Value("${app.otp.max-attempts:5}") int maxAttempts,
            @Value("${app.otp.return-code:false}") boolean returnCode
    ) {
        this.redis = redis;
        this.passwordEncoder = passwordEncoder;
        this.ttlSeconds = ttlSeconds;
        this.resendSeconds = resendSeconds;
        this.maxAttempts = maxAttempts;
        this.returnCode = returnCode;
    }

    public OtpStartResult start(String phone) {
        Boolean allowed = redis.opsForValue().setIfAbsent(cooldownKey(phone), "1", Duration.ofSeconds(resendSeconds));
        if (Boolean.FALSE.equals(allowed)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Wait before requesting another code");
        }

        String code = "%06d".formatted(secureRandom.nextInt(1_000_000));
        redis.opsForValue().set(codeKey(phone), passwordEncoder.encode(code), Duration.ofSeconds(ttlSeconds));
        redis.delete(attemptsKey(phone));

        if (returnCode) {
            log.info("Development OTP for {} is {}", phone, code);
        } else {
            log.info("OTP challenge created for {}", phone);
        }
        return new OtpStartResult(ttlSeconds, returnCode ? code : null);
    }

    public void verify(String phone, String code) {
        if (code == null || !code.matches("^\\d{4,8}$")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid OTP");
        }

        String hash = redis.opsForValue().get(codeKey(phone));
        if (hash == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "OTP expired or invalid");
        }

        Long attempts = redis.opsForValue().increment(attemptsKey(phone));
        if (attempts != null && attempts == 1) {
            redis.expire(attemptsKey(phone), Duration.ofSeconds(ttlSeconds));
        }
        if (attempts != null && attempts > maxAttempts) {
            clear(phone);
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many OTP attempts");
        }

        if (!passwordEncoder.matches(code, hash)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid OTP");
        }

        clear(phone);
    }

    private void clear(String phone) {
        redis.delete(codeKey(phone));
        redis.delete(attemptsKey(phone));
        redis.delete(cooldownKey(phone));
    }

    private String codeKey(String phone) {
        return "otp:code:" + phone;
    }

    private String attemptsKey(String phone) {
        return "otp:attempts:" + phone;
    }

    private String cooldownKey(String phone) {
        return "otp:cooldown:" + phone;
    }
}

record OtpStartResult(int expiresInSeconds, String devCode) {}
