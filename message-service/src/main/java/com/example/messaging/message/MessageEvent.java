package com.example.messaging.message;

import java.time.Instant;
import java.util.List;

public record MessageEvent(
        String id,
        Long chatId,
        Long senderId,
        List<Long> recipientIds,
        String content,
        MessageType type,
        String mediaUrl,
        Instant timestamp
) {
    static MessageEvent from(MessageEntity message, List<Long> recipientIds) {
        return new MessageEvent(
                message.getId(),
                message.getChatId(),
                message.getSenderId(),
                recipientIds,
                message.getContent(),
                message.getType(),
                message.getMediaUrl(),
                message.getTimestamp()
        );
    }
}

