export type RoundStatus = "active" | "closed";

export interface Round {
  id: string;
  auctionId: string;
  roundNumber: number;
  startTime: Date;
  endTime: Date;
  status: RoundStatus;
}
