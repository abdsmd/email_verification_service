import { getConfig } from "../config/env.js";
import { jitterTtlMs } from "../utils/cache-ttl.js";
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
import {
  getMemoryDnsCache,
  getMemoryResultCache,
  getMemoryDomainCache,
  getMemoryDeadCache,
  getMemoryDisposableCache,
  getMemoryRoleCache,
  getMemoryCatchAllCache,
  getMemoryProviderCooldownCache,
  getMemoryMxHealthCache,
  getMemoryPersistentMxCache,
} from "../repositories/memory-cache.repository.js";
import * as sql from "../repositories/sqlite-cache.repository.js";
import type { SqliteCacheNamespace } from "../repositories/sqlite-cache.repository.js";

/*
 * Multi-layer cache: separate TTL knobs (mx vs domain vs result vs catch-all, etc.) so DNS
 * facts and negative paths can be cached longer than a single “unknown” RCPT, without
 * conflating layers. Jittered TTLs for hot keys reduce stampede; see `jitterTtlMs`.
 */

function useSqlite(): boolean {
  return getConfig().CACHE_BACKEND === "sqlite";
}

/**
 * Per-email result cache: “positive” (valid) uses a short `RESULT_CACHE_TTL_MS` so
 * re-checks can pick up list changes. Hard negatives (undeliverable, disposable, …) use
 * `VERIFICATION_NEGATIVE_CACHE_TTL_MS` (longer) to cut repeat SMTP for bad mailboxes. Soft /
 * inconclusive (`retry_later`, `greylisted`, `unknown` without hard proof) use
 * `VERIFICATION_SOFT_FAILURE_CACHE_TTL_MS` so transient greylists and 4xx are *not* stored as
 * if they were permanent “invalid” for the full negative window.
 */
function resultCacheTtlMs(v: VerificationResult): number {
  const c = getConfig();
  if (v.code === "valid") {
    return c.RESULT_CACHE_TTL_MS;
  }
  if (
    v.code === "undeliverable" ||
    v.code === "invalid" ||
    v.code === "dead" ||
    v.code === "disposable" ||
    v.code === "role_account" ||
    v.code === "catch_all"
  ) {
    return c.VERIFICATION_NEGATIVE_CACHE_TTL_MS;
  }
  return c.VERIFICATION_SOFT_FAILURE_CACHE_TTL_MS;
}

/** Stable key forms (e.g. `mx:example.com`, `disposable:tempmail.com`). */
export const cacheKeys = {
  mx: (domain: string) => `mx:${domain.toLowerCase()}`,
  domain: (domain: string) => `domain:${domain.toLowerCase()}`,
  dead: (domain: string) => `dead:${domain.toLowerCase()}`,
  disposable: (domain: string) => `disposable:${domain.toLowerCase()}`,
  role: (local: string) => `role:${local.toLowerCase()}`,
  catchall: (domain: string) => `catchall:${domain.toLowerCase()}`,
  providerCooldown: (id: string) => `provider-cooldown:${id}`,
  mxHealth: (host: string) => `mx-health:${host.toLowerCase()}`,
  mxPersistent: (domain: string) => `mx-persistent:${domain.toLowerCase()}`,
} as const;

// --- 1) MX (DNS) ---

/** Nx or empty MX list: cache as “dead path” for this domain; positive MX: jittered positive TTL. */
function ttlForMxValue(v: DnsCacheValue): number {
  const c = getConfig();
  if (v.nx || v.mx.length === 0) {
    return c.DEAD_DOMAIN_CACHE_TTL_MS;
  }
  return jitterTtlMs(c.MX_CACHE_TTL_MIN_MS, c.MX_CACHE_TTL_MAX_MS);
}

export function getCachedResult(emailKey: string): VerificationResult | undefined {
  if (!getConfig().CACHE_ENABLED) {
    return undefined;
  }
  if (useSqlite()) {
    return sql.sqliteGetResult(emailKey);
  }
  return getMemoryResultCache().get(emailKey);
}

export function setCachedResult(emailKey: string, v: VerificationResult): void {
  if (!getConfig().CACHE_ENABLED) {
    return;
  }
  const ttl = resultCacheTtlMs(v);
  if (useSqlite()) {
    sql.sqliteSetResult(emailKey, v, ttl);
    return;
  }
  getMemoryResultCache().set(emailKey, v, { ttl });
}

export function getCachedDns(domainKey: string): DnsCacheValue | undefined {
  if (useSqlite()) {
    return sql.sqliteGetDns(domainKey);
  }
  return getMemoryDnsCache().get(domainKey);
}

export function setCachedDns(domainKey: string, v: DnsCacheValue): void {
  const ttl = ttlForMxValue(v);
  if (useSqlite()) {
    sql.sqliteSetDns(domainKey, v, ttl);
    return;
  }
  getMemoryDnsCache().set(domainKey, v, { ttl });
}

