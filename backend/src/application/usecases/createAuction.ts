import { AuctionRepository, RoundRepository } from "../ports/repositories";
import { RoundScheduler } from "../ports/services";
import { AppError } from "../errors";
import { Auction } from "../../domain/entities/auction";
import { Round } from "../../domain/entities/round";

export type CreateAuctionInput = {
  title: string;
  totalItems: number;
  startNow?: boolean;
};

export class CreateAuctionUseCase {
  constructor(
    private readonly auctionRepo: AuctionRepository,
    private readonly roundRepo: RoundRepository,
    private readonly scheduler: RoundScheduler,
    private readonly roundDurationMs: number
  ) {}

  async execute(input: CreateAuctionInput): Promise<{ auction: Auction; round?: Round }> {
    if (input.totalItems <= 0) {
      throw new AppError("totalItems must be positive", 400, "INVALID_TOTAL_ITEMS");
    }

    const auction = await this.auctionRepo.create({
      title: input.title,
      totalItems: input.totalItems,
      status: "active",
      currentRoundNumber: 0
    });

    if (!input.startNow) {
      return { auction };
    }

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + this.roundDurationMs);
    const round = await this.roundRepo.create({
      auctionId: auction.id,
      roundNumber: 1,
      startTime,
      endTime,
      status: "active"
    });
    await this.auctionRepo.update(auction.id, { currentRoundNumber: 1 });
    await this.scheduler.scheduleCloseRound(round.id, round.endTime);

    return { auction, round };
  }
}
