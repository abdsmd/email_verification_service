import { LRUCache } from "lru-cache";
import { getConfig } from "../config/env.js";
import type { VerificationResult } from "../types/verification.types.js";
import type {
  DnsCacheValue,
  DomainExistsCacheValue,
  DeadDomainCacheValue,
  DisposableCacheValue,
  RoleCacheValue,
  CatchAllCacheValue,
  ProviderCooldownCacheValue,
  MxHealthCacheValue,
  PersistentMxCacheValue,
} from "../types/cache.types.js";

export type { DnsCacheValue } from "../types/cache.types.js";

let dnsCache: LRUCache<string, DnsCacheValue> | null = null;
let resultCache: LRUCache<string, VerificationResult> | null = null;
let domainCache: LRUCache<string, DomainExistsCacheValue> | null = null;
let deadCache: LRUCache<string, DeadDomainCacheValue> | null = null;
let disposableCache: LRUCache<string, DisposableCacheValue> | null = null;
let roleCache: LRUCache<string, RoleCacheValue> | null = null;
let catchAllCache: LRUCache<string, CatchAllCacheValue> | null = null;
let providerCooldownCache: LRUCache<string, ProviderCooldownCacheValue> | null = null;
let mxHealthCache: LRUCache<string, MxHealthCacheValue> | null = null;
let persistentMxCache: LRUCache<string, PersistentMxCacheValue> | null = null;

export function getMemoryDnsCache(): LRUCache<string, DnsCacheValue> {
  if (dnsCache) return dnsCache;
  const c = getConfig();
  dnsCache = new LRUCache({ max: c.DNS_CACHE_MAX, updateAgeOnGet: true });
  return dnsCache;
}

export function getMemoryResultCache(): LRUCache<string, VerificationResult> {
  if (resultCache) return resultCache;
  const c = getConfig();
  resultCache = new LRUCache({ max: c.RESULT_CACHE_MAX, updateAgeOnGet: true });
  return resultCache;
}

function layerMax(c: { LAYER_CACHE_MAX: number }): number {
  return c.LAYER_CACHE_MAX;
}

export function getMemoryDomainCache(): LRUCache<string, DomainExistsCacheValue> {
  if (domainCache) return domainCache;
  const c = getConfig();
  domainCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return domainCache;
}

export function getMemoryDeadCache(): LRUCache<string, DeadDomainCacheValue> {
  if (deadCache) return deadCache;
  const c = getConfig();
  deadCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return deadCache;
}

export function getMemoryDisposableCache(): LRUCache<string, DisposableCacheValue> {
  if (disposableCache) return disposableCache;
  const c = getConfig();
  disposableCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return disposableCache;
}

export function getMemoryRoleCache(): LRUCache<string, RoleCacheValue> {
  if (roleCache) return roleCache;
  const c = getConfig();
  roleCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return roleCache;
}

export function getMemoryCatchAllCache(): LRUCache<string, CatchAllCacheValue> {
  if (catchAllCache) return catchAllCache;
  const c = getConfig();
  catchAllCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return catchAllCache;
}

export function getMemoryProviderCooldownCache(): LRUCache<string, ProviderCooldownCacheValue> {
  if (providerCooldownCache) return providerCooldownCache;
  providerCooldownCache = new LRUCache({ max: 64, updateAgeOnGet: false });
  return providerCooldownCache;
}

export function getMemoryMxHealthCache(): LRUCache<string, MxHealthCacheValue> {
  if (mxHealthCache) return mxHealthCache;
  const c = getConfig();
  mxHealthCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return mxHealthCache;
}

export function getMemoryPersistentMxCache(): LRUCache<string, PersistentMxCacheValue> {
  if (persistentMxCache) return persistentMxCache;
  const c = getConfig();
  persistentMxCache = new LRUCache({ max: layerMax(c), updateAgeOnGet: true });
  return persistentMxCache;
}

export function resetMemoryCachesForTests(): void {
  dnsCache = null;
  resultCache = null;
  domainCache = null;
  deadCache = null;
  disposableCache = null;
  roleCache = null;
  catchAllCache = null;
  providerCooldownCache = null;
  mxHealthCache = null;
  persistentMxCache = null;
}
