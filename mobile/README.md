# NATS Spring Mobile

React Native mobile client for the existing Spring/NATS chat APIs. It runs on iOS and Android through Expo.

## What Is Stored On Device

The app stores these items in `AsyncStorage`:

- API base URL
- logged-in session and JWT
- cached users for the current account
- cached chats for the current account
- cached messages per chat

This lets the mobile UI reopen with local data immediately and reduces repeated reads from the backend. The services still remain the source of truth for authentication, chat membership, message delivery, and cross-device sync.

## Run

```powershell
cd mobile
npm install
npm run start
```

Then open with:

- Android emulator: press `a`
- iOS simulator on macOS: press `i`
- physical device: scan the Expo QR code

## API URL

The login screen stores both a REST API server URL and a WebSocket URL.

- Android emulator default: `http://10.0.2.2:8080`
- iOS simulator default: `http://localhost:8080`
- Physical phone: use your computer LAN IP, for example `http://192.168.1.20:8080`

For the WebSocket URL, the app derives the default from the API URL:

- Android emulator default: `ws://10.0.2.2:8083/ws/websocket`
- iOS simulator default: `ws://localhost:8083/ws/websocket`
- Physical phone example: `ws://192.168.1.20:8083/ws/websocket`

Your Docker stack should be running from the repo root:

```powershell
docker compose up -d
```

## Native Scope

Implemented:

- login/register
- local session cache
- local user/chat/message cache
- live STOMP message, presence, typing, and read-receipt subscriptions
- private chat creation/reuse
- group creation
- send text messages
- send image and file attachments from device pickers
- render image messages in the conversation
- read message history
- online heartbeat
- presence lookup

Not yet implemented:

- push notifications
- encrypted local storage
- background sync

