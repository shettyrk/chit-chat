package com.example.messaging.chat;

import org.springframework.web.bind.annotation.*;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/chats")
public class ChatController {
    private final ChatRepository chats;

    public ChatController(ChatRepository chats) {
        this.chats = chats;
    }

    @PostMapping
    public Chat create(@RequestBody ChatRequest request) {
        Set<Long> memberIds = new HashSet<>(request.memberIds());
        if (request.type() == ChatType.PRIVATE && memberIds.size() == 2) {
            return chats.findPrivateCandidates(ChatType.PRIVATE, memberIds.stream().toList()).stream()
                    .filter(chat -> chat.getMemberIds().equals(memberIds))
                    .findFirst()
                    .orElseGet(() -> save(request, memberIds));
        }
        return save(request, memberIds);
    }

    private Chat save(ChatRequest request, Set<Long> memberIds) {
        Chat chat = new Chat();
        chat.setType(request.type());
        chat.setName(request.name());
        chat.setMemberIds(memberIds);
        return chats.save(chat);
    }

    @GetMapping("/{id}")
    public Chat get(@PathVariable("id") Long id) {
        return chats.findById(id).orElseThrow();
    }

    @GetMapping("/users/{userId}")
    public List<Chat> byUser(@PathVariable("userId") Long userId) {
        return chats.findByMember(userId);
    }

    @PostMapping("/{id}/members/{userId}")
    public Chat addMember(@PathVariable("id") Long id, @PathVariable("userId") Long userId) {
        Chat chat = chats.findById(id).orElseThrow();
        chat.getMemberIds().add(userId);
        return chats.save(chat);
    }
}

record ChatRequest(ChatType type, String name, Set<Long> memberIds) {}
