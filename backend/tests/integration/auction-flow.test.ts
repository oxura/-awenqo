import { describe, it, expect, beforeAll, afterAll } from "vitest";

const shouldRun = process.env.RUN_INTEGRATION_TESTS === "true";

if (!shouldRun) {
  describe.skip("auction flow", () => {
    it("skipped", () => { });
  });
} else {
  describe("auction flow", () => {
    let deps: any;

    // MongoDB replica set can take time to initialize
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
      const { CreateAuctionUseCase } = await import("../../src/application/usecases/createAuction");
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
        auctions,
        rounds,
        scheduler,
        env.AUCTION_ROUND_DURATION_MS
      );
      const placeBid = new PlaceBidUseCase(
        auctions,
        rounds,
        bids,
        wallets,
        users,
        tx,
        leaderboard,
        scheduler,
        lock,
        realtime,
        env.AUCTION_ANTI_SNIPING_THRESHOLD_MS,
        env.AUCTION_ANTI_SNIPING_EXTENSION_MS,
        env.AUCTION_TOP_N,
        env.AUCTION_MIN_BID_STEP_PERCENT
      );
      const creditWallet = new CreditWalletUseCase(wallets, users, tx);

      deps = {
        connectMongo,
        getCollections,
        auctions,
        rounds,
        bids,
        users,
        wallets,
        createAuction,
        placeBid,
        creditWallet
      };

      // Retry connection with exponential backoff for replica set initialization
      let retries = 5;
      let delay = 2000;
      while (retries > 0) {
        try {
          await deps.connectMongo();
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.log(`MongoDB connection failed, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 1.5;
        }
      }

      const {
        auctions: auctionCol,
        rounds: roundCol,
        bids: bidCol,
        wallets: walletCol,
        users: userCol
      } = await deps.getCollections();

      await Promise.all([
        auctionCol.deleteMany({}),
        roundCol.deleteMany({}),
        bidCol.deleteMany({}),
        walletCol.deleteMany({}),
        userCol.deleteMany({})
      ]);
    }, 30000); // 30s timeout for beforeAll

    afterAll(async () => {
      if (!deps) {
        return;
      }
      const {
        auctions: auctionCol,
        rounds: roundCol,
        bids: bidCol,
        wallets: walletCol,
        users: userCol
      } = await deps.getCollections();
      await Promise.all([
        auctionCol.deleteMany({}),
        roundCol.deleteMany({}),
        bidCol.deleteMany({}),
        walletCol.deleteMany({}),
        userCol.deleteMany({})
      ]);
    }, 10000);

    it("places bid and locks funds", async () => {
      const { auction, round } = await deps.createAuction.execute({
        title: "Test Auction",
        totalItems: 2,
        startNow: true
      });

      expect(round).toBeDefined();

      await deps.creditWallet.execute("user-1", 1000);
      const bid = await deps.placeBid.execute({ auctionId: auction.id, userId: "user-1", amount: 200 });

      const wallet = await deps.wallets.findByUserId("user-1");
      expect(wallet?.availableBalance).toBe(800);
      expect(wallet?.lockedBalance).toBe(200);
      expect(bid.amount).toBe(200);
    });
  });
}
