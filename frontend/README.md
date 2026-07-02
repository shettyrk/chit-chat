# Chit Chat Frontend

React/Vite frontend for the Chit Chat backend. It can run against either the Java backend or the Go backend as long as the gateway is available on port `8080`.

## Run Locally

```powershell
npm ci
$env:VITE_API_BASE_URL="http://localhost:8080"
$env:VITE_WS_URL="http://localhost:8080/ws"
npm run dev
```

Open the Vite URL shown in the terminal.

## Build

```powershell
npm run build
```

## Docker

```powershell
docker build -t chit-chat-frontend .
```

The included Nginx config proxies `/api`, `/actuator`, and `/ws` to an `api-gateway` container on the same Docker network.
