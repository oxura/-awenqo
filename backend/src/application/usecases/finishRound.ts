import { AppError } from "../errors";
import { rankBids } from "../../domain/services/ranking";
import {
  AuctionRepository,
  BidRepository,
  RoundRepository,
  TransactionManager,
  WalletRepository
} from "../ports/repositories";
import { LeaderboardCache, RealtimePublisher, RoundScheduler } from "../ports/services";
import { Round } from "../../domain/entities/round";
import { Bid } from "../../domain/entities/bid";

export class FinishRoundUseCase {
  constructor(
    private readonly auctionRepo: AuctionRepository,
    private readonly roundRepo: RoundRepository,
    private readonly bidRepo: BidRepository,
    private readonly walletRepo: WalletRepository,
    private readonly tx: TransactionManager,
    private readonly scheduler: RoundScheduler,
    private readonly leaderboard: LeaderboardCache,
    private readonly realtime: RealtimePublisher,
    private readonly roundDurationMs: number,
    private readonly leaderboardSize: number
  ) { }

  async execute(roundId: string): Promise<void> {
    const round = await this.roundRepo.findById(roundId);
    if (!round || round.status !== "active") {
      return;
    }

    // CRITICAL FIX: Check if round time has actually passed
    // This prevents premature close from stale BullMQ jobs after anti-sniping extensions
    const now = new Date();
    if (now.getTime() < round.endTime.getTime()) {
      // Round was extended via anti-sniping, reschedule and exit
      await this.scheduler.rescheduleCloseRound(round.id, round.endTime);
      return;
    }

    const auction = await this.auctionRepo.findById(round.auctionId);
    if (!auction) {
      throw new AppError("Auction not found", 404, "AUCTION_NOT_FOUND");
    }

    let winnerBids: Bid[] = [];
    let loserBids: Bid[] = [];

    await this.tx.withTransaction(async () => {
      const bids = await this.bidRepo.findActiveByAuction(round.auctionId);
      const ranked = rankBids(bids);

      // Get all winners, not limited by leaderboardSize
      winnerBids = ranked.slice(0, auction.totalItems);
      loserBids = ranked.slice(auction.totalItems);

      const winnerIds = winnerBids.map((bid) => bid.id);
      const loserIds = loserBids.map((bid) => bid.id);

      // Mark winners as "winning" and settle their locked balance
      await this.bidRepo.updateMany(winnerIds, { status: "winning" });

      // CRITICAL FIX: Settle winner balances - deduct locked funds (they "spent" their bid)
      for (const bid of winnerBids) {
        await this.walletRepo.updateBalances(bid.userId, 0, -bid.amount);
      }

      // Losers stay active for next round (their bids carry over)
      // They keep status "active" until they win or withdraw
      await this.bidRepo.updateMany(loserIds, { status: "outbid" });

      await this.roundRepo.update(round.id, { status: "closed" });
      await this.auctionRepo.update(auction.id, { currentRoundNumber: round.roundNumber });
    });

    // CRITICAL FIX: Remove winners from leaderboard cache
    for (const bid of winnerBids) {
      await this.leaderboard.removeBid(round.auctionId, bid.id);
    }

    // Broadcast updated leaderboard
    const topBids = await this.leaderboard.getTopBids(round.auctionId, this.leaderboardSize);
    this.realtime.publish({ type: "leaderboard:update", auctionId: round.auctionId, bids: topBids });

    // Broadcast round closed with all winners (not limited by cache size)
    this.realtime.publish({
      type: "round:closed",
      auctionId: round.auctionId,
      roundId: round.id,
      winners: winnerBids
    });

    if (auction.status === "active") {
      const nextRound = await this.createNextRound(round);
      await this.scheduler.scheduleCloseRound(nextRound.id, nextRound.endTime);
    }
  }

  private async createNextRound(previous: Round): Promise<Round> {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + this.roundDurationMs);
    const nextRound = await this.roundRepo.create({
      auctionId: previous.auctionId,
      roundNumber: previous.roundNumber + 1,
      startTime,
      endTime,
      status: "active"
    });
    await this.auctionRepo.update(previous.auctionId, { currentRoundNumber: nextRound.roundNumber });
    return nextRound;
  }
}
