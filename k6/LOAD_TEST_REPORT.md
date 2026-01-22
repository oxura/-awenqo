# Load Test Report (K6)

## Summary
- **Scenario**: Constant arrival rate (1000 req/s) for 30s
- **Mix**: ~20% bids in the last 5 seconds of the round, ~80% leaderboard reads
- **Key endpoints**:
  - `POST /api/admin/auction`
  - `POST /api/admin/users/:userId/deposit`
  - `POST /api/auction/:auctionId/bid`
  - `GET /api/auction/:auctionId/leaderboard`

> Fill in the results below after running the test.

## Environment
- **API_URL**: `http://localhost:4000`
- **ADMIN_TOKEN**: `(not set)`
- **MongoDB**: `mongodb://localhost:27017/cryptobot?replicaSet=rs0`
- **Redis**: `redis://localhost:6379`
- **Host machine**: `Windows (local dev)`
- **k6 version**: `v1.5.0`

## Test Command
```powershell
$env:API_URL="http://localhost:4000"
$env:TEST_DURATION_SEC="30"
$env:BID_RATIO="0.2"
$env:BID_WINDOW_MS="5000"
& "C:\Program Files\k6\k6.exe" run --summary-trend-stats "avg,min,med,p(90),p(95),p(99),max" --summary-export k6\k6-summary.json k6\loadtest.js
```

## Results (from k6 output)
| Metric | Value |
| --- | --- |
| Requests/s | `460.98` |
| p50 latency | `1.04ms` |
| p95 latency | `122.92ms` |
| p99 latency | `207.55ms` |
| Avg latency | `41.52ms` |
| Max latency | `9.40s` |
| Error rate | `15.65%` |
| 429 rate-limited | `n/a (not tracked; see notes)` |
| 409 bid rejected | `n/a (not tracked; see notes)` |

## Observations
- Sustained ~461 req/s with 400 VU cap; 253 iterations were dropped during the run.
- Latency is low for the median request, but long-tail spikes appear under concurrent bidding.
- `bid accepted or rejected` check failures (4648) indicate non-201/409 responses under load (likely 429 rate limiting).

## Notes
- Admin routes require `ADMIN_TOKEN` when enabled. `k6/loadtest.js` uses the env var automatically.
- If Redis is unavailable, bid placement will fail because leaderboard cache is required.
