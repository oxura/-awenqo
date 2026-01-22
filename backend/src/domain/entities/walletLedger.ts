export type WalletLedgerReason = "credit" | "hold" | "refund" | "settle" | "adjustment";

export type WalletLedgerMeta = {
  reason: WalletLedgerReason;
  auctionId?: string;
  roundId?: string;
  bidId?: string;
  idempotencyKey?: string;
};

export type WalletLedgerEntry = WalletLedgerMeta & {
  id: string;
  userId: string;
  availableDelta: number;
  lockedDelta: number;
  createdAt: Date;
};
