import { vi } from "vitest";
import { Bid } from "../../src/domain/entities/bid";
import {
  DistributedLock,
  LeaderboardCache,
  RealtimePublisher,
  RoundScheduler
} from "../../src/application/ports/services";

// In-memory leaderboard for testing
export function createMockLeaderboardCache(): LeaderboardCache & { _data: Map<string, Bid[]> } {
  const data = new Map<string, Bid[]>();

  return {
    _data: data,
    addBid: vi.fn(async (auctionId: string, bid: Bid) => {
      const bids = data.get(auctionId) ?? [];
      bids.push(bid);
      // Sort by amount desc, timestamp asc
      bids.sort((a, b) => {
        if (a.amount !== b.amount) return b.amount - a.amount;
        return a.timestamp.getTime() - b.timestamp.getTime();
      });
      data.set(auctionId, bids);
    }),
    removeBid: vi.fn(async (auctionId: string, bidId: string) => {
      const bids = data.get(auctionId) ?? [];
      const filtered = bids.filter((b) => b.id !== bidId);
      data.set(auctionId, filtered);
    }),
    getTopBids: vi.fn(async (auctionId: string, limit: number) => {
      const bids = data.get(auctionId) ?? [];
      return bids.slice(0, limit);
    }),
    clear: vi.fn(async (auctionId: string) => {
      data.delete(auctionId);
    })
  };
}

export function createMockRoundScheduler(): RoundScheduler & {
  _scheduledJobs: Map<string, Date>;
} {
  const scheduledJobs = new Map<string, Date>();

  return {
    _scheduledJobs: scheduledJobs,
    scheduleCloseRound: vi.fn(async (roundId: string, runAt: Date) => {
      scheduledJobs.set(roundId, runAt);
    }),
    rescheduleCloseRound: vi.fn(async (roundId: string, runAt: Date) => {
      scheduledJobs.set(`${roundId}-${runAt.getTime()}`, runAt);
    })
  };
}

export function createMockDistributedLock(): DistributedLock & { withLock: ReturnType<typeof vi.fn> } {
  const withLockImpl = async <T>(_resource: string, _ttlMs: number, handler: () => Promise<T>): Promise<T> => {
    return handler();
  };
  
  return {
    withLock: vi.fn(withLockImpl) as unknown as DistributedLock["withLock"] & ReturnType<typeof vi.fn>
  };
}

export function createMockRealtimePublisher(): RealtimePublisher & {
  _events: Array<{ type: string; payload: unknown }>;
} {
  const events: Array<{ type: string; payload: unknown }> = [];

  return {
    _events: events,
    publish: vi.fn((event: { type: string; [key: string]: unknown }) => {
      events.push({ type: event.type, payload: event });
    })
  };
}
