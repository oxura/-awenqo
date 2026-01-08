import Redlock from "redlock";
import { DistributedLock } from "../../application/ports/services";
import { getRedis } from "../cache/redis";

const redis = getRedis();

// Redlock v4 API - uses lock/unlock with callback pattern
const redlock = new Redlock([redis], {
  retryCount: 5,
  retryDelay: 100,
  retryJitter: 50
});

export class RedisDistributedLock implements DistributedLock {
  async withLock<T>(resource: string, ttlMs: number, handler: () => Promise<T>): Promise<T> {
    // Redlock v4 uses .lock() which returns a Lock object
    const lock = await redlock.lock(resource, ttlMs);
    try {
      return await handler();
    } finally {
      await lock.unlock();
    }
  }
}
