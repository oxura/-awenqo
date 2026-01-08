export type BidStatus = "active" | "winning" | "outbid" | "refunded";

export interface Bid {
  id: string;
  userId: string;
  auctionId: string;
  roundId: string;
  amount: number;
  timestamp: Date;
  status: BidStatus;
}
