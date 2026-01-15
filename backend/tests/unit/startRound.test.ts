import { describe, it, expect, beforeEach } from "vitest";
import { StartRoundUseCase } from "../../src/application/usecases/startRound";
import {
  createMockStorage,
  createMockAuctionRepository,
  createMockRoundRepository,
  seedAuction,
  seedRound,
  MockStorage
} from "../mocks/repositories";
import { createMockRoundScheduler } from "../mocks/services";

describe("StartRoundUseCase", () => {
  let storage: MockStorage;
  let useCase: StartRoundUseCase;
  let auctionRepo: ReturnType<typeof createMockAuctionRepository>;
  let roundRepo: ReturnType<typeof createMockRoundRepository>;
  let scheduler: ReturnType<typeof createMockRoundScheduler>;

  const ROUND_DURATION_MS = 300000;

  beforeEach(() => {
    storage = createMockStorage();
    auctionRepo = createMockAuctionRepository(storage);
    roundRepo = createMockRoundRepository(storage);
    scheduler = createMockRoundScheduler();

    useCase = new StartRoundUseCase(
      auctionRepo,
      roundRepo,
      scheduler,
      ROUND_DURATION_MS
    );
  });

  describe("starting a new round", () => {
    it("creates new round for auction without active round", async () => {
      const auction = seedAuction(storage, { currentRoundNumber: 0 });

      const round = await useCase.execute(auction.id);

      expect(round).toBeDefined();
      expect(round.roundNumber).toBe(1);
      expect(round.auctionId).toBe(auction.id);
      expect(round.status).toBe("active");
    });

    it("schedules round close", async () => {
      const auction = seedAuction(storage);

      const round = await useCase.execute(auction.id);

      expect(scheduler.scheduleCloseRound).toHaveBeenCalledWith(
        round.id,
        round.endTime
      );
    });

    it("updates auction currentRoundNumber", async () => {
      const auction = seedAuction(storage, { currentRoundNumber: 2 });

      await useCase.execute(auction.id);

      const updated = storage.auctions.get(auction.id);
      expect(updated?.currentRoundNumber).toBe(3);
    });
  });

  describe("existing active round", () => {
    it("returns existing active round instead of creating new", async () => {
      const auction = seedAuction(storage);
      const existingRound = seedRound(storage, auction.id, { status: "active" });

      const round = await useCase.execute(auction.id);

      expect(round.id).toBe(existingRound.id);
      expect(roundRepo.create).not.toHaveBeenCalled();
    });

    it("reschedules close when active round is already expired", async () => {
      const auction = seedAuction(storage);
      const pastEndTime = new Date(Date.now() - 1000);
      const existingRound = seedRound(storage, auction.id, {
        status: "active",
        endTime: pastEndTime
      });

      const round = await useCase.execute(auction.id);

      expect(round.id).toBe(existingRound.id);
      expect(scheduler.rescheduleCloseRound).toHaveBeenCalledWith(existingRound.id, expect.any(Date));
    });
  });

  describe("validation errors", () => {
    it("throws error for non-existent auction", async () => {
      await expect(
        useCase.execute("non-existent")
      ).rejects.toThrow("Auction not found");
    });

    it("throws error for inactive auction", async () => {
      const auction = seedAuction(storage, { status: "finished" });

      await expect(
        useCase.execute(auction.id)
      ).rejects.toThrow("Auction not active");
    });
  });
});
