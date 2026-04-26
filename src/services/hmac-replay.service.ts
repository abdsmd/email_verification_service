import { LRUCache } from "lru-cache";
import { getConfig } from "../config/env.js";

let cache: LRUCache<string, true> | null = null;

function getCache(): LRUCache<string, true> {
  if (!cache) {
    const c = getConfig();
    cache = new LRUCache<string, true>({
      max: 100_000,
      ttl: c.HMAC_REPLAY_TTL_MS,
    });
  }
  return cache;
}

/** @internal tests */
export function resetHmacReplayCacheForTests(): void {
  cache = null;
}

/**
 * @returns "replay" if this id was seen within TTL, otherwise stores id and returns "ok"
 */
export function checkAndStoreRequestId(requestId: string): "ok" | "replay" {
  const c = getCache();
  if (c.has(requestId)) {
    return "replay";
  }
  c.set(requestId, true);
  return "ok";
}
