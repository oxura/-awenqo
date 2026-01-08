import { ObjectId } from "mongodb";
import { Auction } from "../../domain/entities/auction";
import { Bid, BidStatus } from "../../domain/entities/bid";
import { Round } from "../../domain/entities/round";
import { Wallet } from "../../domain/entities/wallet";
import { User } from "../../domain/entities/user";
import {
  AuctionRepository,
  BidRepository,
  RoundRepository,
  TransactionManager,
  WalletRepository,
  UserRepository
} from "../../application/ports/repositories";
import { getCollections, toObjectId, withMongoSession } from "../db/mongo";
import { getSession } from "../db/transactionContext";

function mapId(id: ObjectId): string {
  return id.toHexString();
}

export class MongoTransactionManager implements TransactionManager {
  async withTransaction<T>(handler: () => Promise<T>): Promise<T> {
    return withMongoSession(async () => handler());
  }
}

export class MongoAuctionRepository implements AuctionRepository {
  async create(auction: Omit<Auction, "id" | "createdAt">): Promise<Auction> {
    const { auctions } = await getCollections();
    const doc = {
      ...auction,
      createdAt: new Date()
    };
    const result = await auctions.insertOne(doc, { session: getSession() });
    return { ...doc, id: mapId(result.insertedId) } satisfies Auction;
  }

  async findById(id: string): Promise<Auction | null> {
    const { auctions } = await getCollections();
    const doc = await auctions.findOne({ _id: toObjectId(id) }, { session: getSession() });
    if (!doc) {
      return null;
    }
    return {
      id: mapId(doc._id),
      title: doc.title,
      totalItems: doc.totalItems,
      status: doc.status,
      currentRoundNumber: doc.currentRoundNumber,
      createdAt: doc.createdAt
    } as Auction;
  }

  async update(id: string, update: Partial<Auction>): Promise<void> {
    const { auctions } = await getCollections();
    const { id: _, createdAt, ...data } = update as Auction;
    await auctions.updateOne(
      { _id: toObjectId(id) },
      { $set: data },
      { session: getSession() }
    );
  }
}

export class MongoRoundRepository implements RoundRepository {
  async create(round: Omit<Round, "id">): Promise<Round> {
    const { rounds } = await getCollections();
    const doc = { ...round };
    const result = await rounds.insertOne(doc, { session: getSession() });
    return { ...doc, id: mapId(result.insertedId) } satisfies Round;
  }

  async findById(id: string): Promise<Round | null> {
    const { rounds } = await getCollections();
    const doc = await rounds.findOne({ _id: toObjectId(id) }, { session: getSession() });
    if (!doc) {
      return null;
    }
    return {
      id: mapId(doc._id),
      auctionId: doc.auctionId,
      roundNumber: doc.roundNumber,
      startTime: doc.startTime,
      endTime: doc.endTime,
      status: doc.status
    } as Round;
  }

  async findActiveByAuction(auctionId: string): Promise<Round | null> {
    const { rounds } = await getCollections();
    const doc = await rounds.findOne(
      { auctionId, status: "active" },
      { sort: { roundNumber: -1 }, session: getSession() }
    );
    if (!doc) {
      return null;
    }
    return {
      id: mapId(doc._id),
      auctionId: doc.auctionId,
      roundNumber: doc.roundNumber,
      startTime: doc.startTime,
      endTime: doc.endTime,
      status: doc.status
    } as Round;
  }

  async update(id: string, update: Partial<Round>): Promise<void> {
    const { rounds } = await getCollections();
    const { id: _, ...data } = update as Round;
    await rounds.updateOne(
      { _id: toObjectId(id) },
      { $set: data },
      { session: getSession() }
    );
  }
}

export class MongoBidRepository implements BidRepository {
  async create(bid: Omit<Bid, "id">): Promise<Bid> {
    const { bids } = await getCollections();
    const doc = { ...bid };
    const result = await bids.insertOne(doc, { session: getSession() });
    return { ...doc, id: mapId(result.insertedId) } satisfies Bid;
  }

