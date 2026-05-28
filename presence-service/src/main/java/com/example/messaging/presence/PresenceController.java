package com.example.messaging.presence;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/presence")
public class PresenceController {
    private final StringRedisTemplate redis;
    private final Connection nats;
    private final ObjectMapper mapper;

    public PresenceController(StringRedisTemplate redis, Connection nats, ObjectMapper mapper) {
        this.redis = redis;
        this.nats = nats;
        this.mapper = mapper;
    }

    @PostMapping("/{userId}/online")
    public PresenceEvent online(@PathVariable("userId") Long userId) throws Exception {
        return update(userId, "ONLINE");
    }

    @PostMapping("/{userId}/offline")
    public PresenceEvent offline(@PathVariable("userId") Long userId) throws Exception {
        return update(userId, "OFFLINE");
    }

    @GetMapping("/{userId}")
    public Map<String, String> get(@PathVariable("userId") Long userId) {
        String status = redis.opsForValue().get("presence:" + userId);
        return Map.of("userId", userId.toString(), "status", status == null ? "OFFLINE" : status);
    }

    @PostMapping("/typing")
    public TypingEvent typing(@RequestBody TypingEvent event) throws Exception {
        nats.publish("chat.typing." + event.chatId(), mapper.writeValueAsBytes(event));
        return event;
    }

    private PresenceEvent update(Long userId, String status) throws Exception {
        redis.opsForValue().set("presence:" + userId, status, Duration.ofMinutes(5));
        PresenceEvent event = new PresenceEvent(userId, status, Instant.now());
        nats.publish("user.status.update", mapper.writeValueAsBytes(event));
        return event;
    }
}

record PresenceEvent(Long userId, String status, Instant timestamp) {}
record TypingEvent(Long chatId, Long userId, boolean typing) {}
