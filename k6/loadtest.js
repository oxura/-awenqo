import http from "k6/http";
import { check, sleep } from "k6";

const API_URL = __ENV.API_URL || "http://localhost:4000";
const HEADERS = { "Content-Type": "application/json" };

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: 1000,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 200,
      maxVUs: 400
    }
  }
};

export function setup() {
  const createRes = http.post(
    `${API_URL}/api/admin/auction`,
    JSON.stringify({ title: "Load Test Auction", totalItems: 100, startNow: true }),
    { headers: HEADERS }
  );
  const json = createRes.json();
  const auctionId = json?.auction?.id;

  http.post(
    `${API_URL}/api/admin/users/loadtest/deposit`,
    JSON.stringify({ amount: 100000000 }),
    { headers: HEADERS }
  );

  return { auctionId };
}

export default function (data) {
  const auctionId = data.auctionId;
  if (!auctionId) {
    return;
  }
  const seconds = new Date().getUTCSeconds();
  const inLastFiveSeconds = seconds >= 55;
  const shouldBid = inLastFiveSeconds && Math.random() < 0.1;

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