  async findById(id: string): Promise<Bid | null> {
    const { bids } = await getCollections();
    const doc = await bids.findOne({ _id: toObjectId(id) }, { session: getSession() });
    if (!doc) {
      return null;
    }
    return {
      id: mapId(doc._id),
      userId: doc.userId,
      auctionId: doc.auctionId,
      roundId: doc.roundId,
      amount: doc.amount,
      timestamp: doc.timestamp,
      status: doc.status
    } as Bid;
  }

  // HIGH PRIORITY FIX: Exclude "winning" bids from active pool
  // Winners should exit the pool after winning, only "active" and "outbid" continue
  async findActiveByAuction(auctionId: string): Promise<Bid[]> {
    const { bids } = await getCollections();
    const docs = await bids
      .find(
        { auctionId, status: { $in: ["active", "outbid"] } },
        { session: getSession() }
      )
      .toArray();
    return docs.map((doc) => ({
      id: mapId(doc._id),
      userId: doc.userId,
      auctionId: doc.auctionId,
      roundId: doc.roundId,
      amount: doc.amount,
      timestamp: doc.timestamp,
      status: doc.status
    })) as Bid[];
  }

  async findByAuction(auctionId: string): Promise<Bid[]> {
    const { bids } = await getCollections();
    const docs = await bids.find({ auctionId }, { session: getSession() }).toArray();
    return docs.map((doc) => ({
      id: mapId(doc._id),
      userId: doc.userId,
      auctionId: doc.auctionId,
      roundId: doc.roundId,
      amount: doc.amount,
      timestamp: doc.timestamp,
      status: doc.status
    })) as Bid[];
  }

  async updateMany(ids: string[], update: Partial<Bid>): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const { bids } = await getCollections();
    const { id: _, ...data } = update as Bid;
    await bids.updateMany(
      { _id: { $in: ids.map(toObjectId) } },
      { $set: data },
      { session: getSession() }
    );
  }

  async updateStatus(id: string, status: BidStatus): Promise<void> {
    const { bids } = await getCollections();
    await bids.updateOne(
      { _id: toObjectId(id) },
      { $set: { status } },
      { session: getSession() }
    );
  }
}

export class MongoWalletRepository implements WalletRepository {
  async findByUserId(userId: string): Promise<Wallet | null> {
    const { wallets } = await getCollections();
    const doc = await wallets.findOne({ userId }, { session: getSession() });
    if (!doc) {
      return null;
    }
    return {
      id: mapId(doc._id),
      userId: doc.userId,
      availableBalance: doc.availableBalance,
      lockedBalance: doc.lockedBalance
    } as Wallet;
  }

  async updateBalances(userId: string, availableDelta: number, lockedDelta: number): Promise<void> {
    const { wallets } = await getCollections();
    await wallets.updateOne(
      { userId },
      { $inc: { availableBalance: availableDelta, lockedBalance: lockedDelta } },
      { session: getSession() }
    );
  }

  // MEDIUM PRIORITY FIX: Atomic upsert pattern to prevent duplicate key errors
  async createIfMissing(userId: string): Promise<Wallet> {
    const { wallets } = await getCollections();
    const result = await wallets.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, availableBalance: 0, lockedBalance: 0 } },
      { upsert: true, returnDocument: "after", session: getSession() }
    );
    if (!result) {
      throw new Error("Failed to create or find wallet");
    }
    return {
      id: mapId(result._id),
      userId: result.userId,
      availableBalance: result.availableBalance,
      lockedBalance: result.lockedBalance
    } as Wallet;
  }
}

export class MongoUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const { users } = await getCollections();
    const doc = await users.findOne({ _id: id }, { session: getSession() });
    if (!doc) {
      return null;
    }
    return {
      id: doc._id,
      username: doc.username,
      walletAddress: doc.walletAddress
    };
  }

  // MEDIUM PRIORITY FIX: Atomic upsert pattern to prevent duplicate key errors
  async createIfMissing(user: User): Promise<User> {
    const { users } = await getCollections();
    const result = await users.findOneAndUpdate(
      { _id: user.id },
      { $setOnInsert: { _id: user.id, username: user.username, walletAddress: user.walletAddress } },
      { upsert: true, returnDocument: "after", session: getSession() }
    );
    if (!result) {
      throw new Error("Failed to create or find user");
    }
    return {
      id: result._id,
      username: result.username,
      walletAddress: result.walletAddress
    };
  }
}
