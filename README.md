# CryptoBot - Telegram Gift Auctions (Reference Implementation)

This repo implements a minimal but production-style backend and a demo UI for Telegram Gift Auctions mechanics.
Below is a concise description of the behavior as it is implemented in this codebase.

Backend (Render)
- URL: https://cryptobot-backend-2rf8.onrender.com
- Dashboard: https://dashboard.render.com/web/srv-d5pkrlur433s73ddode0
- CORS has been updated on Netlify URL (new deployment launched).

Frontend (Netlify)
- URL: https://cryptobot-frontend.netlify.app
- Project: https://app.netlify.com/projects/cryptobot-frontend
- Deploy: https://app.netlify.com/sites/4b89f8b1-df53-4bb8-9edc-8452b3700871/deploys/69734e0ab93cb3b06108076e

Demo video: https://github.com/oxura/-awenqo/blob/main/%D0%97%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%202026-01-23%20181523.mp4

## Mechanics (Telegram Gift Auctions)
- **Auction lifecycle**: `/api/admin/auction` creates an auction and (optionally) starts round #1. Each round lasts `AUCTION_ROUND_DURATION_MS`.
- **Ranking & winners**: At round close, bids are sorted by amount desc, timestamp asc; top **N** (`auction.totalItems`) are winners.
- **Minimum bid step**: New bids must be at least `minStepPercent` above the current top bid (ceil rounding).
- **Anti-sniping**: If a bid lands within the last `AUCTION_ANTI_SNIPING_THRESHOLD_MS`, the round end is extended by `AUCTION_ANTI_SNIPING_EXTENSION_MS`.
- **Wallet accounting**: Placing a bid moves funds from `available` → `locked`. Winners settle (locked funds deducted). Non-winners remain locked and may carry into future rounds or be withdrawn.
- **Carry-over**: Losing bids keep status `outbid` and remain in the leaderboard until a new round settles or funds are withdrawn.
- **Rate limiting**: `POST /api/auction/:id/bid` is limited to 100 requests per user per 10 seconds (falls back to IP if userId missing).
- **Idempotency**: `x-idempotency-key` supported on deposits and bids to dedupe retries.
- **Realtime**: Socket events broadcast leaderboard updates, round extensions, and round closures.

## Architecture (Clean Architecture)
- **Domain**: Entities + deterministic services (ranking, anti-sniping).
- **Application**: Use cases coordinate transactions and state transitions (PlaceBid, FinishRound, WithdrawFunds).
- **Infrastructure**:
  - MongoDB repositories with transactions (requires replica set).
  - Redis for leaderboards (ZSET + metadata), rate limiting, and distributed locking.
  - BullMQ schedules round closes and is rescheduled on anti-sniping extensions.
- **Presentation**: Express REST API + Socket.io realtime updates.
- **Safety choices**: Redis lock guards concurrent round extension; FinishRound rechecks `endTime` to avoid stale close jobs.

## Configuration
- `MONGO_URI` must point to a replica set (Mongo transactions).
- `REDIS_URL` for leaderboard cache, rate limiter, locks, and BullMQ.
- `ADMIN_TOKEN` enables admin route protection (header `x-admin-token`).
- `AUCTION_ROUND_DURATION_MS`, `AUCTION_ANTI_SNIPING_THRESHOLD_MS`, `AUCTION_ANTI_SNIPING_EXTENSION_MS` tune timing.
- `AUCTION_TOP_N` controls leaderboard size; `AUCTION_MIN_BID_STEP_PERCENT` controls minimum increment.

## Prerequisites
- Node.js 18+
- Docker + Docker Compose (for MongoDB + Redis)

## Quick Start
1) Start dependencies (Mongo + Redis):
```bash
docker compose up -d
```

2) Backend setup:
```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

3) Frontend setup:
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open the UI at `http://localhost:5173` (Vite default). The API runs at `http://localhost:4000`.

If you set `ADMIN_TOKEN` in `backend/.env`, all `/api/admin/*` routes require the header `x-admin-token: <ADMIN_TOKEN>`.

## Admin Security
- Optional protection for admin routes via `ADMIN_TOKEN`.
- When enabled, supply `x-admin-token` header for all `/api/admin/*` endpoints.
- The demo UI exposes an **Admin token** field that persists to localStorage.

## Tests
```bash
cd backend
npm test
```

Integration tests (requires MongoDB + Redis):
```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```

## Load Test (K6)
```bash
k6 run k6/loadtest.js
```

## Notes
- Redis is used for leaderboards (ZSET), rate limiting, and locking (Redlock).
- API responses include `x-server-time` for client-side timer sync.
- BullMQ is used for round closing and rescheduling on anti-sniping extensions.
- MongoDB transactions are required for balance safety.
