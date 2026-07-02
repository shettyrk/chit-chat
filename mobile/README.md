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

## Phone Login And Contacts

The app uses phone OTP login:

1. Enter a phone number in E.164 format, for example `+919876543210`.
2. Tap `Send code`.
3. In local Docker, use the displayed development code.
4. In production, set `OTP_RETURN_CODE=false` and send the code through an SMS provider.

The `Scan contacts` action asks for contact permission, reads phone numbers only, and sends those numbers to `/api/users/contacts/lookup`. The backend returns only registered users.

## Native Scope

Implemented:

- phone OTP login
- registered-contact discovery
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
- block/report/delete-account flows required for public app-store launch

## Store Builds

```powershell
npm install
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

Before release, update `app.json` with your real iOS bundle identifier, Android package, app icon, splash screen, and production API URLs.

For CI/EAS builds, you can set default server URLs at build time:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="https://your-domain"
$env:EXPO_PUBLIC_WS_URL="wss://your-domain/ws/websocket"
```
