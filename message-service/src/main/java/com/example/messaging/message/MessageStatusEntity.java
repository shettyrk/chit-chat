package com.example.messaging.message;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "message_status")
public class MessageStatusEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String messageId;
    private Long userId;
    @Enumerated(EnumType.STRING)
    private DeliveryStatus status;
    private Instant updatedAt = Instant.now();

    public Long getId() { return id; }
    public String getMessageId() { return messageId; }
    public void setMessageId(String messageId) { this.messageId = messageId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public DeliveryStatus getStatus() { return status; }
    public void setStatus(DeliveryStatus status) { this.status = status; this.updatedAt = Instant.now(); }
    public Instant getUpdatedAt() { return updatedAt; }
}

enum DeliveryStatus {
    SENT, DELIVERED, READ
}

