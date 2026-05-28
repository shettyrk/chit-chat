package com.example.messaging.message;

import io.nats.client.Connection;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/messages")
public class MessageController {
    private final MessageRepository messages;
    private final MessageStatusRepository statuses;
    private final Connection nats;
    private final MessageJson json;

    public MessageController(MessageRepository messages, MessageStatusRepository statuses, Connection nats, MessageJson json) {
        this.messages = messages;
        this.statuses = statuses;
        this.nats = nats;
        this.json = json;
    }

    @PostMapping
    public MessageEvent send(@RequestBody SendMessageRequest request) {
        MessageEntity message = new MessageEntity();
        message.setId(UUID.randomUUID().toString());
        message.setChatId(request.chatId());
        message.setSenderId(request.senderId());
        message.setContent(request.content());
        message.setType(request.type());
        message.setMediaUrl(request.mediaUrl());
        messages.save(message);

        for (Long userId : request.recipientIds()) {
            MessageStatusEntity status = new MessageStatusEntity();
            status.setMessageId(message.getId());
            status.setUserId(userId);
            status.setStatus(DeliveryStatus.SENT);
            statuses.save(status);
        }

        MessageEvent event = MessageEvent.from(message, request.recipientIds());
        nats.publish("chat.message.send", json.bytes(event));
        request.recipientIds().forEach(userId -> nats.publish("chat.message.receive." + userId, json.bytes(event)));
        return event;
    }

    @GetMapping("/chats/{chatId}")
    public List<MessageEntity> history(@PathVariable("chatId") Long chatId) {
        return messages.findByChatIdOrderByTimestampAsc(chatId);
    }

    @PatchMapping("/{messageId}/status")
    public Map<String, Object> updateStatus(@PathVariable("messageId") String messageId, @RequestBody StatusRequest request) {
        MessageStatusEntity status = statuses.findByMessageIdAndUserId(messageId, request.userId()).orElseThrow();
        status.setStatus(request.status());
        statuses.save(status);
        nats.publish("chat.read." + request.chatId(), json.bytes(new StatusEvent(messageId, request.chatId(), request.userId(), request.status())));
        return Map.of("messageId", messageId, "status", request.status());
    }

    @PostMapping(path = "/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, String> upload(@RequestPart MultipartFile file) throws Exception {
        Files.createDirectories(Path.of("uploads"));
        String name = UUID.randomUUID() + "-" + file.getOriginalFilename();
        Path target = Path.of("uploads", name);
        file.transferTo(target);
        return Map.of("url", "/api/media/" + name);
    }
}

record SendMessageRequest(Long chatId, Long senderId, List<Long> recipientIds, String content, MessageType type, String mediaUrl) {}
record StatusRequest(Long chatId, Long userId, DeliveryStatus status) {}
record StatusEvent(String messageId, Long chatId, Long userId, DeliveryStatus status) {}
