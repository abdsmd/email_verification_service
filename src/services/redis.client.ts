import { Redis } from "ioredis";
import { getConfig } from "../config/env.js";

let client: Redis | null = null;

/** Single shared client when `REDIS_URL` is set; otherwise null. */
export function getRedisClient(): Redis | null {
  const url = getConfig().REDIS_URL?.trim();
  if (!url) {
    return null;
  }
  if (!client) {
    client = new Redis(url, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    });
  }
  return client;
}

export function resetRedisForTests(): void {
  if (client) {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
    client = null;
  }
}
