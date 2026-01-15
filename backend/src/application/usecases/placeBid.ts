import { AppError } from "../errors";
import { Bid } from "../../domain/entities/bid";
import { shouldExtendRound, extendRound } from "../../domain/services/antiSniping";
import { rankBids } from "../../domain/services/ranking";
import {
  AuctionRepository,
  BidRepository,
  RoundRepository,
  TransactionManager,
  UserRepository,
  WalletRepository
} from "../ports/repositories";
import {
  DistributedLock,
  LeaderboardCache,
  RealtimePublisher,
  RoundScheduler
} from "../ports/services";

export type PlaceBidInput = {
  auctionId: string;
  userId: string;
  amount: number;
};

export class PlaceBidUseCase {
  constructor(
    private readonly auctionRepo: AuctionRepository,
    private readonly roundRepo: RoundRepository,
    private readonly bidRepo: BidRepository,
    private readonly walletRepo: WalletRepository,
    private readonly userRepo: UserRepository,
    private readonly tx: TransactionManager,
    private readonly leaderboard: LeaderboardCache,
    private readonly scheduler: RoundScheduler,
    private readonly lock: DistributedLock,
    private readonly realtime: RealtimePublisher,
    private readonly thresholdMs: number,
    private readonly extensionMs: number,
    private readonly leaderboardSize: number,
    private readonly minStepPercent: number
  ) {}

  async execute(input: PlaceBidInput): Promise<Bid> {
    if (input.amount <= 0) {
      throw new AppError("Bid amount must be positive", 400, "INVALID_AMOUNT");
    }

    let topBids = await this.leaderboard.getTopBids(input.auctionId, 1);
    if (topBids.length === 0) {
      const fallbackBids = await this.bidRepo.findActiveByAuction(input.auctionId);
      if (fallbackBids.length > 0) {
        const ranked = rankBids(fallbackBids);
        const topRanked = ranked.slice(0, this.leaderboardSize);
        await Promise.all(topRanked.map((bid) => this.leaderboard.addBid(input.auctionId, bid)));
        topBids = topRanked.slice(0, 1);
      }
    }
    if (topBids.length > 0) {
      const minAmount = Math.ceil(topBids[0].amount * (1 + this.minStepPercent / 100));
      if (input.amount < minAmount) {
        throw new AppError(
          `Bid must be at least ${minAmount}`,
          409,
          "BID_TOO_LOW"
        );
      }
    }

    const auction = await this.auctionRepo.findById(input.auctionId);
    if (!auction || auction.status !== "active") {
      throw new AppError("Auction not active", 404, "AUCTION_NOT_ACTIVE");
    }

    const round = await this.roundRepo.findActiveByAuction(input.auctionId);
    if (!round) {
      throw new AppError("No active round", 409, "ROUND_NOT_ACTIVE");
    }

    const now = new Date();
    if (now.getTime() > round.endTime.getTime()) {
      throw new AppError("Round already ended", 409, "ROUND_ENDED");
    }

    let createdBid: Bid | null = null;

    await this.tx.withTransaction(async () => {
      await this.userRepo.createIfMissing({ id: input.userId, username: input.userId, walletAddress: "n/a" });
      await this.walletRepo.createIfMissing(input.userId);
      const wallet = await this.walletRepo.findByUserId(input.userId);
      if (!wallet || wallet.availableBalance < input.amount) {
        throw new AppError("Insufficient funds", 409, "INSUFFICIENT_FUNDS");
      }
      await this.walletRepo.updateBalances(input.userId, -input.amount, input.amount);
      createdBid = await this.bidRepo.create({
        auctionId: input.auctionId,
        userId: input.userId,
        roundId: round.id,
        amount: input.amount,
        timestamp: now,
        status: "active"
      });
    });

    if (!createdBid) {
      throw new AppError("Failed to create bid", 500, "BID_CREATE_FAILED");
    }

    await this.leaderboard.addBid(input.auctionId, createdBid);
    const updatedTopBids = await this.leaderboard.getTopBids(input.auctionId, this.leaderboardSize);
    this.realtime.publish({ type: "leaderboard:update", auctionId: input.auctionId, bids: updatedTopBids });

    await this.lock.withLock(`lock:auction:${input.auctionId}:round:${round.id}`, 2000, async () => {
      const freshRound = await this.roundRepo.findById(round.id);
      if (!freshRound || freshRound.status !== "active") {
        return;
      }
      if (shouldExtendRound(freshRound.endTime, now, this.thresholdMs)) {
        const newEnd = extendRound(freshRound.endTime, this.extensionMs);
        await this.roundRepo.update(freshRound.id, { endTime: newEnd });
        await this.scheduler.rescheduleCloseRound(freshRound.id, newEnd);
        this.realtime.publish({
          type: "round:extended",
          auctionId: input.auctionId,
          roundId: freshRound.id,
          endTime: newEnd
        });
      }
    });

    return createdBid;
  }
}
