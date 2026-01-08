import { AppError } from "../errors";
import { BidRepository, TransactionManager, WalletRepository } from "../ports/repositories";
import { LeaderboardCache, RealtimePublisher } from "../ports/services";

export class WithdrawFundsUseCase {
  constructor(
    private readonly bidRepo: BidRepository,
    private readonly walletRepo: WalletRepository,
    private readonly tx: TransactionManager,
    private readonly leaderboard: LeaderboardCache,
    private readonly realtime: RealtimePublisher,
    private readonly leaderboardSize: number
  ) {}

  async execute(bidId: string, userId: string): Promise<void> {
    const bid = await this.bidRepo.findById(bidId);
    if (!bid) {
      throw new AppError("Bid not found", 404, "BID_NOT_FOUND");
    }
    if (bid.userId !== userId) {
      throw new AppError("Forbidden", 403, "FORBIDDEN");
    }
    if (bid.status === "winning") {
      throw new AppError("Winning bids cannot be withdrawn", 409, "WINNING_LOCKED");
    }
    if (bid.status === "refunded") {
      throw new AppError("Bid already refunded", 409, "ALREADY_REFUNDED");
    }

    await this.tx.withTransaction(async () => {
      await this.walletRepo.updateBalances(userId, bid.amount, -bid.amount);
      await this.bidRepo.updateStatus(bidId, "refunded");
    });

    await this.leaderboard.removeBid(bid.auctionId, bid.id);
    const topBids = await this.leaderboard.getTopBids(bid.auctionId, this.leaderboardSize);
    this.realtime.publish({ type: "leaderboard:update", auctionId: bid.auctionId, bids: topBids });
  }
}
