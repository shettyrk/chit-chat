package com.example.messaging.message;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

@Component
public class MessageJson {
    private final ObjectMapper mapper;

    public MessageJson(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    byte[] bytes(Object value) {
        try {
            return mapper.writeValueAsBytes(value);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    <T> T read(byte[] bytes, Class<T> type) {
        try {
            return mapper.readValue(bytes, type);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}

