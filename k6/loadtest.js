import http from "k6/http";
import { check, sleep } from "k6";

const API_URL = __ENV.API_URL || "http://localhost:4000";
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || "";
const TEST_DURATION_SEC = Number(__ENV.TEST_DURATION_SEC || 30);
const BID_RATIO = Number(__ENV.BID_RATIO || 0.1);
const BID_WINDOW_MS = Number(__ENV.BID_WINDOW_MS || 5000);
const HEADERS = { "Content-Type": "application/json" };
const adminHeaders = ADMIN_TOKEN
  ? { ...HEADERS, "x-admin-token": ADMIN_TOKEN }
  : HEADERS;

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: `${TEST_DURATION_SEC}s`,
      preAllocatedVUs: 200,
      maxVUs: 400
    }
  }
};

function getServerTime(response) {
  const header = response?.headers?.["x-server-time"];
  const serverTime = header ? Number(header) : Number.NaN;
  return Number.isFinite(serverTime) ? serverTime : Date.now();
}

export function setup() {
  const createRes = http.post(
    `${API_URL}/api/admin/auction`,
    JSON.stringify({ title: "Load Test Auction", totalItems: 100, startNow: true }),
    { headers: adminHeaders }
  );
  check(createRes, { "auction created": (r) => r.status === 201 });
  const json = createRes.json();
  const auctionId = json?.auction?.id;

  http.post(
    `${API_URL}/api/admin/users/loadtest/deposit`,
    JSON.stringify({ amount: 100000000 }),
    { headers: adminHeaders }
  );

  let roundEndMs = null;
  let serverOffsetMs = 0;
  if (auctionId) {
    const stateRes = http.get(`${API_URL}/api/auction/${auctionId}`);
    check(stateRes, { "auction state": (r) => r.status === 200 });
    const state = stateRes.json();
    const serverNow = getServerTime(stateRes);
    serverOffsetMs = serverNow - Date.now();
    if (state?.round?.endTime) {
      roundEndMs = Date.parse(state.round.endTime);
      const timeToEndMs = roundEndMs - serverNow;
      const delayMs = timeToEndMs - TEST_DURATION_SEC * 1000;
      if (delayMs > 0) {
        sleep(delayMs / 1000);
      }
    }
  }
  return { auctionId, roundEndMs, serverOffsetMs };
}

export default function (data) {
  const auctionId = data.auctionId;
  if (!auctionId) {
    return;
  }
  const nowMs = Date.now() + (data.serverOffsetMs || 0);
  const roundEndMs = typeof data.roundEndMs === "number" ? data.roundEndMs : null;
  const timeLeftMs = roundEndMs ? roundEndMs - nowMs : null;
  const inBidWindow = timeLeftMs !== null && timeLeftMs <= BID_WINDOW_MS && timeLeftMs > 0;
  const bidProbability = Math.min(1, (BID_RATIO * TEST_DURATION_SEC * 1000) / BID_WINDOW_MS);
  const shouldBid = inBidWindow && Math.random() < bidProbability;

  if (shouldBid) {
    const bidRes = http.post(
      `${API_URL}/api/auction/${auctionId}/bid`,
      JSON.stringify({ userId: "loadtest", amount: 5 + Math.floor(Math.random() * 50) }),
      { headers: HEADERS }
    );
    check(bidRes, { "bid accepted or rejected": (r) => [201, 409].includes(r.status) });
  } else {
    const lbRes = http.get(`${API_URL}/api/auction/${auctionId}/leaderboard?limit=100`);
    check(lbRes, { "leaderboard ok": (r) => r.status === 200 });
  }

  sleep(0.1);
}
