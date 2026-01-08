# CryptoBot - Telegram Gift Auctions (Reference Implementation)

This repo implements a minimal but production-style backend and a demo UI for Telegram Gift Auctions mechanics.

## Mechanics (Telegram Gift Auctions)
- **Rounds & winners**: Each auction has time-boxed rounds. At round close, top N bids (by amount desc, timestamp asc) are winners.
- **Anti-sniping**: If a bid lands within the last `threshold` (default 60s), the round end time is extended by `extension` (default +120s).
- **Ranking**: Higher bid wins; ties resolve by earlier timestamp.
- **Balance safety**: Uses hold/release (available vs locked). Placing a bid moves funds to locked; withdrawals release funds.
- **Carry-over**: Non-winning bids stay locked for future rounds until withdrawn or winning (per spec).

## Architecture (Clean Architecture)
- **Domain**: Pure entities + business rules (ranking, anti-sniping).
- **Application**: Use cases (PlaceBid, FinishRound, WithdrawFunds) orchestrate transactions.
- **Infrastructure**: MongoDB repositories, Redis cache (ZSET leaderboard), BullMQ scheduler, Redlock.
- **Presentation**: Express REST API + Socket.io realtime updates.

## Prerequisites
- Node.js 18+
- Docker (for MongoDB + Redis)

## Quick Start
1) Start dependencies:
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

Open the UI at the Vite dev server URL and use the Admin panel to seed an auction and balance.

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
k6 run ../k6/loadtest.js
```

## Notes
- Redis is used for leaderboards (ZSET) and locking (Redlock).
- BullMQ is used for round closing and rescheduling on anti-sniping extensions.
- MongoDB transactions are required for balance safety.
