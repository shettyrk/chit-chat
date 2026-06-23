# NATS Spring WhatsApp-Style Messaging

Scalable real-time messaging scaffold using Spring Boot microservices, NATS, MySQL, Redis, React, and Expo mobile.

## Services

- `api-gateway`: JWT validation and routing to backend services.
- `user-service`: phone OTP login, contact discovery lookup, profile, and basic status storage.
- `chat-service`: private/group conversation metadata and membership.
- `message-service`: message persistence, delivery/read state, STOMP WebSocket bridge, NATS publishing/subscribing.
- `presence-service`: online/offline and typing events through NATS.
- `notification-service`: consumes message events and logs notification work for offline users.
- `frontend`: React + Context API + STOMP client chat UI.
- `mobile`: Expo React Native client for iOS and Android with OTP login, registered-contact discovery, local cache, STOMP live updates, groups, and media sends.

## Run

```powershell
docker compose up -d --build
```

Frontend: http://localhost:3000

Gateway: http://localhost:8080

Mobile:

```powershell
cd mobile
npm install
npm run start
```

Use `http://10.0.2.2:8080` and `ws://10.0.2.2:8083/ws/websocket` on the Android emulator. On a physical phone, replace the host with your computer LAN IP.

Local OTP codes are returned in the API response and shown in the mobile/web UI because `docker-compose.yml` sets `OTP_RETURN_CODE=true`. In production, set `OTP_RETURN_CODE=false` and connect `OtpService` to a real SMS provider.

Swagger:

- http://localhost:8081/swagger-ui.html user-service
- http://localhost:8082/swagger-ui.html chat-service
- http://localhost:8083/swagger-ui.html message-service
- http://localhost:8084/swagger-ui.html presence-service

## Demo Flow

1. Enter a phone number in E.164 format, for example `+919876543210`.
2. Request an OTP and verify it. Local Docker shows the development code in the UI.
3. Create a private chat with both user IDs.
4. Open two browsers, login as each user, and select the chat.
5. Sending a message calls `POST /api/messages`, persists in MySQL, publishes `chat.message.send`, fans out to `chat.message.receive.{userId}`, then pushes to `/topic/messages/{userId}`.

## Contact Discovery

The mobile app asks for contacts permission, reads phone numbers only, and calls `POST /api/users/contacts/lookup`. The backend normalizes numbers, returns matching registered users, and does not store the uploaded contact list.

## Oracle Cloud Deployment

1. Create an OCI VCN with a public subnet for the reverse proxy and private access for app dependencies.
2. Create an Ubuntu compute instance, install Docker and Docker Compose, and clone this repo.
3. Point DNS to the instance or to an OCI Load Balancer.
4. Expose only `80` and `443` publicly. Keep `8081-8084`, `3306`, `6379`, `4222`, and `8222` private.
5. Set production environment values: strong `JWT_SECRET`, real MySQL password, `OTP_RETURN_CODE=false`, and your SMS provider settings after wiring `OtpService`.
6. Put Nginx or Caddy in front of the gateway and WebSocket endpoint with HTTPS.
7. Run `docker compose up -d --build`.
8. Move MySQL to OCI MySQL HeatWave, media to OCI Object Storage, and images to OCI Container Registry before real production traffic.

## Mobile Release

1. Replace `ios.bundleIdentifier` and `android.package` in `mobile/app.json` with your real reverse-DNS app IDs.
2. Add production API URLs in the app before store builds.
3. From `mobile`, run `npm install`, then `eas build --platform android --profile production` and `eas build --platform ios --profile production`.
4. Submit with `eas submit --platform android` and `eas submit --platform ios`.
5. Complete privacy forms for phone number, contacts, messages, media, and diagnostics.
6. Add block/report/delete-account flows before public store launch.

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

