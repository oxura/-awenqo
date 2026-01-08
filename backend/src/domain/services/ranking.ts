import { Bid } from "../entities/bid";

export function rankBids(bids: Bid[]): Bid[] {
  return [...bids].sort((a, b) => {
    if (a.amount !== b.amount) {
      return b.amount - a.amount;
    }
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
}