export function deleteCachedDns(domainKey: string): void {
  if (useSqlite()) {
    sql.sqliteDeleteKey("mx:" + domainKey);
    sql.sqliteDeleteKey("dns:" + domainKey);
    return;
  }
  getMemoryDnsCache().delete(domainKey);
}

// --- 2) Domain exists ---

export function getDomainExistsCache(domain: string): DomainExistsCacheValue | undefined {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<DomainExistsCacheValue>(cacheKeys.domain(k));
  }
  return getMemoryDomainCache().get(k);
}

export function setDomainExistsCache(domain: string, v: DomainExistsCacheValue): void {
  const c = getConfig();
  const ttl = c.DOMAIN_EXISTS_CACHE_TTL_MS;
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.domain(k), { ...v, at: Date.now() }, ttl);
    return;
  }
  getMemoryDomainCache().set(k, { ...v, at: Date.now() }, { ttl });
}

// --- 8) Dead domain (short-circuit undeliverable) ---

export function getDeadDomainCache(domain: string): DeadDomainCacheValue | undefined {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<DeadDomainCacheValue>(cacheKeys.dead(k));
  }
  return getMemoryDeadCache().get(k);
}

export function setDeadDomainCache(domain: string, v: DeadDomainCacheValue): void {
  const c = getConfig();
  const ttl = c.DEAD_DOMAIN_CACHE_TTL_MS;
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.dead(k), v, ttl);
    return;
  }
  getMemoryDeadCache().set(k, v, { ttl });
}

// --- 3) Disposable ---

export function getDisposableCache(domain: string): DisposableCacheValue | undefined {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<DisposableCacheValue>(cacheKeys.disposable(k));
  }
  return getMemoryDisposableCache().get(k);
}

export function setDisposableCache(domain: string, v: DisposableCacheValue): void {
  const c = getConfig();
  const ttl = jitterTtlMs(c.DISPOSABLE_CACHE_TTL_MIN_MS, c.DISPOSABLE_CACHE_TTL_MAX_MS);
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.disposable(k), v, ttl);
    return;
  }
  getMemoryDisposableCache().set(k, v, { ttl });
}

// --- 4) Role (local part) ---

export function getRoleCache(localPart: string): RoleCacheValue | undefined {
  const k = localPart.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<RoleCacheValue>(cacheKeys.role(k));
  }
  return getMemoryRoleCache().get(k);
}

export function setRoleCache(localPart: string, v: RoleCacheValue): void {
  const c = getConfig();
  const ttl = c.ROLE_PREFIX_CACHE_TTL_MS;
  const k = localPart.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.role(k), v, ttl);
    return;
  }
  getMemoryRoleCache().set(k, v, { ttl });
}

// --- 5) Catch-all ---

export function getCatchAllCache(domain: string): CatchAllCacheValue | undefined {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<CatchAllCacheValue>(cacheKeys.catchall(k));
  }
  return getMemoryCatchAllCache().get(k);
}

export function setCatchAllCache(domain: string, v: CatchAllCacheValue): void {
  const c = getConfig();
  const ttl = jitterTtlMs(c.CATCHALL_CACHE_TTL_MIN_MS, c.CATCHALL_CACHE_TTL_MAX_MS);
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.catchall(k), v, ttl);
    return;
  }
  getMemoryCatchAllCache().set(k, v, { ttl });
}

// --- 6) Provider cooldown snapshot ---

export function getProviderCooldownCache(
  id: string
): ProviderCooldownCacheValue | undefined {
  const k = id.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<ProviderCooldownCacheValue>(cacheKeys.providerCooldown(k));
  }
  return getMemoryProviderCooldownCache().get(k);
}

export function setProviderCooldownCache(
  id: string,
  v: ProviderCooldownCacheValue,
  /** Prefer `Math.max(0, until - Date.now())`, capped. */
  ttlMs: number
): void {
  const c = getConfig();
  const cap = Math.min(Math.max(1, ttlMs), c.PROVIDER_COOLDOWN_CACHE_TTL_MAX_MS);
  const k = id.toLowerCase();
  const payload: ProviderCooldownCacheValue = { ...v, at: Date.now() };
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.providerCooldown(k), payload, cap);
    return;
  }
  getMemoryProviderCooldownCache().set(k, payload, { ttl: cap });
}

// --- 7) MX / SMTP health per host ---

export function getMxHealthCache(host: string): MxHealthCacheValue | undefined {
  const k = host.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<MxHealthCacheValue>(cacheKeys.mxHealth(k));
  }
  return getMemoryMxHealthCache().get(k);
}

