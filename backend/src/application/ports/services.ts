import { Bid } from "../../domain/entities/bid";

export interface LeaderboardCache {
  addBid(auctionId: string, bid: Bid): Promise<void>;
  removeBid(auctionId: string, bidId: string): Promise<void>;
  getTopBids(auctionId: string, limit: number): Promise<Bid[]>;
  clear(auctionId: string): Promise<void>;
}

export interface RoundScheduler {
  scheduleCloseRound(roundId: string, runAt: Date): Promise<void>;
  rescheduleCloseRound(roundId: string, runAt: Date): Promise<void>;
}

export interface DistributedLock {
  withLock<T>(resource: string, ttlMs: number, handler: () => Promise<T>): Promise<T>;
}

export type RealtimeEvent =
  | { type: "leaderboard:update"; auctionId: string; bids: Bid[] }
  | { type: "round:extended"; auctionId: string; roundId: string; endTime: Date }
  | { type: "round:closed"; auctionId: string; roundId: string; winners: Bid[] };

export interface RealtimePublisher {
  publish(event: RealtimeEvent): void;
}
