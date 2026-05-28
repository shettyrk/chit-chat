package com.example.messaging.message;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface MessageStatusRepository extends JpaRepository<MessageStatusEntity, Long> {
    List<MessageStatusEntity> findByMessageId(String messageId);
    Optional<MessageStatusEntity> findByMessageIdAndUserId(String messageId, Long userId);
}

