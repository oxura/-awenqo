import { Bid, BidStatus } from "../../domain/entities/bid";
import { LeaderboardCache } from "../../application/ports/services";
import { getRedis } from "./redis";

/**
 * Maximum timestamp value for Redis ZSET score inversion.
 * Redis ZSET sorts by score ascending, but we want newer bids to win on tie-break
 * (lower timestamp = higher priority). By storing (MAX_TS - timestamp) as part of member,
 * we achieve descending timestamp order when ZSET returns results by score DESC.
 * Value chosen to exceed any reasonable Date.getTime() until year ~2286.
 */
const MAX_TS = 9_999_999_999_999;

function padTimestamp(value: number): string {
  return value.toString().padStart(13, "0");
}

function memberForBid(bid: Bid): string {
  const inv = MAX_TS - bid.timestamp.getTime();
  return `${padTimestamp(inv)}:${bid.id}`;
}

function bidIdFromMember(member: string): string {
  const parts = member.split(":");
  return parts[1] ?? member;
}

export class RedisLeaderboardCache implements LeaderboardCache {
  private redis = getRedis();

  async addBid(auctionId: string, bid: Bid): Promise<void> {
    const leaderboardKey = `auction:${auctionId}:leaderboard`;
    const metaKey = `auction:${auctionId}:bidmeta`;
    const member = memberForBid(bid);

    await this.redis.zadd(leaderboardKey, bid.amount, member);
    await this.redis.hset(
      metaKey,
      bid.id,
      JSON.stringify({
        userId: bid.userId,
        amount: bid.amount,
        timestamp: bid.timestamp.toISOString(),
        roundId: bid.roundId,
        member
      })
    );
  }

  async removeBid(auctionId: string, bidId: string): Promise<void> {
    const leaderboardKey = `auction:${auctionId}:leaderboard`;
    const metaKey = `auction:${auctionId}:bidmeta`;
    const meta = await this.redis.hget(metaKey, bidId);
    if (meta) {
      const parsed = JSON.parse(meta) as { member?: string };
      if (parsed.member) {
        await this.redis.zrem(leaderboardKey, parsed.member);
      }
      await this.redis.hdel(metaKey, bidId);
    }
  }

  async getTopBids(auctionId: string, limit: number): Promise<Bid[]> {
    const leaderboardKey = `auction:${auctionId}:leaderboard`;
    const metaKey = `auction:${auctionId}:bidmeta`;
    const members = await this.redis.zrevrange(leaderboardKey, 0, limit - 1);
    if (members.length === 0) {
      return [];
    }
    const bidIds = members.map(bidIdFromMember);
    const metaValues = await this.redis.hmget(metaKey, ...bidIds);

    return bidIds
      .map((id, index) => {
        const meta = metaValues[index];
        if (!meta) {
          return null;
        }
        const parsed = JSON.parse(meta) as {
          userId: string;
          amount: number;
          timestamp: string;
          roundId: string;
          member: string;
        };
        return {
          id,
          userId: parsed.userId,
          auctionId,
          roundId: parsed.roundId,
          amount: parsed.amount,
          timestamp: new Date(parsed.timestamp),
          status: "active" as BidStatus
        };
      })
      .filter((bid): bid is Bid => bid !== null);
  }

  async clear(auctionId: string): Promise<void> {
    await this.redis.del(`auction:${auctionId}:leaderboard`);
    await this.redis.del(`auction:${auctionId}:bidmeta`);
  }
}
