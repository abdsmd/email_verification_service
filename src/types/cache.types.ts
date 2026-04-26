import type { VerificationResult } from "./verification.types.js";

/** mx: & legacy dns: — NS/MX answer summary */
export type DnsCacheValue = { mx: { exchange: string; priority: number }[]; nx: boolean };

/** domain: — apex exists in public DNS (not necessarily routable to mail) */
export type DomainExistsCacheValue = { exists: true; at: number };

/** dead: — prior verification: bad domain / path */
export type DeadDomainCacheValue = {
  result: VerificationResult;
  reason: "domain_invalid" | "no_mx" | "mx_unreachable_persistent" | "undeliverable";
};

/** disposable: — long-lived positive (domain is disposable) */
export type DisposableCacheValue = { v: true };

/** role: — local part is a role/generic account */
export type RoleCacheValue = { v: true };

export type CatchAllCacheValue = { kind: "not_catch_all" } | { kind: "catch_all"; probe: string };

export type ProviderCooldownCacheValue = { until: number; blockCount: number; at: number };

export type MxHealthCacheValue = {
  host: string;
  status: "ok" | "degraded" | "fail";
  at: number;
  socketReason?: string;
};

export type PersistentMxCacheValue = { persistent: true; at: number };

export type CacheLayerId =
  | "mx"
  | "domain"
  | "dead"
  | "disposable"
  | "role"
  | "catchall"
  | "provider_cooldown"
  | "mx_health"
  | "mx_persistent"
  | "result";
