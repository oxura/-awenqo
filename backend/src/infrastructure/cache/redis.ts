import Redis from "ioredis";
import { env } from "../../config/env";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null
    });
  }
  return client;
}
