import { describe, it, expect } from "vitest";
import { rankBids } from "../../src/domain/services/ranking";
import { Bid } from "../../src/domain/entities/bid";

function makeBid(id: string, amount: number, timestamp: number): Bid {
  return {
    id,
    userId: "user",
    auctionId: "auction",
    roundId: "round",
    amount,
    timestamp: new Date(timestamp),
    status: "active"
  };
}

describe("rankBids", () => {
  it("orders by amount desc, timestamp asc", () => {
    const bids = [
      makeBid("b1", 10, 2000),
      makeBid("b2", 20, 3000),
      makeBid("b3", 20, 1000),
      makeBid("b4", 10, 1000)
    ];

    const result = rankBids(bids);

    expect(result.map((bid) => bid.id)).toEqual(["b3", "b2", "b4", "b1"]);
  });

  it("returns empty array for empty input", () => {
    expect(rankBids([])).toEqual([]);
  });

  it("returns single bid unchanged", () => {
    const bids = [makeBid("b1", 100, 1000)];

    const result = rankBids(bids);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1");
  });

  it("does not mutate original array", () => {
    const bids = [
      makeBid("b1", 10, 2000),
      makeBid("b2", 20, 1000)
    ];
    const originalOrder = bids.map((b) => b.id);

    rankBids(bids);

    expect(bids.map((b) => b.id)).toEqual(originalOrder);
  });

  it("handles all equal amounts - sorts by timestamp only", () => {
    const bids = [
      makeBid("b1", 100, 3000),
      makeBid("b2", 100, 1000),
      makeBid("b3", 100, 2000)
    ];

    const result = rankBids(bids);

    expect(result.map((bid) => bid.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("handles all equal timestamps - sorts by amount only", () => {
    const bids = [
      makeBid("b1", 10, 1000),
      makeBid("b2", 30, 1000),
      makeBid("b3", 20, 1000)
    ];

    const result = rankBids(bids);

    expect(result.map((bid) => bid.id)).toEqual(["b2", "b3", "b1"]);
  });
});
