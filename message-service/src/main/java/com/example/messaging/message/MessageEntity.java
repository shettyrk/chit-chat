package com.example.messaging.message;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "messages")
public class MessageEntity {
    @Id
    private String id;
    private Long chatId;
    private Long senderId;
    @Column(length = 4096)
    private String content;
    @Enumerated(EnumType.STRING)
    private MessageType type;
    private String mediaUrl;
    private Instant timestamp = Instant.now();

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public Long getChatId() { return chatId; }
    public void setChatId(Long chatId) { this.chatId = chatId; }
    public Long getSenderId() { return senderId; }
    public void setSenderId(Long senderId) { this.senderId = senderId; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public MessageType getType() { return type; }
    public void setType(MessageType type) { this.type = type; }
    public String getMediaUrl() { return mediaUrl; }
    public void setMediaUrl(String mediaUrl) { this.mediaUrl = mediaUrl; }
    public Instant getTimestamp() { return timestamp; }
}

enum MessageType {
    TEXT, IMAGE, FILE
}

