import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import supertest, { type Test } from "supertest";

const baseMongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017/cryptobot?replicaSet=rs0";
const httpApiMongoUrl = new URL(baseMongoUri);
httpApiMongoUrl.pathname = "/cryptobot_integration_http_api";
process.env.MONGO_URI = httpApiMongoUrl.toString();

const baseRedisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const httpApiRedisUrl = new URL(baseRedisUrl);
httpApiRedisUrl.pathname = "/3";
process.env.REDIS_URL = httpApiRedisUrl.toString();

const adminToken = "integration-admin-token";
process.env.ADMIN_TOKEN = adminToken;

/**
 * E2E HTTP API Tests
 * These tests require MongoDB (replica set) and Redis running.
 * Run with: RUN_INTEGRATION_TESTS=true npm run test:integration
 */

const shouldRun = process.env.RUN_INTEGRATION_TESTS === "true";

if (!shouldRun) {
  describe.skip("HTTP API E2E Tests", () => {
    it("skipped - set RUN_INTEGRATION_TESTS=true to run", () => { });
  });
} else {
  describe("HTTP API E2E Tests", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: any;
    let cleanupDb: () => Promise<void>;
    const withAdmin = (req: Test) => req.set("x-admin-token", adminToken);

    beforeAll(async () => {
      const http = await import("node:http");
      const { connectMongo, getCollections } = await import("../../src/infrastructure/db/mongo");
      const {
        MongoAuctionRepository,
        MongoBidRepository,
        MongoIdempotencyRepository,
        MongoRoundRepository,
        MongoTransactionManager,
        MongoUserRepository,
        MongoWalletRepository
      } = await import("../../src/infrastructure/repositories/mongoRepositories");
      const { RedisLeaderboardCache } = await import("../../src/infrastructure/cache/leaderboard");
      const { RedisDistributedLock } = await import("../../src/infrastructure/locks/redlock");
      const { BullMqRoundScheduler } = await import("../../src/infrastructure/queue/bullmq");
      const { PlaceBidUseCase } = await import("../../src/application/usecases/placeBid");
      const { FinishRoundUseCase } = await import("../../src/application/usecases/finishRound");
      const { WithdrawFundsUseCase } = await import("../../src/application/usecases/withdrawFunds");
      const { CreateAuctionUseCase } = await import("../../src/application/usecases/createAuction");
      const { StartRoundUseCase } = await import("../../src/application/usecases/startRound");
      const { CreditWalletUseCase } = await import("../../src/application/usecases/creditWallet");
      const { initSocketServer, SocketPublisher } = await import("../../src/presentation/ws/socket");
      const { createApp } = await import("../../src/presentation/http/app");
      const { env } = await import("../../src/config/env");

      const server = http.createServer();
      const io = initSocketServer(server, "*");
      const realtime = new SocketPublisher(io);

      const auctions = new MongoAuctionRepository();
      const rounds = new MongoRoundRepository();
      const bids = new MongoBidRepository();
      const users = new MongoUserRepository();
      const wallets = new MongoWalletRepository();
      const idempotency = new MongoIdempotencyRepository();
      const tx = new MongoTransactionManager();

      const leaderboard = new RedisLeaderboardCache();
      const lock = new RedisDistributedLock();
      const scheduler = new BullMqRoundScheduler();

      const createAuction = new CreateAuctionUseCase(auctions, rounds, scheduler, env.AUCTION_ROUND_DURATION_MS);
      const startRound = new StartRoundUseCase(auctions, rounds, scheduler, env.AUCTION_ROUND_DURATION_MS);
      const placeBid = new PlaceBidUseCase(
        auctions, rounds, bids, wallets, users, tx, leaderboard, scheduler, lock, realtime,
        env.AUCTION_ANTI_SNIPING_THRESHOLD_MS, env.AUCTION_ANTI_SNIPING_EXTENSION_MS,
        env.AUCTION_TOP_N, env.AUCTION_MIN_BID_STEP_PERCENT
      );
      const finishRound = new FinishRoundUseCase(
        auctions, rounds, bids, wallets, tx, scheduler, leaderboard, realtime,
        env.AUCTION_ROUND_DURATION_MS, env.AUCTION_TOP_N
      );
      const withdrawFunds = new WithdrawFundsUseCase(bids, wallets, tx, leaderboard, realtime, env.AUCTION_TOP_N);
      const creditWallet = new CreditWalletUseCase(wallets, users, tx);

      app = createApp({
        placeBid,
        finishRound,
        withdrawFunds,
        createAuction,
        startRound,
        creditWallet,
        auctions,
        rounds,
        bids,
        wallets,
        idempotency,
        leaderboard,
        leaderboardSize: env.AUCTION_TOP_N,
        minBidStepPercent: env.AUCTION_MIN_BID_STEP_PERCENT
      }, "*");

      // Retry connection
      let retries = 5;
      let delay = 2000;
      while (retries > 0) {
        try {
          await connectMongo();
          break;
        } catch {
          retries--;
          if (retries === 0) throw new Error("Failed to connect to MongoDB");
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 1.5;
        }
      }

      cleanupDb = async () => {
        const collections = await getCollections();
        await Promise.all([
          collections.auctions.deleteMany({}),
          collections.rounds.deleteMany({}),
          collections.bids.deleteMany({}),
          collections.wallets.deleteMany({}),
          collections.users.deleteMany({}),
          collections.walletLedger.deleteMany({}),
          collections.idempotency.deleteMany({})
        ]);
      };
    }, 60000);

    beforeEach(async () => {
      await cleanupDb();
    });

    afterAll(async () => {
      await cleanupDb();
    }, 10000);

    describe("GET /api/health", () => {
      it("returns ok status", async () => {
        const res = await supertest(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "ok" });
      });
    });

    describe("POST /api/admin/auction", () => {
      it("rejects missing admin token", async () => {
        const res = await supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Secure Auction", totalItems: 2 });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe("UNAUTHORIZED");
      });

      it("creates a new auction", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "E2E Test Auction", totalItems: 5 }));

        expect(res.status).toBe(201);
        expect(res.body.auction).toBeDefined();
        expect(res.body.auction.title).toBe("E2E Test Auction");
        expect(res.body.auction.totalItems).toBe(5);
        expect(res.body.auction.status).toBe("active");
      });

      it("creates auction with startNow", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Immediate Start", totalItems: 3, startNow: true }));

        expect(res.status).toBe(201);
        expect(res.body.auction).toBeDefined();
        expect(res.body.round).toBeDefined();
        expect(res.body.round.roundNumber).toBe(1);
      });

      it("validates required fields", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Missing totalItems" }));

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("VALIDATION_ERROR");
      });

      it("rejects non-positive totalItems", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Bad Items", totalItems: 0 }));

        expect(res.status).toBe(400);
      });
    });

    describe("POST /api/admin/users/:userId/deposit", () => {
      it("credits user wallet", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/users/test-user/deposit")
          .send({ amount: 1000 }));

        expect(res.status).toBe(201);
        expect(res.body.status).toBe("credited");

        // Verify wallet
        const walletRes = await supertest(app).get("/api/users/test-user/wallet");
        expect(walletRes.body.availableBalance).toBe(1000);
      });

      it("rejects non-positive amount", async () => {
        const res = await withAdmin(supertest(app)
          .post("/api/admin/users/test-user/deposit")
          .send({ amount: -100 }));

        expect(res.status).toBe(400);
      });
    });

    describe("GET /api/users/:userId/wallet", () => {
      it("returns wallet for existing user", async () => {
        await withAdmin(supertest(app)
          .post("/api/admin/users/wallet-user/deposit")
          .send({ amount: 500 }));

        const res = await supertest(app).get("/api/users/wallet-user/wallet");
        expect(res.status).toBe(200);
        expect(res.body.availableBalance).toBe(500);
        expect(res.body.lockedBalance).toBe(0);
      });

      it("returns zero balance for non-existing user", async () => {
        const res = await supertest(app).get("/api/users/non-existent/wallet");
        expect(res.status).toBe(200);
        expect(res.body.availableBalance).toBe(0);
        expect(res.body.lockedBalance).toBe(0);
      });
    });

    describe("POST /api/auction/:auctionId/bid", () => {
      it("places a bid successfully", async () => {
        // Create auction
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Bid Test", totalItems: 1, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        // Deposit funds
        await withAdmin(supertest(app)
          .post("/api/admin/users/bidder/deposit")
          .send({ amount: 1000 }));

        // Place bid
        const bidRes = await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "bidder", amount: 100 });

        expect(bidRes.status).toBe(201);
        expect(bidRes.body.amount).toBe(100);
        expect(bidRes.body.userId).toBe("bidder");
      });

      it("rejects bid with insufficient funds", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "No Money", totalItems: 1, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        // No deposit
        const bidRes = await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "broke-user", amount: 100 });

        expect(bidRes.status).toBe(409);
        expect(bidRes.body.error).toBe("INSUFFICIENT_FUNDS");
      });

      it("rejects bid below minimum step", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Step Test", totalItems: 1, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        await withAdmin(supertest(app).post("/api/admin/users/user1/deposit").send({ amount: 10000 }));
        await withAdmin(supertest(app).post("/api/admin/users/user2/deposit").send({ amount: 10000 }));

        // First bid
        await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "user1", amount: 100 });

        // Second bid too low (need 105, trying 102)
        const lowBidRes = await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "user2", amount: 102 });

        expect(lowBidRes.status).toBe(409);
        expect(lowBidRes.body.error).toBe("BID_TOO_LOW");
      });
    });

    describe("GET /api/auction/:auctionId/leaderboard", () => {
      it("returns sorted leaderboard", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Leaderboard Test", totalItems: 10, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        await withAdmin(supertest(app).post("/api/admin/users/u1/deposit").send({ amount: 10000 }));
        await withAdmin(supertest(app).post("/api/admin/users/u2/deposit").send({ amount: 10000 }));
        await withAdmin(supertest(app).post("/api/admin/users/u3/deposit").send({ amount: 10000 }));

        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "u1", amount: 100 });
        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "u2", amount: 110 });
        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "u3", amount: 150 });

        const res = await supertest(app).get(`/api/auction/${auctionId}/leaderboard`);

        expect(res.status).toBe(200);
        expect(res.body.bids).toHaveLength(3);
        expect(res.body.bids[0].amount).toBe(150); // Highest first
        expect(res.body.bids[1].amount).toBe(110);
        expect(res.body.bids[2].amount).toBe(100);
      });

      it("respects limit parameter", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Limit Test", totalItems: 10, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        await withAdmin(supertest(app).post("/api/admin/users/limiter/deposit").send({ amount: 10000 }));
        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "limiter", amount: 100 });
        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "limiter", amount: 200 });
        await supertest(app).post(`/api/auction/${auctionId}/bid`).send({ userId: "limiter", amount: 300 });

        const res = await supertest(app).get(`/api/auction/${auctionId}/leaderboard?limit=2`);

        expect(res.body.bids).toHaveLength(2);
      });
    });

    describe("POST /api/bid/:bidId/withdraw", () => {
      it("withdraws bid and refunds user", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Withdraw Test", totalItems: 1, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        await withAdmin(supertest(app).post("/api/admin/users/withdrawer/deposit").send({ amount: 500 }));

        const bidRes = await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "withdrawer", amount: 200 });
        const bidId = bidRes.body.id;

        // Withdraw
        const withdrawRes = await supertest(app)
          .post(`/api/bid/${bidId}/withdraw`)
          .send({ userId: "withdrawer" });

        expect(withdrawRes.status).toBe(200);
        expect(withdrawRes.body.status).toBe("withdrawn");

        // Verify wallet is restored
        const walletRes = await supertest(app).get("/api/users/withdrawer/wallet");
        expect(walletRes.body.availableBalance).toBe(500);
        expect(walletRes.body.lockedBalance).toBe(0);
      });

      it("rejects withdrawal by different user", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Forbidden Test", totalItems: 1, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        await withAdmin(supertest(app).post("/api/admin/users/owner/deposit").send({ amount: 500 }));

        const bidRes = await supertest(app)
          .post(`/api/auction/${auctionId}/bid`)
          .send({ userId: "owner", amount: 100 });

        const withdrawRes = await supertest(app)
          .post(`/api/bid/${bidRes.body.id}/withdraw`)
          .send({ userId: "hacker" });

        expect(withdrawRes.status).toBe(403);
        expect(withdrawRes.body.error).toBe("FORBIDDEN");
      });
    });

    describe("GET /api/auction/:auctionId", () => {
      it("returns auction and round info", async () => {
        const auctionRes = await withAdmin(supertest(app)
          .post("/api/admin/auction")
          .send({ title: "Info Test", totalItems: 5, startNow: true }));
        const auctionId = auctionRes.body.auction.id;

        const res = await supertest(app).get(`/api/auction/${auctionId}`);

        expect(res.status).toBe(200);
        expect(res.body.auction.id).toBe(auctionId);
        expect(res.body.auction.title).toBe("Info Test");
        expect(res.body.round).toBeDefined();
        expect(res.body.round.status).toBe("active");
        expect(res.body.config?.minBidStepPercent).toBeDefined();
      });

      it("returns 404 for non-existent auction", async () => {
        const res = await supertest(app).get("/api/auction/000000000000000000000000");
        expect(res.status).toBe(404);
      });
    });
  });
}
