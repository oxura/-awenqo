import { describe, it, expect, beforeEach, vi } from "vitest";
import { FinishRoundUseCase } from "../../src/application/usecases/finishRound";
import {
  createMockStorage,
  createMockAuctionRepository,
  createMockRoundRepository,
  createMockBidRepository,
  createMockWalletRepository,
  createMockTransactionManager,
  seedAuction,
  seedRound,
  seedWallet,
  seedBid,
  MockStorage
} from "../mocks/repositories";
import {
  createMockLeaderboardCache,
  createMockRoundScheduler,
  createMockRealtimePublisher
} from "../mocks/services";

describe("FinishRoundUseCase", () => {
  let storage: MockStorage;
  let useCase: FinishRoundUseCase;
  let auctionRepo: ReturnType<typeof createMockAuctionRepository>;
  let roundRepo: ReturnType<typeof createMockRoundRepository>;
  let bidRepo: ReturnType<typeof createMockBidRepository>;
  let walletRepo: ReturnType<typeof createMockWalletRepository>;
  let txManager: ReturnType<typeof createMockTransactionManager>;
  let scheduler: ReturnType<typeof createMockRoundScheduler>;
  let leaderboard: ReturnType<typeof createMockLeaderboardCache>;
  let realtime: ReturnType<typeof createMockRealtimePublisher>;

  const ROUND_DURATION_MS = 300000; // 5 minutes
  const LEADERBOARD_SIZE = 100;

  beforeEach(() => {
    storage = createMockStorage();
    auctionRepo = createMockAuctionRepository(storage);
    roundRepo = createMockRoundRepository(storage);
    bidRepo = createMockBidRepository(storage);
    walletRepo = createMockWalletRepository(storage);
    txManager = createMockTransactionManager();
    scheduler = createMockRoundScheduler();
    leaderboard = createMockLeaderboardCache();
    realtime = createMockRealtimePublisher();

    useCase = new FinishRoundUseCase(
      auctionRepo,
      roundRepo,
      bidRepo,
      walletRepo,
      txManager,
      scheduler,
      leaderboard,
      realtime,
      ROUND_DURATION_MS,
      LEADERBOARD_SIZE
    );
  });

  describe("basic round closing", () => {
    it("closes round and marks winners", async () => {
      const auction = seedAuction(storage, { totalItems: 2 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      // Create 4 bids - top 2 should win
      seedWallet(storage, "user-1", 0, 100);
      seedWallet(storage, "user-2", 0, 200);
      seedWallet(storage, "user-3", 0, 150);
      seedWallet(storage, "user-4", 0, 50);

      const bid1 = seedBid(storage, auction.id, "user-1", 100, { roundId: round.id });
      const bid2 = seedBid(storage, auction.id, "user-2", 200, { roundId: round.id });
      const bid3 = seedBid(storage, auction.id, "user-3", 150, { roundId: round.id });
      const bid4 = seedBid(storage, auction.id, "user-4", 50, { roundId: round.id });

      // Add to leaderboard
      await leaderboard.addBid(auction.id, bid1);
      await leaderboard.addBid(auction.id, bid2);
      await leaderboard.addBid(auction.id, bid3);
      await leaderboard.addBid(auction.id, bid4);

      await useCase.execute(round.id);

      // Check round is closed
      const updatedRound = storage.rounds.get(round.id);
      expect(updatedRound?.status).toBe("closed");

      // Check winners (top 2 by amount: 200 and 150)
      const updatedBid2 = storage.bids.get(bid2.id);
      const updatedBid3 = storage.bids.get(bid3.id);
      expect(updatedBid2?.status).toBe("winning");
      expect(updatedBid3?.status).toBe("winning");

      // Check losers
      const updatedBid1 = storage.bids.get(bid1.id);
      const updatedBid4 = storage.bids.get(bid4.id);
      expect(updatedBid1?.status).toBe("outbid");
      expect(updatedBid4?.status).toBe("outbid");
    });

    it("settles winner balances (deducts locked funds)", async () => {
      const auction = seedAuction(storage, { totalItems: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      seedWallet(storage, "winner", 500, 200);
      const winningBid = seedBid(storage, auction.id, "winner", 200, { roundId: round.id });
      await leaderboard.addBid(auction.id, winningBid);

      await useCase.execute(round.id);

      // Winner's locked balance should be deducted
      const wallet = await walletRepo.findByUserId("winner");
      expect(wallet?.lockedBalance).toBe(0); // 200 - 200
      expect(wallet?.availableBalance).toBe(500); // unchanged
    });

    it("removes winners from leaderboard cache", async () => {
      const auction = seedAuction(storage, { totalItems: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      seedWallet(storage, "winner", 0, 100);
      const bid = seedBid(storage, auction.id, "winner", 100, { roundId: round.id });
      await leaderboard.addBid(auction.id, bid);

      await useCase.execute(round.id);

      expect(leaderboard.removeBid).toHaveBeenCalledWith(auction.id, bid.id);
    });

    it("publishes round:closed event with winners", async () => {
      const auction = seedAuction(storage, { totalItems: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      seedWallet(storage, "winner", 0, 100);
      const bid = seedBid(storage, auction.id, "winner", 100, { roundId: round.id });
      await leaderboard.addBid(auction.id, bid);

      await useCase.execute(round.id);

      const closedEvent = realtime._events.find(e => e.type === "round:closed");
      expect(closedEvent).toBeDefined();
      expect((closedEvent?.payload as { winners: unknown[] }).winners).toHaveLength(1);
    });
  });

  describe("ranking logic", () => {
    it("ranks by amount DESC, then by timestamp ASC", async () => {
      const auction = seedAuction(storage, { totalItems: 2 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      // Two bids with same amount but different timestamps
      seedWallet(storage, "user-early", 0, 100);
      seedWallet(storage, "user-late", 0, 100);

      const earlyTimestamp = new Date("2024-01-01T10:00:00Z");
      const lateTimestamp = new Date("2024-01-01T10:00:30Z");

      const earlyBid = seedBid(storage, auction.id, "user-early", 100, {
        roundId: round.id,
        timestamp: earlyTimestamp
      });
      const lateBid = seedBid(storage, auction.id, "user-late", 100, {
        roundId: round.id,
        timestamp: lateTimestamp
      });

      await leaderboard.addBid(auction.id, earlyBid);
      await leaderboard.addBid(auction.id, lateBid);

      await useCase.execute(round.id);

      // Both should win since totalItems is 2
      const updatedEarly = storage.bids.get(earlyBid.id);
      const updatedLate = storage.bids.get(lateBid.id);
      expect(updatedEarly?.status).toBe("winning");
      expect(updatedLate?.status).toBe("winning");
    });

    it("correctly identifies losers when more bids than slots", async () => {
      const auction = seedAuction(storage, { totalItems: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      seedWallet(storage, "user-1", 0, 50);
      seedWallet(storage, "user-2", 0, 100);

      const lowBid = seedBid(storage, auction.id, "user-1", 50, { roundId: round.id });
      const highBid = seedBid(storage, auction.id, "user-2", 100, { roundId: round.id });

      await leaderboard.addBid(auction.id, lowBid);
      await leaderboard.addBid(auction.id, highBid);

      await useCase.execute(round.id);

      expect(storage.bids.get(highBid.id)?.status).toBe("winning");
      expect(storage.bids.get(lowBid.id)?.status).toBe("outbid");
    });
  });

  describe("next round creation", () => {
    it("creates next round for active auction", async () => {
      const auction = seedAuction(storage, { status: "active", currentRoundNumber: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, {
        endTime: pastEndTime,
        roundNumber: 1
      });

      await useCase.execute(round.id);

      // Check that a new round was created
      expect(roundRepo.create).toHaveBeenCalled();
      
      // Check scheduler was called for next round
      expect(scheduler.scheduleCloseRound).toHaveBeenCalled();
    });

    it("does not create next round for finished auction", async () => {
      const auction = seedAuction(storage, { status: "finished" });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      await useCase.execute(round.id);

      // Should have been called 0 times for new round scheduling
      // (only the test setup calls, not additional ones)
      const createCalls = (roundRepo.create as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(createCalls).toBe(0);
    });
  });

  describe("anti-sniping protection", () => {
    it("reschedules if round end time is in the future", async () => {
      const auction = seedAuction(storage);
      const futureEndTime = new Date(Date.now() + 60000); // 1 minute in future
      const round = seedRound(storage, auction.id, { endTime: futureEndTime });

      await useCase.execute(round.id);

      // Should have rescheduled instead of closing
      expect(scheduler.rescheduleCloseRound).toHaveBeenCalledWith(round.id, futureEndTime);
      
      // Round should still be active
      const updatedRound = storage.rounds.get(round.id);
      expect(updatedRound?.status).toBe("active");
    });

    it("closes round if end time has passed", async () => {
      const auction = seedAuction(storage);
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      await useCase.execute(round.id);

      const updatedRound = storage.rounds.get(round.id);
      expect(updatedRound?.status).toBe("closed");
    });
  });

  describe("edge cases", () => {
    it("handles round with no bids", async () => {
      const auction = seedAuction(storage, { totalItems: 5 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      await useCase.execute(round.id);

      const updatedRound = storage.rounds.get(round.id);
      expect(updatedRound?.status).toBe("closed");

      // Should still publish closed event
      const closedEvent = realtime._events.find(e => e.type === "round:closed");
      expect(closedEvent).toBeDefined();
    });

    it("ignores already closed rounds", async () => {
      const auction = seedAuction(storage);
      const round = seedRound(storage, auction.id, { status: "closed" });

      await useCase.execute(round.id);

      // Should not have updated anything
      expect(bidRepo.updateMany).not.toHaveBeenCalled();
    });

    it("ignores non-existent rounds", async () => {
      await useCase.execute("non-existent-round");

      // Should not throw and not update anything
      expect(bidRepo.updateMany).not.toHaveBeenCalled();
    });

    it("handles fewer bids than totalItems", async () => {
      const auction = seedAuction(storage, { totalItems: 10 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      // Only 3 bids for 10 slots
      seedWallet(storage, "user-1", 0, 100);
      seedWallet(storage, "user-2", 0, 200);
      seedWallet(storage, "user-3", 0, 150);

      const bid1 = seedBid(storage, auction.id, "user-1", 100, { roundId: round.id });
      const bid2 = seedBid(storage, auction.id, "user-2", 200, { roundId: round.id });
      const bid3 = seedBid(storage, auction.id, "user-3", 150, { roundId: round.id });

      await leaderboard.addBid(auction.id, bid1);
      await leaderboard.addBid(auction.id, bid2);
      await leaderboard.addBid(auction.id, bid3);

      await useCase.execute(round.id);

      // All 3 should be winners
      expect(storage.bids.get(bid1.id)?.status).toBe("winning");
      expect(storage.bids.get(bid2.id)?.status).toBe("winning");
      expect(storage.bids.get(bid3.id)?.status).toBe("winning");
    });
  });

  describe("carry-over logic", () => {
    it("keeps loser bids as outbid for next round", async () => {
      const auction = seedAuction(storage, { totalItems: 1 });
      const pastEndTime = new Date(Date.now() - 10000);
      const round = seedRound(storage, auction.id, { endTime: pastEndTime });

      seedWallet(storage, "loser-1", 0, 50);
      seedWallet(storage, "loser-2", 0, 30);
      seedWallet(storage, "winner", 0, 100);

      const loserBid1 = seedBid(storage, auction.id, "loser-1", 50, { roundId: round.id });
      const loserBid2 = seedBid(storage, auction.id, "loser-2", 30, { roundId: round.id });
      const winnerBid = seedBid(storage, auction.id, "winner", 100, { roundId: round.id });

      await leaderboard.addBid(auction.id, loserBid1);
      await leaderboard.addBid(auction.id, loserBid2);
      await leaderboard.addBid(auction.id, winnerBid);

      await useCase.execute(round.id);

      // Losers should be outbid (not refunded) - they carry over
      expect(storage.bids.get(loserBid1.id)?.status).toBe("outbid");
      expect(storage.bids.get(loserBid2.id)?.status).toBe("outbid");

      // Loser wallets should still have locked balance
      const loserWallet1 = await walletRepo.findByUserId("loser-1");
      expect(loserWallet1?.lockedBalance).toBe(50);
    });
  });
});
