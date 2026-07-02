# Deployment

This project is easiest to host as one Docker Compose stack because the backend is several long-running services plus MySQL, Redis, and NATS.

## Free Hosting Recommendation

Use Oracle Cloud Free Tier for the backend and bundled web frontend. Oracle lists Always Free compute, block volume, networking, load balancer, object storage, and related services. A single Always Free VM can run this repo with `docker-compose.prod.yml`.

You can also host only the static React frontend on Vercel or Cloudflare Pages for free, but the backend still needs a VM or paid container host because it needs persistent MySQL, Redis, NATS, and WebSocket services.

## Hosting Options And 500-User Sizing

Recommended starting options:

| Use case | Good fit | Why |
| --- | --- | --- |
| Free demo or MVP | Oracle Cloud Always Free VM | Can run Docker Compose, database, Redis, NATS, frontend, and backend together. Capacity can be limited by regional availability. |
| Low-cost paid production | One VPS from DigitalOcean, Hetzner, Vultr, Linode/Akamai, or similar | Simple Docker deployment, predictable monthly cost, full control over ports and persistent volumes. |
| Managed app hosting | Render, Fly.io, Railway, or similar | Easier deploys, logs, and TLS, but this app has many services, so costs rise faster than a single VPS. |
| Static web only | Vercel, Cloudflare Pages, Netlify | Good for the React frontend only. Backend still needs a separate host. |

For around 500 registered users with light to moderate usage, start with:

- `4 vCPU`
- `8 GB RAM`
- `80-100 GB SSD`
- Ubuntu LTS
- Docker Compose
- weekly VM snapshots or database backups

That is the practical minimum for this repo because it runs several Spring Boot JVMs plus MySQL, Redis, NATS, Nginx, and Caddy on the same machine.

If "500 users" means 500 users online at the same time with active WebSocket connections, use:

- `4-8 vCPU`
- `16 GB RAM`
- `100+ GB SSD`
- managed MySQL or a separate database VM
- object storage for media uploads

For a small demo, `2 vCPU` and `4 GB RAM` can work, but expect less headroom and occasional memory pressure during builds or traffic spikes.

Scale-up path:

1. Move media files from local disk to object storage.
2. Move MySQL to a managed database or separate VM.
3. Keep Redis and NATS private.
4. Run 2+ instances of gateway/message/presence services behind a load balancer.
5. Add monitoring for CPU, memory, disk, JVM heap, database connections, and WebSocket count.

## Files Added For Deployment

- `.env.example`: production environment template.
- `docker-compose.prod.yml`: production stack with only Caddy exposed publicly.
- `Caddyfile`: reverse proxy in front of the frontend Nginx container. If `PUBLIC_DOMAIN` is a real public domain, Caddy automatically requests HTTPS certificates.

## Deploy Full App Free On Oracle Cloud

1. Create an Oracle Cloud Free Tier account.
2. Create an Always Free Ubuntu VM. Ampere A1 is preferred if available; an AMD Always Free VM also works for small demos.
3. Open inbound ports `80` and `443` in the VM subnet security list. Do not expose `3306`, `6379`, `4222`, `8080`, or service ports publicly.
4. SSH into the VM and install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version
```

5. Clone the repo and create production env values:

```bash
git clone <your-repo-url> chit-chat
cd chit-chat
cp .env.example .env
openssl rand -base64 32
```

6. Edit `.env`:

```env
MYSQL_ROOT_PASSWORD=<long random password>
JWT_SECRET=<at least 32 random characters>
OTP_RETURN_CODE=false
PHONE_DEFAULT_COUNTRY_CODE=+91
```

7. For a free HTTPS-capable hostname, use your VM public IP with `sslip.io`:

```env
PUBLIC_DOMAIN=chitchat.<your-public-ip>.sslip.io
CORS_ALLOWED_ORIGIN_PATTERNS=https://chitchat.<your-public-ip>.sslip.io
PUBLIC_HTTP_PORT=80
PUBLIC_HTTPS_PORT=443
```

Example: if your VM IP is `203.0.113.10`, use `chitchat.203.0.113.10.sslip.io`.

8. Start the stack:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml ps
```

9. Test:

```bash
curl https://chitchat.<your-public-ip>.sslip.io/actuator/health
```

Open `https://chitchat.<your-public-ip>.sslip.io` in a browser.

## Optional Static Frontend Hosting

If you want the React frontend separately on Vercel or Cloudflare Pages:

- Project root: `frontend`
- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Environment:

```env
VITE_API_BASE_URL=https://your-backend-domain
VITE_WS_URL=https://your-backend-domain/ws
```

Then set the backend `.env` value:

```env
CORS_ALLOWED_ORIGIN_PATTERNS=https://your-frontend-domain
```

## Mobile Devices

For free testing on real phones:

1. Keep the backend running at `https://your-domain`.
2. Install Expo Go on Android or iOS.
3. Start the mobile app locally:

```powershell
cd mobile
npm ci
npm run start
```

4. Scan the QR code and enter:

```text
API server URL: https://your-domain
WebSocket URL: wss://your-domain/ws/websocket
```

For shareable Android/iOS builds with EAS:

```powershell
cd mobile
npx eas-cli login
$env:EXPO_PUBLIC_API_BASE_URL="https://your-domain"
$env:EXPO_PUBLIC_WS_URL="wss://your-domain/ws/websocket"
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

Expo currently lists a free EAS plan with monthly Android and iOS build allowance. App store publishing still requires the store accounts: Google Play has its own registration fee, and Apple Developer Program is paid. For completely free iOS testing, use Expo Go.

## Production Notes

- `OTP_RETURN_CODE=false` must be used outside local development.
- `OtpService` still needs a real SMS provider before public launch.
- Move media uploads to object storage before real traffic.
- Add push notifications, delete-account, block/report, and privacy-policy flows before app-store release.
