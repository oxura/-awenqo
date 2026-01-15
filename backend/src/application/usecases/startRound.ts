import { AppError } from "../errors";
import { AuctionRepository, RoundRepository } from "../ports/repositories";
import { RoundScheduler } from "../ports/services";
import { Round } from "../../domain/entities/round";

export class StartRoundUseCase {
  constructor(
    private readonly auctionRepo: AuctionRepository,
    private readonly roundRepo: RoundRepository,
    private readonly scheduler: RoundScheduler,
    private readonly roundDurationMs: number
  ) {}

  async execute(auctionId: string): Promise<Round> {
    const auction = await this.auctionRepo.findById(auctionId);
    if (!auction) {
      throw new AppError("Auction not found", 404, "AUCTION_NOT_FOUND");
    }
    if (auction.status !== "active") {
      throw new AppError("Auction not active", 409, "AUCTION_NOT_ACTIVE");
    }
    const activeRound = await this.roundRepo.findActiveByAuction(auctionId);
    if (activeRound) {
      const now = new Date();
      if (activeRound.endTime.getTime() <= now.getTime()) {
        await this.scheduler.rescheduleCloseRound(activeRound.id, now);
      }
      return activeRound;
    }
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + this.roundDurationMs);
    const round = await this.roundRepo.create({
      auctionId,
      roundNumber: auction.currentRoundNumber + 1,
      startTime,
      endTime,
      status: "active"
    });
    await this.auctionRepo.update(auctionId, { currentRoundNumber: round.roundNumber });
    await this.scheduler.scheduleCloseRound(round.id, round.endTime);
    return round;
  }
}
