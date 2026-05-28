package com.example.messaging.chat;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface ChatRepository extends JpaRepository<Chat, Long> {
    @Query("select c from Chat c join c.memberIds m where m = :userId")
    List<Chat> findByMember(@Param("userId") Long userId);

    @Query("select distinct c from Chat c join c.memberIds m where c.type = :type and m in :memberIds")
    List<Chat> findPrivateCandidates(@Param("type") ChatType type, @Param("memberIds") List<Long> memberIds);
}
