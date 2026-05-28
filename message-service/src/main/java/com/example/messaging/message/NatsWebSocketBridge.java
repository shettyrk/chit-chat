package com.example.messaging.message;

import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import jakarta.annotation.PostConstruct;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class NatsWebSocketBridge {
    private final Connection nats;
    private final SimpMessagingTemplate websocket;
    private final MessageJson json;

    public NatsWebSocketBridge(Connection nats, SimpMessagingTemplate websocket, MessageJson json) {
        this.nats = nats;
        this.websocket = websocket;
        this.json = json;
    }

    @PostConstruct
    void subscribe() {
        Dispatcher dispatcher = nats.createDispatcher(message -> {
            MessageEvent event = json.read(message.getData(), MessageEvent.class);
            String subject = message.getSubject();
            String userId = subject.substring(subject.lastIndexOf('.') + 1);
            websocket.convertAndSend("/topic/messages/" + userId, event);
        });
        dispatcher.subscribe("chat.message.receive.*");

        Dispatcher readDispatcher = nats.createDispatcher(message -> {
            String chatId = message.getSubject().substring(message.getSubject().lastIndexOf('.') + 1);
            websocket.convertAndSend("/topic/read/" + chatId, json.read(message.getData(), StatusEvent.class));
        });
        readDispatcher.subscribe("chat.read.*");

        Dispatcher typingDispatcher = nats.createDispatcher(message -> {
            String chatId = message.getSubject().substring(message.getSubject().lastIndexOf('.') + 1);
            websocket.convertAndSend("/topic/typing/" + chatId, new String(message.getData()));
        });
        typingDispatcher.subscribe("chat.typing.*");

        Dispatcher presenceDispatcher = nats.createDispatcher(message ->
                websocket.convertAndSend("/topic/presence", new String(message.getData()))
        );
        presenceDispatcher.subscribe("user.status.update");
    }
}
