# Dekha Kya? - Gmail Email Tracking Application

An enterprise-ready, recipient-level and message-level email tracking application inspired by Mailsuite/Mailtrack.

## Architecture Overview

```
Chrome Extension (Manifest V3)
   │
   ├─ Gmail Compose UI interception
   ├─ Split multi-recipient outbound sends into individual copies
   └─ Inject distinct tracking pixels per recipient
   │
   ▼
NestJS REST API (Backend) ◄─── Next.js Web Dashboard (Frontend)
   │
   ├─ Auth Controllers (Google OAuth 2.0)
   ├─ Tracking Services & Cryptographic Tokens
   └─ Transparent 1x1 Pixel Generator
   │
   ▼
PostgreSQL Database (Prisma ORM)
```

## Repository Structure

```
├── apps/
│   ├── api/          # NestJS Server (TypeScript, Prisma, REST)
│   ├── web/          # Next.js Dashboard (React, Tailwind CSS, TanStack Query)
│   └── extension/    # Chrome Extension (Manifest V3, TS content/background scripts)
├── packages/
│   ├── config/       # Shared TypeScript and ESLint configurations
│   └── shared/       # Shared DTO contracts, enums, and typescript interfaces
├── docker-compose.yml # Containerized PostgreSQL local runner
└── package.json       # Monorepo workspaces coordinator
```

---

## Local Setup

### 1. Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)
- Docker & Docker Compose (optional for local database execution)

### 2. Installation
Run the following command at the root to resolve workspace dependencies and link the shared package:
```bash
npm install
```

### 3. Database Initialization (PostgreSQL)
Start the PostgreSQL container:
```bash
docker compose up -d
```
Generate Prisma Clients:
```bash
npm run prisma:generate --workspace=apps/api
```
Run migrations:
```bash
npm run prisma:migrate --workspace=apps/api
```

### 4. Running the Development Servers
Launch all applications (Web, API, Extension compilation) in parallel:
```bash
npm run dev
```

---

## Google Cloud Console Setup

To connect real Gmail accounts:
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Project.
3. Enable the **Gmail API** under **APIs & Services**.
4. Configure the **OAuth Consent Screen**:
   - Set User Type to **External** (or Internal if under a workspace domain).
   - Add the minimum scope required: `https://www.googleapis.com/auth/gmail.send` (to send outgoing message copies).
5. Create credentials for an **OAuth 2.0 Client ID**:
   - Application Type: **Web application**.
   - Authorized Javascript Origins: `http://localhost:4000` (API backend).
   - Authorized Redirect URIs: `http://localhost:4000/api/auth/google/callback`.
6. Copy the Client ID and Secret and paste them into `apps/api/.env`.

---

## Chrome Extension Installation

To install the compose tracker:
1. Compile the extension workspace first:
   ```bash
   npm run build --workspace=apps/extension
   ```
2. Open Chrome browser and navigate to `chrome://extensions/`.
3. Toggle the **Developer mode** switch at the top right.
4. Click **Load unpacked** at the top left.
5. Choose the compiled directory: `c:\Users\ADMIN\Desktop\pern\assesment\dekha-kya\apps\extension`.
6. The extension is now active on your Chrome profile and will automatically observe Gmail tab compose actions.

---

## Local HTTPS Requirement for Gmail Tracking

Gmail uses an image proxy (`googleusercontent.com/proxy`) to render visual components. If your backend is running on `http://localhost:4000`, Google's proxy will fail to load the tracking pixel because it is not accessible over the public internet and does not use secure HTTPS.

To test live pixel opens in real-world environments:
1. Run a secure local tunnel, e.g., using **ngrok**:
   ```bash
   ngrok http 4000
   ```
2. Copy the resulting HTTPS forwarding URL (e.g. `https://abcd-12-34.ngrok-free.app`).
3. Update the `API_URL` environment variable inside `apps/api/.env` to point to that ngrok domain:
   ```env
   API_URL="https://abcd-12-34.ngrok-free.app"
   ```
4. Restart your NestJS API server. The Chrome Extension and tracking URLs will now route through ngrok, allowing Google's proxy to reach your endpoint and log opens.

---

## Running Automated Tests

To verify that the tracking and sending workflows operate correctly:
1. Navigate to the API application workspace:
   ```bash
   cd apps/api
   ```
2. Run Jest integration tests:
   ```bash
   npm run test
   ```

---

## Development Notes

### Terminological Accuracy
To prevent misleading tracking metrics, the frontend/UI references **"Detected opens"** rather than "Confirmed reads". 

### Recipient-level Accuracy
A unique tracking token is generated for each recipient (`TO`, `CC`, `BCC`). The Chrome extension intercepts the Gmail send button for multi-recipient emails and registers unique tracking tokens with the backend, allowing individual tracking of opens.

