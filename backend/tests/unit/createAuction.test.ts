import { describe, it, expect, beforeEach } from "vitest";
import { CreateAuctionUseCase } from "../../src/application/usecases/createAuction";
import {
  createMockStorage,
  createMockAuctionRepository,
  createMockRoundRepository,
  MockStorage
} from "../mocks/repositories";
import { createMockRoundScheduler } from "../mocks/services";

describe("CreateAuctionUseCase", () => {
  let storage: MockStorage;
  let useCase: CreateAuctionUseCase;
  let auctionRepo: ReturnType<typeof createMockAuctionRepository>;
  let roundRepo: ReturnType<typeof createMockRoundRepository>;
  let scheduler: ReturnType<typeof createMockRoundScheduler>;

  const ROUND_DURATION_MS = 300000; // 5 minutes

  beforeEach(() => {
    storage = createMockStorage();
    auctionRepo = createMockAuctionRepository(storage);
    roundRepo = createMockRoundRepository(storage);
    scheduler = createMockRoundScheduler();

    useCase = new CreateAuctionUseCase(
      auctionRepo,
      roundRepo,
      scheduler,
      ROUND_DURATION_MS
    );
  });

  describe("basic auction creation", () => {
    it("creates auction without starting", async () => {
      const result = await useCase.execute({
        title: "Test Auction",
        totalItems: 10
      });

      expect(result.auction).toBeDefined();
      expect(result.auction.title).toBe("Test Auction");
      expect(result.auction.totalItems).toBe(10);
      expect(result.auction.status).toBe("active");
      expect(result.auction.currentRoundNumber).toBe(0);
      expect(result.round).toBeUndefined();
    });

    it("creates auction and starts first round with startNow", async () => {
      const result = await useCase.execute({
        title: "Test Auction",
        totalItems: 5,
        startNow: true
      });

      expect(result.auction).toBeDefined();
      expect(result.round).toBeDefined();
      expect(result.round?.roundNumber).toBe(1);
      expect(result.round?.status).toBe("active");
      expect(result.auction.currentRoundNumber).toBe(1);
    });

    it("schedules round close when starting immediately", async () => {
      const result = await useCase.execute({
        title: "Test Auction",
        totalItems: 5,
        startNow: true
      });

      expect(scheduler.scheduleCloseRound).toHaveBeenCalledWith(
        result.round?.id,
        expect.any(Date)
      );
    });

    it("round end time is correct duration from start", async () => {
      const before = Date.now();
      const result = await useCase.execute({
        title: "Test Auction",
        totalItems: 5,
        startNow: true
      });
      const after = Date.now();

      const roundEndTime = result.round!.endTime.getTime();
      const roundStartTime = result.round!.startTime.getTime();

      expect(roundEndTime - roundStartTime).toBe(ROUND_DURATION_MS);
      expect(roundStartTime).toBeGreaterThanOrEqual(before);
      expect(roundStartTime).toBeLessThanOrEqual(after);
    });
  });

  describe("validation errors", () => {
    it("throws error for non-positive totalItems", async () => {
      await expect(
        useCase.execute({ title: "Test", totalItems: 0 })
      ).rejects.toThrow("totalItems must be positive");

      await expect(
        useCase.execute({ title: "Test", totalItems: -5 })
      ).rejects.toThrow("totalItems must be positive");
    });
  });

  describe("persistence", () => {
    it("stores auction in repository", async () => {
      const result = await useCase.execute({
        title: "Persisted Auction",
        totalItems: 3
      });

      expect(auctionRepo.create).toHaveBeenCalled();
      
      const stored = storage.auctions.get(result.auction.id);
      expect(stored).toBeDefined();
      expect(stored?.title).toBe("Persisted Auction");
    });

    it("stores round in repository when starting", async () => {
      const result = await useCase.execute({
        title: "Test",
        totalItems: 3,
        startNow: true
      });

      expect(roundRepo.create).toHaveBeenCalled();
      
      const stored = storage.rounds.get(result.round!.id);
      expect(stored).toBeDefined();
      expect(stored?.auctionId).toBe(result.auction.id);
    });
  });
});
