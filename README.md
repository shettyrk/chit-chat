# NATS Spring WhatsApp-Style Messaging

Scalable real-time messaging scaffold using Spring Boot microservices, NATS, MySQL, Redis, and React.

## Services

- `api-gateway`: JWT validation and routing to backend services.
- `user-service`: registration, login, profile, and basic status storage.
- `chat-service`: private/group conversation metadata and membership.
- `message-service`: message persistence, delivery/read state, STOMP WebSocket bridge, NATS publishing/subscribing.
- `presence-service`: online/offline and typing events through NATS.
- `notification-service`: consumes message events and logs notification work for offline users.
- `frontend`: React + Context API + STOMP client chat UI.

## Run

```powershell
docker compose up -d --build
```

Frontend: http://localhost:3000

Gateway: http://localhost:8080

Swagger:

- http://localhost:8081/swagger-ui.html user-service
- http://localhost:8082/swagger-ui.html chat-service
- http://localhost:8083/swagger-ui.html message-service
- http://localhost:8084/swagger-ui.html presence-service

## Demo Flow

1. Register two users through the UI or Postman.
2. Login and copy the returned JWT.
3. Create a private chat with both user IDs.
4. Open two browsers, login as each user, and select the chat.
5. Sending a message calls `POST /api/messages`, persists in MySQL, publishes `chat.message.send`, fans out to `chat.message.receive.{userId}`, then pushes to `/topic/messages/{userId}`.

## NATS Subjects

- `chat.message.send`
- `chat.message.receive.{userId}`
- `user.status.update`
- `chat.typing.{chatId}`
- `chat.read.{chatId}`

## Interview Notes

### Why NATS over Kafka?

NATS is small, fast, operationally simple, and built for low-latency fanout. It is a good fit for online messaging signals like message delivery, typing, and presence where request-to-push latency matters. Kafka is stronger for heavy durable event logs, analytics, and replay over long retention windows. This project uses NATS JetStream so critical message events can still be persisted and replayed while keeping the realtime path lightweight.

### Scaling to Millions of Users

Run gateway, message, presence, and notification services horizontally. WebSocket connections are distributed behind a load balancer with sticky sessions or an external STOMP broker relay. NATS handles cross-node event fanout, and each message service instance subscribes to wildcard subjects such as `chat.message.receive.*`. MySQL is partitioned by chat ID or time, read replicas serve history, Redis caches sessions and presence, and media goes to object storage rather than the database.

### Offline Users

Messages are persisted before publishing. If a user is offline, the UI receives the message on next sync from `GET /api/messages/chats/{chatId}`. Notification service can use the same event stream to trigger push/email. Delivery status changes to `DELIVERED` only when the receiver connection acknowledges delivery.

### Ordering

Ordering is maintained per chat by storing `created_at` and using a per-chat publish path. For stricter ordering at scale, route all events for a `chatId` to the same stream partition/key, assign monotonic sequence numbers per chat, and make clients sort by sequence before rendering.

### Fault Tolerance

The send API writes to MySQL before publishing. NATS JetStream can retain events for replay. Consumers use idempotent updates keyed by message ID. Services are stateless where possible, health-checked in Docker/Kubernetes, and can be restarted independently.

