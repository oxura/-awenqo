export type AuctionStatus = "active" | "processing" | "finished";

export interface Auction {
  id: string;
  title: string;
  totalItems: number;
  status: AuctionStatus;
  currentRoundNumber: number;
  createdAt: Date;
}