export function setMxHealthCache(host: string, v: MxHealthCacheValue): void {
  const c = getConfig();
  const ttl = jitterTtlMs(c.SMTP_HEALTH_CACHE_TTL_MIN_MS, c.SMTP_HEALTH_CACHE_TTL_MAX_MS);
  const k = host.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.mxHealth(k), { ...v, host: k, at: Date.now() }, ttl);
    return;
  }
  getMemoryMxHealthCache().set(k, { ...v, host: k, at: Date.now() }, { ttl });
}

// --- Persistent MX unreachable (8 / overlap with dead) ---

export function getPersistentMxCache(domain: string): PersistentMxCacheValue | undefined {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    return sql.sqliteGetJson<PersistentMxCacheValue>(cacheKeys.mxPersistent(k));
  }
  return getMemoryPersistentMxCache().get(k);
}

export function setPersistentMxCache(domain: string, v: PersistentMxCacheValue): void {
  const c = getConfig();
  const ttl = jitterTtlMs(c.PERSISTENT_MX_CACHE_TTL_MIN_MS, c.PERSISTENT_MX_CACHE_TTL_MAX_MS);
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteSetJson(cacheKeys.mxPersistent(k), { ...v, at: Date.now() }, ttl);
    return;
  }
  getMemoryPersistentMxCache().set(k, { ...v, at: Date.now() }, { ttl });
}

export function clearPersistentMxCache(domain: string): void {
  const k = domain.toLowerCase();
  if (useSqlite()) {
    sql.sqliteDeleteKey(cacheKeys.mxPersistent(k));
    return;
  }
  getMemoryPersistentMxCache().delete(k);
}

// --- Admin ---

export type ClearCacheType =
  | "all"
  | "result"
  | "dns"
  | "mx"
  | "domain"
  | "dead"
  | "disposable"
  | "role"
  | "catchall"
  | "provider_cooldown"
  | "mx_health"
  | "mx_persistent";

export function clearCaches(type: ClearCacheType = "all"): void {
  if (useSqlite()) {
    if (type === "all") {
      sql.sqliteClearNamespace("all");
      return;
    }
    const map: Partial<Record<ClearCacheType, SqliteCacheNamespace>> = {
      result: "res",
      dns: "mx",
      mx: "mx",
      domain: "domain",
      dead: "dead",
      disposable: "disposable",
      role: "role",
      catchall: "catchall",
      provider_cooldown: "provider-cooldown",
      mx_health: "mx-health",
      mx_persistent: "mx-persistent",
    };
    const ns = map[type];
    if (ns) sql.sqliteClearNamespace(ns);
    return;
  }
  if (type === "all" || type === "dns" || type === "mx") {
    getMemoryDnsCache().clear();
  }
  if (type === "all" || type === "result") {
    getMemoryResultCache().clear();
  }
  if (type === "all" || type === "domain") {
    getMemoryDomainCache().clear();
  }
  if (type === "all" || type === "dead") {
    getMemoryDeadCache().clear();
  }
  if (type === "all" || type === "disposable") {
    getMemoryDisposableCache().clear();
  }
  if (type === "all" || type === "role") {
    getMemoryRoleCache().clear();
  }
  if (type === "all" || type === "catchall") {
    getMemoryCatchAllCache().clear();
  }
  if (type === "all" || type === "provider_cooldown") {
    getMemoryProviderCooldownCache().clear();
  }
  if (type === "all" || type === "mx_health") {
    getMemoryMxHealthCache().clear();
  }
  if (type === "all" || type === "mx_persistent") {
    getMemoryPersistentMxCache().clear();
  }
}

export function getCacheStats():
  | {
      backend: "memory";
      layers: {
        result: number;
        mx: number;
        domain: number;
        dead: number;
        disposable: number;
        role: number;
        catchall: number;
        providerCooldown: number;
        mxHealth: number;
        mxPersistent: number;
      };
      dnsSize: number;
      resultSize: number;
    }
  | { backend: "sqlite" } {
  if (useSqlite()) {
    return { backend: "sqlite" };
  }
  const layers = {
    result: getMemoryResultCache().size,
    mx: getMemoryDnsCache().size,
    domain: getMemoryDomainCache().size,
    dead: getMemoryDeadCache().size,
    disposable: getMemoryDisposableCache().size,
    role: getMemoryRoleCache().size,
    catchall: getMemoryCatchAllCache().size,
    providerCooldown: getMemoryProviderCooldownCache().size,
    mxHealth: getMemoryMxHealthCache().size,
    mxPersistent: getMemoryPersistentMxCache().size,
  };
  return {
    backend: "memory",
    layers,
    /** @deprecated use layers.mx */
    dnsSize: layers.mx,
    /** @deprecated use layers.result */
    resultSize: layers.result,
  };
}
