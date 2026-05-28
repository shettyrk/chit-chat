package com.example.messaging.chat;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "chats")
public class Chat {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Enumerated(EnumType.STRING)
    private ChatType type;
    private String name;
    private Instant createdAt = Instant.now();
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "chat_members", joinColumns = @JoinColumn(name = "chat_id"))
    @Column(name = "user_id")
    private Set<Long> memberIds = new HashSet<>();

    public Long getId() { return id; }
    public ChatType getType() { return type; }
    public void setType(ChatType type) { this.type = type; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Instant getCreatedAt() { return createdAt; }
    public Set<Long> getMemberIds() { return memberIds; }
    public void setMemberIds(Set<Long> memberIds) { this.memberIds = memberIds; }
}

enum ChatType {
    PRIVATE, GROUP
}

