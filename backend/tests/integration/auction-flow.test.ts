import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const baseMongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017/cryptobot?replicaSet=rs0";
const auctionFlowMongoUrl = new URL(baseMongoUri);
auctionFlowMongoUrl.pathname = "/cryptobot_integration_auction_flow";
process.env.MONGO_URI = auctionFlowMongoUrl.toString();

const baseRedisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const auctionFlowRedisUrl = new URL(baseRedisUrl);
auctionFlowRedisUrl.pathname = "/2";
process.env.REDIS_URL = auctionFlowRedisUrl.toString();

/**
 * Integration tests for complete auction flow.
 * These tests require MongoDB (replica set) and Redis running.
 * Run with: RUN_INTEGRATION_TESTS=true npm run test:integration
 */

const shouldRun = process.env.RUN_INTEGRATION_TESTS === "true";

if (!shouldRun) {
  describe.skip("Full Auction Flow Integration Tests", () => {
    it("skipped - set RUN_INTEGRATION_TESTS=true to run", () => { });
  });
} else {
  describe("Full Auction Flow Integration Tests", () => {
    let deps: {
      connectMongo: () => Promise<unknown>;
      getCollections: () => Promise<{
        auctions: { deleteMany: (filter: object) => Promise<unknown> };
        rounds: { deleteMany: (filter: object) => Promise<unknown>; updateOne: (filter: object, update: object) => Promise<unknown> };
        bids: { deleteMany: (filter: object) => Promise<unknown> };
        wallets: { deleteMany: (filter: object) => Promise<unknown> };
        users: { deleteMany: (filter: object) => Promise<unknown> };
      }>;
      createAuction: { execute: (input: { title: string; totalItems: number; startNow?: boolean }) => Promise<{ auction: { id: string }; round?: { id: string } }> };
      startRound: { execute: (auctionId: string) => Promise<{ id: string; endTime: Date }> };
      finishRound: { execute: (roundId: string) => Promise<void> };
      placeBid: { execute: (input: { auctionId: string; userId: string; amount: number }) => Promise<{ id: string; amount: number }> };
      creditWallet: { execute: (userId: string, amount: number) => Promise<void> };
      withdrawFunds: { execute: (bidId: string, userId: string) => Promise<void> };
      wallets: { findByUserId: (userId: string) => Promise<{ availableBalance: number; lockedBalance: number } | null> };
      bids: { findByAuction: (auctionId: string) => Promise<Array<{ id: string; status: string; amount: number; userId: string }>> };
      leaderboard: { getTopBids: (auctionId: string, limit: number) => Promise<Array<{ id: string; amount: number }>> };
    };

    beforeAll(async () => {
      const http = await import("node:http");
      const { connectMongo, getCollections } = await import("../../src/infrastructure/db/mongo");
      const {
        MongoAuctionRepository,
        MongoBidRepository,
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
      const { env } = await import("../../src/config/env");

      const server = http.createServer();
      const io = initSocketServer(server, "*");
      const realtime = new SocketPublisher(io);

      const auctions = new MongoAuctionRepository();
      const rounds = new MongoRoundRepository();
      const bids = new MongoBidRepository();
      const users = new MongoUserRepository();
      const wallets = new MongoWalletRepository();
      const tx = new MongoTransactionManager();

      const leaderboard = new RedisLeaderboardCache();
      const lock = new RedisDistributedLock();
      const scheduler = new BullMqRoundScheduler();

      const createAuction = new CreateAuctionUseCase(
        auctions, rounds, scheduler, env.AUCTION_ROUND_DURATION_MS
      );

      const startRound = new StartRoundUseCase(
        auctions, rounds, scheduler, env.AUCTION_ROUND_DURATION_MS
      );

      const placeBid = new PlaceBidUseCase(
        auctions, rounds, bids, wallets, users, tx, leaderboard, scheduler, lock, realtime,
        env.AUCTION_ANTI_SNIPING_THRESHOLD_MS,
        env.AUCTION_ANTI_SNIPING_EXTENSION_MS,
        env.AUCTION_TOP_N,
        env.AUCTION_MIN_BID_STEP_PERCENT
      );

      const finishRound = new FinishRoundUseCase(
        auctions, rounds, bids, wallets, tx, scheduler, leaderboard, realtime,
        env.AUCTION_ROUND_DURATION_MS, env.AUCTION_TOP_N
      );

      const withdrawFunds = new WithdrawFundsUseCase(
        bids, wallets, tx, leaderboard, realtime, env.AUCTION_TOP_N
      );

      const creditWallet = new CreditWalletUseCase(wallets, users, tx);

      deps = {
        connectMongo,
        getCollections,
        createAuction,
        startRound,
        finishRound,
        placeBid,
        creditWallet,
        withdrawFunds,
        wallets,
        bids,
        leaderboard
      };

      // Retry connection with exponential backoff
      let retries = 5;
      let delay = 2000;
      while (retries > 0) {
        try {
          await deps.connectMongo();
          break;
        } catch {
          retries--;
          if (retries === 0) throw new Error("Failed to connect to MongoDB");
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 1.5;
        }
      }
    }, 60000);

    beforeEach(async () => {
      const collections = await deps.getCollections();
      await Promise.all([
        collections.auctions.deleteMany({}),
        collections.rounds.deleteMany({}),
        collections.bids.deleteMany({}),
        collections.wallets.deleteMany({}),
        collections.users.deleteMany({})
      ]);
    });

    afterAll(async () => {
      if (!deps) return;
      const collections = await deps.getCollections();
      await Promise.all([
        collections.auctions.deleteMany({}),
        collections.rounds.deleteMany({}),
        collections.bids.deleteMany({}),
        collections.wallets.deleteMany({}),
        collections.users.deleteMany({})
      ]);
    }, 10000);

    const forceRoundEnd = async (roundId: string) => {
      const collections = await deps.getCollections();
      await collections.rounds.updateOne(
        { _id: new ObjectId(roundId) },
        { $set: { endTime: new Date(Date.now() - 1000) } }
      );
    };

    describe("Complete Auction Lifecycle", () => {
      it("creates auction, places bids, closes round with winners", async () => {
        // 1. Create auction with 2 winners
        const { auction, round } = await deps.createAuction.execute({
          title: "Gift Drop",
          totalItems: 2,
          startNow: true
        });
        expect(round).toBeDefined();

        // 2. Credit wallets for 4 users
        await deps.creditWallet.execute("user-1", 1000);
        await deps.creditWallet.execute("user-2", 1000);
        await deps.creditWallet.execute("user-3", 1000);
        await deps.creditWallet.execute("user-4", 1000);

        // 3. Place bids (ascending to respect min step)
        await deps.placeBid.execute({ auctionId: auction.id, userId: "user-4", amount: 50 });
        await deps.placeBid.execute({ auctionId: auction.id, userId: "user-1", amount: 100 });
        await deps.placeBid.execute({ auctionId: auction.id, userId: "user-3", amount: 150 });
        await deps.placeBid.execute({ auctionId: auction.id, userId: "user-2", amount: 200 });

        // 4. Verify balances after bidding
        const wallet1 = await deps.wallets.findByUserId("user-1");
        expect(wallet1?.availableBalance).toBe(900);
        expect(wallet1?.lockedBalance).toBe(100);

        // 5. Check leaderboard (should be sorted by amount desc)
        const topBids = await deps.leaderboard.getTopBids(auction.id, 10);
        expect(topBids[0].amount).toBe(200); // user-2
        expect(topBids[1].amount).toBe(150); // user-3
        expect(topBids[2].amount).toBe(100); // user-1
        expect(topBids[3].amount).toBe(50);  // user-4

        // 6. Finish round (simulate round end)
        await forceRoundEnd(round!.id);
        await deps.finishRound.execute(round!.id);

        // 7. Verify winners (top 2 by amount: user-2=200, user-3=150)
        const allBids = await deps.bids.findByAuction(auction.id);
        const winnerBids = allBids.filter(b => b.status === "winning");
        const loserBids = allBids.filter(b => b.status === "outbid");

        expect(winnerBids).toHaveLength(2);
        expect(loserBids).toHaveLength(2);

        expect(winnerBids.map(b => b.userId).sort()).toEqual(["user-2", "user-3"]);
        expect(loserBids.map(b => b.userId).sort()).toEqual(["user-1", "user-4"]);

        // 8. Verify winner balances (locked should be 0 - spent)
        const winnerWallet = await deps.wallets.findByUserId("user-2");
        expect(winnerWallet?.lockedBalance).toBe(0);

        // 9. Verify loser balances (locked stays for carry-over)
        const loserWallet = await deps.wallets.findByUserId("user-1");
        expect(loserWallet?.lockedBalance).toBe(100);
      });

      it("handles withdrawal and refund correctly", async () => {
        const { auction, round } = await deps.createAuction.execute({
          title: "Test Auction",
          totalItems: 1,
          startNow: true
        });

        await deps.creditWallet.execute("withdrawer", 500);
        const bid = await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "withdrawer",
          amount: 200
        });

        // Verify locked
        let wallet = await deps.wallets.findByUserId("withdrawer");
        expect(wallet?.availableBalance).toBe(300);
        expect(wallet?.lockedBalance).toBe(200);

        // Withdraw the bid
        await deps.withdrawFunds.execute(bid.id, "withdrawer");

        // Verify refunded
        wallet = await deps.wallets.findByUserId("withdrawer");
        expect(wallet?.availableBalance).toBe(500);
        expect(wallet?.lockedBalance).toBe(0);

        // Bid should be marked as refunded
        const bids = await deps.bids.findByAuction(auction.id);
        expect(bids[0].status).toBe("refunded");
      });

      it("enforces minimum bid step", async () => {
        const { auction } = await deps.createAuction.execute({
          title: "Step Test",
          totalItems: 1,
          startNow: true
        });

        await deps.creditWallet.execute("user-a", 10000);
        await deps.creditWallet.execute("user-b", 10000);

        // First bid
        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "user-a",
          amount: 100
        });

        // Try to bid less than 5% more (should fail)
        await expect(
          deps.placeBid.execute({
            auctionId: auction.id,
            userId: "user-b",
            amount: 102
          })
        ).rejects.toThrow("Bid must be at least 105");

        // Bid exactly 5% more (should succeed)
        const bid = await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "user-b",
          amount: 105
        });
        expect(bid.amount).toBe(105);
      });

      it("handles sequential bids with higher amount winning", async () => {
        const { auction, round } = await deps.createAuction.execute({
          title: "Tiebreaker Test",
          totalItems: 1,
          startNow: true
        });

        await deps.creditWallet.execute("early-user", 1000);
        await deps.creditWallet.execute("late-user", 1000);

        // First user bids 100
        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "early-user",
          amount: 100
        });

        // Wait a bit then second user bids same amount (must be 5% more now)
        await new Promise(resolve => setTimeout(resolve, 50));
        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "late-user",
          amount: 105 // Must be 5% more
        });

        // Finish round - late-user should win (higher amount)
        await forceRoundEnd(round!.id);
        await deps.finishRound.execute(round!.id);

        const bids = await deps.bids.findByAuction(auction.id);
        const winner = bids.find(b => b.status === "winning");
        expect(winner?.userId).toBe("late-user");
      });
    });

    describe("Multi-Round Auction", () => {
      it("carries over losing bids to next round", async () => {
        const { auction, round } = await deps.createAuction.execute({
          title: "Multi-round Test",
          totalItems: 1,
          startNow: true
        });

        await deps.creditWallet.execute("winner-r1", 1000);
        await deps.creditWallet.execute("loser-r1", 1000);

        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "loser-r1",
          amount: 110
        });

        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "winner-r1",
          amount: 200
        });

        // Finish round 1
        await forceRoundEnd(round!.id);
        await deps.finishRound.execute(round!.id);

        // Loser should have outbid status but still locked balance
        const bids = await deps.bids.findByAuction(auction.id);
        const loserBid = bids.find(b => b.userId === "loser-r1");
        expect(loserBid?.status).toBe("outbid");

        const loserWallet = await deps.wallets.findByUserId("loser-r1");
        expect(loserWallet?.lockedBalance).toBe(110); // Still locked for next round
        expect(loserWallet?.availableBalance).toBe(890);
      });
    });

    describe("Balance Integrity", () => {
      it("maintains correct total balance throughout auction lifecycle", async () => {
        const { auction, round } = await deps.createAuction.execute({
          title: "Balance Test",
          totalItems: 1,
          startNow: true
        });

        const INITIAL_BALANCE = 1000;
        await deps.creditWallet.execute("balance-test-user", INITIAL_BALANCE);

        // Place bid
        await deps.placeBid.execute({
          auctionId: auction.id,
          userId: "balance-test-user",
          amount: 300
        });

        let wallet = await deps.wallets.findByUserId("balance-test-user");
        expect(wallet!.availableBalance + wallet!.lockedBalance).toBe(INITIAL_BALANCE);

        // Finish round (user wins)
        await forceRoundEnd(round!.id);
        await deps.finishRound.execute(round!.id);

        wallet = await deps.wallets.findByUserId("balance-test-user");
        // Winner's locked is deducted (spent on winning)
        expect(wallet!.availableBalance).toBe(700);
        expect(wallet!.lockedBalance).toBe(0);
        // Total is now 700 (300 was "spent" on winning the auction)
      });

      it("handles multiple bids from same user correctly", async () => {
        const { auction } = await deps.createAuction.execute({
          title: "Multi-bid Test",
          totalItems: 10, // Many winners possible
          startNow: true
        });

        await deps.creditWallet.execute("multi-bidder", 10000);

        // Place multiple bids
        await deps.placeBid.execute({ auctionId: auction.id, userId: "multi-bidder", amount: 100 });
        await deps.placeBid.execute({ auctionId: auction.id, userId: "multi-bidder", amount: 200 });
        await deps.placeBid.execute({ auctionId: auction.id, userId: "multi-bidder", amount: 300 });

        const wallet = await deps.wallets.findByUserId("multi-bidder");
        expect(wallet?.availableBalance).toBe(10000 - 100 - 200 - 300); // 9400
        expect(wallet?.lockedBalance).toBe(100 + 200 + 300); // 600
      });
    });
  });
}
