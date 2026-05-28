package com.example.messaging.message;

import io.nats.client.Connection;
import io.nats.client.Nats;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.io.IOException;

@Configuration
public class NatsConfig {
    @Bean
    Connection natsConnection(@Value("${app.nats-url}") String url) throws IOException, InterruptedException {
        return Nats.connect(url);
    }
}

