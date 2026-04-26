import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { getConfig } from "../config/env.js";
import { getRedisClient } from "./redis.client.js";

const REDIS_PREFIX = "vs:idem:";

let store: LRUCache<string, { payload: string; statusCode: number }> | null = null;

function getLruStore(): LRUCache<string, { payload: string; statusCode: number }> {
  if (store) {
    return store;
  }
  const c = getConfig();
  store = new LRUCache<string, { payload: string; statusCode: number }>({
    max: c.IDEMPOTENCY_MAX_ENTRIES,
    ttl: c.IDEMPOTENCY_TTL_MS,
  });
  return store;
}

export function resetIdempotencyForTests(): void {
  store = null;
}

export function buildIdempotencyKey(
  tenantKey: string,
  idempotencyHeader: string,
  path: string,
  bodyRaw: string
): string {
  const h = createHash("sha256");
  h.update(tenantKey, "utf8");
  h.update("\n", "utf8");
  h.update(idempotencyHeader, "utf8");
  h.update("\n", "utf8");
  h.update(path, "utf8");
  h.update("\n", "utf8");
  h.update(bodyRaw, "utf8");
  return h.digest("hex");
}

export async function getIdempotentResponse(
  key: string
): Promise<{ payload: string; statusCode: number } | undefined> {
  const r = getRedisClient();
  if (r) {
    try {
      const raw = await r.get(REDIS_PREFIX + key);
      if (!raw) {
        return undefined;
      }
      return JSON.parse(raw) as { payload: string; statusCode: number };
    } catch {
      return getLruStore().get(key);
    }
  }
  return getLruStore().get(key);
}

export async function setIdempotentResponse(
  key: string,
  statusCode: number,
  payload: unknown
): Promise<void> {
  const c = getConfig();
  const r = getRedisClient();
  const rec = { statusCode, payload: JSON.stringify(payload) };
  if (r) {
    try {
      const ttl = Math.max(1, Math.ceil(c.IDEMPOTENCY_TTL_MS / 1000));
      await r.set(REDIS_PREFIX + key, JSON.stringify(rec), "EX", ttl);
      return;
    } catch {
      getLruStore().set(key, { statusCode, payload: rec.payload });
      return;
    }
  }
  getLruStore().set(key, { statusCode, payload: rec.payload });
}
