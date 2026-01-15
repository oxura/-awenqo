import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlaceBidUseCase } from "../../src/application/usecases/placeBid";
import { AppError } from "../../src/application/errors";
import {
  createMockStorage,
  createMockAuctionRepository,
  createMockRoundRepository,
  createMockBidRepository,
  createMockWalletRepository,
  createMockUserRepository,
  createMockTransactionManager,
  seedAuction,
  seedRound,
  seedWallet,
  seedUser,
  seedBid,
  MockStorage
} from "../mocks/repositories";
import {
  createMockLeaderboardCache,
  createMockRoundScheduler,
  createMockDistributedLock,
  createMockRealtimePublisher
} from "../mocks/services";

describe("PlaceBidUseCase", () => {
  let storage: MockStorage;
  let useCase: PlaceBidUseCase;
  let auctionRepo: ReturnType<typeof createMockAuctionRepository>;
  let roundRepo: ReturnType<typeof createMockRoundRepository>;
  let bidRepo: ReturnType<typeof createMockBidRepository>;
  let walletRepo: ReturnType<typeof createMockWalletRepository>;
  let userRepo: ReturnType<typeof createMockUserRepository>;
  let txManager: ReturnType<typeof createMockTransactionManager>;
  let leaderboard: ReturnType<typeof createMockLeaderboardCache>;
  let scheduler: ReturnType<typeof createMockRoundScheduler>;
  let lock: ReturnType<typeof createMockDistributedLock>;
  let realtime: ReturnType<typeof createMockRealtimePublisher>;

  const THRESHOLD_MS = 60000; // 60 seconds
  const EXTENSION_MS = 120000; // 2 minutes
  const LEADERBOARD_SIZE = 100;
  const MIN_STEP_PERCENT = 5;

  beforeEach(() => {
    storage = createMockStorage();
    auctionRepo = createMockAuctionRepository(storage);
    roundRepo = createMockRoundRepository(storage);
    bidRepo = createMockBidRepository(storage);
    walletRepo = createMockWalletRepository(storage);
    userRepo = createMockUserRepository(storage);
    txManager = createMockTransactionManager();
    leaderboard = createMockLeaderboardCache();
    scheduler = createMockRoundScheduler();
    lock = createMockDistributedLock();
    realtime = createMockRealtimePublisher();

    useCase = new PlaceBidUseCase(
      auctionRepo,
      roundRepo,
      bidRepo,
      walletRepo,
      userRepo,
      txManager,
      leaderboard,
      scheduler,
      lock,
      realtime,
      THRESHOLD_MS,
      EXTENSION_MS,
      LEADERBOARD_SIZE,
      MIN_STEP_PERCENT
    );
  });

  describe("successful bid placement", () => {
    it("creates a bid and locks funds", async () => {
      const auction = seedAuction(storage, { status: "active" });
      const round = seedRound(storage, auction.id, { status: "active" });
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      const bid = await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 200
      });

      expect(bid).toBeDefined();
      expect(bid.amount).toBe(200);
      expect(bid.userId).toBe("user-1");
      expect(bid.auctionId).toBe(auction.id);
      expect(bid.roundId).toBe(round.id);
      expect(bid.status).toBe("active");

      // Check wallet was updated
      const wallet = await walletRepo.findByUserId("user-1");
      expect(wallet?.availableBalance).toBe(800);
      expect(wallet?.lockedBalance).toBe(200);
    });

    it("adds bid to leaderboard cache", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      const bid = await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 200
      });

      expect(leaderboard.addBid).toHaveBeenCalledWith(auction.id, expect.objectContaining({
        id: bid.id,
        amount: 200
      }));
    });

    it("publishes leaderboard update event", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 200
      });

      expect(realtime.publish).toHaveBeenCalledWith(expect.objectContaining({
        type: "leaderboard:update",
        auctionId: auction.id
      }));
    });

    it("creates user and wallet if they do not exist", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      // Manually seed wallet with balance but no user
      seedWallet(storage, "new-user", 500);

      const bid = await useCase.execute({
        auctionId: auction.id,
        userId: "new-user",
        amount: 100
      });

      expect(bid).toBeDefined();
      expect(userRepo.createIfMissing).toHaveBeenCalled();
      expect(walletRepo.createIfMissing).toHaveBeenCalled();
    });
  });

  describe("validation errors", () => {
    it("throws error for non-positive amount", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 0 })
      ).rejects.toThrow(AppError);

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: -100 })
      ).rejects.toThrow("Bid amount must be positive");
    });

    it("throws error for non-existent auction", async () => {
      await expect(
        useCase.execute({ auctionId: "non-existent", userId: "user-1", amount: 100 })
      ).rejects.toThrow("Auction not active");
    });

    it("throws error for inactive auction", async () => {
      const auction = seedAuction(storage, { status: "finished" });

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 100 })
      ).rejects.toThrow("Auction not active");
    });

    it("throws error when no active round exists", async () => {
      const auction = seedAuction(storage);
      // No round seeded

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 100 })
      ).rejects.toThrow("No active round");
    });

    it("throws error when round has ended", async () => {
      const auction = seedAuction(storage);
      const pastEndTime = new Date(Date.now() - 10000); // 10 seconds ago
      seedRound(storage, auction.id, { endTime: pastEndTime });

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 100 })
      ).rejects.toThrow("Round already ended");
    });

    it("throws error for insufficient funds", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 50); // Only 50 available

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 100 })
      ).rejects.toThrow("Insufficient funds");
    });
  });

  describe("minimum bid step validation", () => {
    it("rejects bid lower than min step above top bid", async () => {
      const auction = seedAuction(storage);
      const round = seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 10000);

      // Place first bid
      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      // Second user tries to bid less than 5% more (105 required, trying 102)
      seedUser(storage, "user-2");
      seedWallet(storage, "user-2", 10000);

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-2", amount: 102 })
      ).rejects.toThrow("Bid must be at least 105");
    });

    it("hydrates leaderboard from storage when cache is empty", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 10000);
      seedUser(storage, "user-2");
      seedWallet(storage, "user-2", 10000);

      const topBid = seedBid(storage, auction.id, "user-1", 100, { status: "active" });
      seedBid(storage, auction.id, "user-2", 90, { status: "outbid" });

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-2", amount: 102 })
      ).rejects.toThrow("Bid must be at least 105");

      expect(leaderboard.addBid).toHaveBeenCalledWith(
        auction.id,
        expect.objectContaining({ id: topBid.id })
      );
    });

    it("accepts bid at exactly min step", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 10000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      seedUser(storage, "user-2");
      seedWallet(storage, "user-2", 10000);

      const bid = await useCase.execute({
        auctionId: auction.id,
        userId: "user-2",
        amount: 105 // Exactly 5% more
      });

      expect(bid.amount).toBe(105);
    });

    it("accepts bid above min step", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 10000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      seedUser(storage, "user-2");
      seedWallet(storage, "user-2", 10000);

      const bid = await useCase.execute({
        auctionId: auction.id,
        userId: "user-2",
        amount: 200 // Well above 5%
      });

      expect(bid.amount).toBe(200);
    });
  });

  describe("anti-sniping mechanism", () => {
    it("extends round when bid is within threshold", async () => {
      const auction = seedAuction(storage);
      const endTime = new Date(Date.now() + 30000); // 30 seconds from now (within 60s threshold)
      const round = seedRound(storage, auction.id, { endTime });
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      // Check that round was rescheduled
      expect(scheduler.rescheduleCloseRound).toHaveBeenCalled();
      
      // Check realtime event was published
      expect(realtime.publish).toHaveBeenCalledWith(expect.objectContaining({
        type: "round:extended",
        auctionId: auction.id,
        roundId: round.id
      }));
    });

    it("does not extend round when bid is outside threshold", async () => {
      const auction = seedAuction(storage);
      const endTime = new Date(Date.now() + 120000); // 2 minutes from now (outside 60s threshold)
      seedRound(storage, auction.id, { endTime });
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      // Should not have extended event
      const extendedEvents = realtime._events.filter(e => e.type === "round:extended");
      expect(extendedEvents).toHaveLength(0);
    });

    it("uses distributed lock for anti-sniping check", async () => {
      const auction = seedAuction(storage);
      const endTime = new Date(Date.now() + 30000);
      const round = seedRound(storage, auction.id, { endTime });
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      expect(lock.withLock).toHaveBeenCalledWith(
        `lock:auction:${auction.id}:round:${round.id}`,
        2000,
        expect.any(Function)
      );
    });
  });

  describe("transaction handling", () => {
    it("uses transaction manager for bid creation", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      expect(txManager.withTransaction).toHaveBeenCalled();
    });

    it("rolls back on wallet update failure", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);

      // Make wallet update fail
      walletRepo.updateBalances = vi.fn().mockRejectedValue(new Error("DB Error"));

      await expect(
        useCase.execute({ auctionId: auction.id, userId: "user-1", amount: 100 })
      ).rejects.toThrow("DB Error");

      // Bid should not have been created
      const bids = await bidRepo.findByAuction(auction.id);
      expect(bids).toHaveLength(0);
    });
  });

  describe("concurrent bidding scenarios", () => {
    it("handles multiple sequential bids from same user", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);
      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 10000);

      const bid1 = await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      const bid2 = await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 200
      });

      expect(bid1.amount).toBe(100);
      expect(bid2.amount).toBe(200);

      const wallet = await walletRepo.findByUserId("user-1");
      expect(wallet?.availableBalance).toBe(9700); // 10000 - 100 - 200
      expect(wallet?.lockedBalance).toBe(300); // 100 + 200
    });

    it("handles bids from multiple users", async () => {
      const auction = seedAuction(storage);
      seedRound(storage, auction.id);

      seedUser(storage, "user-1");
      seedWallet(storage, "user-1", 1000);
      seedUser(storage, "user-2");
      seedWallet(storage, "user-2", 1000);
      seedUser(storage, "user-3");
      seedWallet(storage, "user-3", 1000);

      const bid1 = await useCase.execute({
        auctionId: auction.id,
        userId: "user-1",
        amount: 100
      });

      const bid2 = await useCase.execute({
        auctionId: auction.id,
        userId: "user-2",
        amount: 200
      });

      const bid3 = await useCase.execute({
        auctionId: auction.id,
        userId: "user-3",
        amount: 300
      });

      const allBids = await bidRepo.findByAuction(auction.id);
      expect(allBids).toHaveLength(3);
      
      const topBids = await leaderboard.getTopBids(auction.id, 10);
      expect(topBids[0].amount).toBe(300); // Highest first
      expect(topBids[1].amount).toBe(200);
      expect(topBids[2].amount).toBe(100);
    });
  });
});
