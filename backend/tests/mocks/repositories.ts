import { vi } from "vitest";
import { Auction } from "../../src/domain/entities/auction";
import { Bid } from "../../src/domain/entities/bid";
import { Round } from "../../src/domain/entities/round";
import { User } from "../../src/domain/entities/user";
import { Wallet } from "../../src/domain/entities/wallet";
import {
  AuctionRepository,
  BidRepository,
  RoundRepository,
  TransactionManager,
  UserRepository,
  WalletRepository
} from "../../src/application/ports/repositories";

// In-memory storage for mocks
export function createMockStorage() {
  return {
    auctions: new Map<string, Auction>(),
    rounds: new Map<string, Round>(),
    bids: new Map<string, Bid>(),
    users: new Map<string, User>(),
    wallets: new Map<string, Wallet>(),
    idCounter: 0
  };
}

export type MockStorage = ReturnType<typeof createMockStorage>;

export function createMockAuctionRepository(storage: MockStorage): AuctionRepository {
  return {
    create: vi.fn(async (auction) => {
      const id = `auction-${++storage.idCounter}`;
      const created: Auction = {
        ...auction,
        id,
        createdAt: new Date()
      };
      storage.auctions.set(id, created);
      return created;
    }),
    findById: vi.fn(async (id) => storage.auctions.get(id) ?? null),
    update: vi.fn(async (id, update) => {
      const auction = storage.auctions.get(id);
      if (auction) {
        storage.auctions.set(id, { ...auction, ...update });
      }
    })
  };
}

export function createMockRoundRepository(storage: MockStorage): RoundRepository {
  return {
    create: vi.fn(async (round) => {
      const id = `round-${++storage.idCounter}`;
      const created: Round = { ...round, id };
      storage.rounds.set(id, created);
      return created;
    }),
    findById: vi.fn(async (id) => storage.rounds.get(id) ?? null),
    findActiveByAuction: vi.fn(async (auctionId) => {
      for (const round of storage.rounds.values()) {
        if (round.auctionId === auctionId && round.status === "active") {
          return round;
        }
      }
      return null;
    }),
    update: vi.fn(async (id, update) => {
      const round = storage.rounds.get(id);
      if (round) {
        storage.rounds.set(id, { ...round, ...update });
      }
    })
  };
}

export function createMockBidRepository(storage: MockStorage): BidRepository {
  return {
    create: vi.fn(async (bid) => {
      const id = `bid-${++storage.idCounter}`;
      const created: Bid = { ...bid, id };
      storage.bids.set(id, created);
      return created;
    }),
    findById: vi.fn(async (id) => storage.bids.get(id) ?? null),
    findActiveByAuction: vi.fn(async (auctionId) => {
      const result: Bid[] = [];
      for (const bid of storage.bids.values()) {
        if (bid.auctionId === auctionId && (bid.status === "active" || bid.status === "outbid")) {
          result.push(bid);
        }
      }
      return result;
    }),
    findByAuction: vi.fn(async (auctionId) => {
      const result: Bid[] = [];
      for (const bid of storage.bids.values()) {
        if (bid.auctionId === auctionId) {
          result.push(bid);
        }
      }
      return result;
    }),
    updateMany: vi.fn(async (ids, update) => {
      for (const id of ids) {
        const bid = storage.bids.get(id);
        if (bid) {
          storage.bids.set(id, { ...bid, ...update });
        }
      }
    }),
    updateStatus: vi.fn(async (id, status) => {
      const bid = storage.bids.get(id);
      if (bid) {
        storage.bids.set(id, { ...bid, status });
      }
    })
  };
}

export function createMockWalletRepository(storage: MockStorage): WalletRepository {
  return {
    findByUserId: vi.fn(async (userId) => {
      for (const wallet of storage.wallets.values()) {
        if (wallet.userId === userId) {
          return wallet;
        }
      }
      return null;
    }),
    updateBalances: vi.fn(async (userId, availableDelta, lockedDelta) => {
      for (const [id, wallet] of storage.wallets.entries()) {
        if (wallet.userId === userId) {
          storage.wallets.set(id, {
            ...wallet,
            availableBalance: wallet.availableBalance + availableDelta,
            lockedBalance: wallet.lockedBalance + lockedDelta
          });
          return;
        }
      }
    }),
    createIfMissing: vi.fn(async (userId) => {
      for (const wallet of storage.wallets.values()) {
        if (wallet.userId === userId) {
          return wallet;
        }
      }
      const id = `wallet-${++storage.idCounter}`;
      const wallet: Wallet = {
        id,
        userId,
        availableBalance: 0,
        lockedBalance: 0
      };
      storage.wallets.set(id, wallet);
      return wallet;
    })
  };
}

export function createMockUserRepository(storage: MockStorage): UserRepository {
  return {
    findById: vi.fn(async (id) => storage.users.get(id) ?? null),
    createIfMissing: vi.fn(async (user) => {
      const existing = storage.users.get(user.id);
      if (existing) {
        return existing;
      }
      storage.users.set(user.id, user);
      return user;
    })
  };
}

export function createMockTransactionManager(): TransactionManager {
  return {
    withTransaction: vi.fn(async (handler) => handler())
  };
}

// Helper to seed test data
export function seedWallet(storage: MockStorage, userId: string, available: number, locked = 0): Wallet {
  const id = `wallet-${++storage.idCounter}`;
  const wallet: Wallet = { id, userId, availableBalance: available, lockedBalance: locked };
  storage.wallets.set(id, wallet);
  return wallet;
}

export function seedUser(storage: MockStorage, userId: string): User {
  const user: User = { id: userId, username: userId, walletAddress: "0x123" };
  storage.users.set(userId, user);
  return user;
}

export function seedAuction(
  storage: MockStorage,
  overrides: Partial<Auction> = {}
): Auction {
  const id = `auction-${++storage.idCounter}`;
  const auction: Auction = {
    id,
    title: "Test Auction",
    totalItems: 3,
    status: "active",
    currentRoundNumber: 1,
    createdAt: new Date(),
    ...overrides
  };
  storage.auctions.set(id, auction);
  return auction;
}

export function seedRound(
  storage: MockStorage,
  auctionId: string,
  overrides: Partial<Round> = {}
): Round {
  const id = `round-${++storage.idCounter}`;
  const now = new Date();
  const round: Round = {
    id,
    auctionId,
    roundNumber: 1,
    startTime: now,
    endTime: new Date(now.getTime() + 300000), // 5 minutes
    status: "active",
    ...overrides
  };
  storage.rounds.set(id, round);
  return round;
}

export function seedBid(
  storage: MockStorage,
  auctionId: string,
  userId: string,
  amount: number,
  overrides: Partial<Bid> = {}
): Bid {
  const id = `bid-${++storage.idCounter}`;
  const bid: Bid = {
    id,
    auctionId,
    userId,
    roundId: "round-1",
    amount,
    timestamp: new Date(),
    status: "active",
    ...overrides
  };
  storage.bids.set(id, bid);
  return bid;
}
