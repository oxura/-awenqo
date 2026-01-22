import { Auction } from "../../domain/entities/auction";
import { Bid, BidStatus } from "../../domain/entities/bid";
import { Round } from "../../domain/entities/round";
import { User } from "../../domain/entities/user";
import { Wallet } from "../../domain/entities/wallet";
import { WalletLedgerMeta } from "../../domain/entities/walletLedger";

export interface AuctionRepository {
  create(auction: Omit<Auction, "id" | "createdAt">): Promise<Auction>;
  findById(id: string): Promise<Auction | null>;
  update(id: string, update: Partial<Auction>): Promise<void>;
}

export interface RoundRepository {
  create(round: Omit<Round, "id">): Promise<Round>;
  findById(id: string): Promise<Round | null>;
  findActiveByAuction(auctionId: string): Promise<Round | null>;
  update(id: string, update: Partial<Round>): Promise<void>;
}

export interface BidRepository {
  create(bid: Omit<Bid, "id">): Promise<Bid>;
  findById(id: string): Promise<Bid | null>;
  findActiveByAuction(auctionId: string): Promise<Bid[]>;
  findByAuction(auctionId: string): Promise<Bid[]>;
  updateMany(ids: string[], update: Partial<Bid>): Promise<void>;
  updateStatus(id: string, status: BidStatus): Promise<void>;
}

export interface WalletRepository {
  findByUserId(userId: string): Promise<Wallet | null>;
  updateBalances(
    userId: string,
    availableDelta: number,
    lockedDelta: number,
    meta?: WalletLedgerMeta
  ): Promise<void>;
  createIfMissing(userId: string): Promise<Wallet>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  createIfMissing(user: User): Promise<User>;
}

export interface TransactionManager {
  withTransaction<T>(handler: () => Promise<T>): Promise<T>;
}

export type IdempotencyRecord = {
  id: string;
  key: string;
  scope: string;
  status: number;
  response: unknown;
  createdAt: Date;
};

export interface IdempotencyRepository {
  find(key: string, scope: string): Promise<IdempotencyRecord | null>;
  reserve(key: string, scope: string): Promise<boolean>;
  finalize(key: string, scope: string, status: number, response: unknown): Promise<void>;
}
