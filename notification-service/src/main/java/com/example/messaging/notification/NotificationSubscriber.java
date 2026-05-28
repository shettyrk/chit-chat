package com.example.messaging.notification;

import io.nats.client.Connection;
import io.nats.client.Dispatcher;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class NotificationSubscriber {
    private static final Logger log = LoggerFactory.getLogger(NotificationSubscriber.class);
    private final Connection nats;

    public NotificationSubscriber(Connection nats) {
        this.nats = nats;
    }

    @PostConstruct
    void subscribe() {
        Dispatcher dispatcher = nats.createDispatcher(message ->
                log.info("notification candidate from {}: {}", message.getSubject(), new String(message.getData())));
        dispatcher.subscribe("chat.message.send");
    }
}
