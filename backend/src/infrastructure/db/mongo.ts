import { MongoClient, Db, ClientSession, Collection, ObjectId } from "mongodb";
import { env } from "../../config/env";
import { runWithSession } from "./transactionContext";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) {
    return db;
  }
  client = new MongoClient(env.MONGO_URI);
  await client.connect();
  db = client.db();
  return db;
}

export async function getDb(): Promise<Db> {
  return await connectMongo();
}

export async function withMongoSession<T>(handler: (session: ClientSession) => Promise<T>): Promise<T> {
  if (!client) {
    await connectMongo();
  }
  if (!client) {
    throw new Error("Mongo client not initialized");
  }
  const session = client.startSession();
  try {
    let result: T | null = null;
    await session.withTransaction(async () => {
      result = await runWithSession(session, async () => handler(session));
    });
    if (result === null) {
      throw new Error("Transaction handler returned null");
    }
    return result;
  } finally {
    await session.endSession();
  }
}

export function toObjectId(id: string): ObjectId {
  return new ObjectId(id);
}

export type Collections = {
  auctions: Collection;
  rounds: Collection;
  bids: Collection;
  users: Collection;
  wallets: Collection;
};

export async function getCollections(): Promise<Collections> {
  const database = await getDb();
  return {
    auctions: database.collection("auctions"),
    rounds: database.collection("rounds"),
    bids: database.collection("bids"),
    users: database.collection("users"),
    wallets: database.collection("wallets")
  };
}

export async function ensureIndexes(): Promise<void> {
  const { bids, rounds, wallets, users } = await getCollections();
  await bids.createIndex({ auctionId: 1, amount: -1, timestamp: 1 });
  await bids.createIndex({ userId: 1 });
  await rounds.createIndex({ auctionId: 1, status: 1, endTime: 1 });
  await wallets.createIndex({ userId: 1 }, { unique: true });
}
