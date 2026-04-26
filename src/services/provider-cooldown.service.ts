import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import type { BigProviderId } from "../types/provider.types.js";
import { isMajorFreeMailProvider } from "./provider-classifier.service.js";
import type { RcptResult } from "../types/smtp.types.js";
import * as coolSql from "../repositories/cooldown-persist.repository.js";
import { getSqliteDb } from "../repositories/sqlite-cache.repository.js";
import { setProviderCooldownCache } from "./cache.service.js";

const log = getLogger();

/*
 * Per-(big)provider throttling: two mechanisms—(1) hard “until” after `bumpCooldown` when
 * policy/421/repeated-temp/timeouts show abuse; (2) sliding windows: repeated SMTP timeouts
 * or repeated 450/451 (greylist) or “unknown” protocol bursts in a short window also bump.
 * `durationForTier` implements exponential-style backoff: first block ≈15m, then 1h, 4h, then
 * long windows (jittered so fleet probes don’t align). `blockCount` rises on each `bumpCooldown`.
 */
const TIMEOUT_WINDOW_MS = 10 * 60 * 1000;
const REPEATED_TIMEOUTS = 2;
const TEMP_WINDOW_MS = 10 * 60 * 1000;
const REPEATED_TEMP = 2;
const UNKNOWN_WINDOW_MS = 2 * 60 * 1000;
const UNKNOWN_BURST = 5;

const RATE_OR_POLICY = [
  /rate[\s-]*limit/i,
  /too\s*many\s*connections?/i,
  /exceed.{0,12}connection/i,
  /concurrent.{0,12}connection/i,
  /blocked/i,
  /not\s*allowed/i,
  /reputation/i,
  /policy/i,
  /rbl/i,
  /greylist/gi, // "greylist" in body still counts as soft signal; repeated handled separately
];

type CoolState = {
  until: number;
  lastSmtpAt: number;
  blockCount: number;
  timeoutStamps: number[];
  temp451Stamps: number[];
  unknownStamps: number[];
};

const state = new Map<BigProviderId, CoolState>();
let moduleInitialized = false;

function withJitter(baseMs: number): number {
  return Math.floor(baseMs * (0.85 + Math.random() * 0.3));
}

/** Jittered wall-clock duration for the *next* `until` after `bumpCooldown` (tier by blockCount). */
function durationForTier(blockCount: number): number {
  if (blockCount <= 1) {
    return withJitter(15 * 60 * 1000);
  }
  if (blockCount === 2) {
    return withJitter(60 * 60 * 1000);
  }
  if (blockCount === 3) {
    return withJitter(4 * 60 * 60 * 1000);
  }
  const min = 12 * 60 * 60 * 1000;
  const spread = 12 * 60 * 60 * 1000;
  return min + Math.floor(Math.random() * spread);
}

function pruneWindow(stamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  return stamps.filter((t) => t > cutoff);
}

function getOrInit(provider: BigProviderId): CoolState {
  let s = state.get(provider);
  if (!s) {
    s = {
      until: 0,
      lastSmtpAt: 0,
      blockCount: 0,
      timeoutStamps: [],
      temp451Stamps: [],
      unknownStamps: [],
    };
    state.set(provider, s);
  }
  return s;
}

function persistIfEnabled(provider: BigProviderId): void {
  if (!getConfig().PROVIDER_COOLDOWN_PERSIST) {
    return;
  }
  try {
    getSqliteDb();
    const s = state.get(provider);
    if (!s) return;
    coolSql.upsertCooldownRow({
      provider,
      untilMs: s.until,
      blockCount: s.blockCount,
      lastSmtpAtMs: s.lastSmtpAt,
    });
  } catch (e) {
    log.error({ err: e, provider }, "cooldown persist failed");
  }
}

export function initializeProviderCooldownModule(): void {
  if (moduleInitialized) {
    return;
  }
  moduleInitialized = true;
  if (!getConfig().PROVIDER_COOLDOWN_PERSIST) {
    return;
  }
  try {
    getSqliteDb();
    const rows = coolSql.loadCooldownRowsFromSqlite();
    const now = Date.now();
    for (const r of rows) {
      if (r.provider === "other") {
        continue;
      }
      const s = getOrInit(r.provider);
      s.until = r.untilMs;
      s.blockCount = r.blockCount;
      s.lastSmtpAt = r.lastSmtpAtMs;
      if (s.until <= now && s.blockCount > 0) {
        // expired: keep blockCount for escalation memory; trim until
        s.until = 0;
      }
      if (r.untilMs > now) {
        setProviderCooldownCache(
          r.provider,
          { until: r.untilMs, blockCount: r.blockCount, at: now },
          r.untilMs - now
        );
      }
    }
    log.info({ rows: rows.length }, "provider cooldown loaded from sqlite");
  } catch (e) {
    log.error({ err: e }, "provider cooldown load failed");
  }
}

function bumpCooldown(
  provider: BigProviderId,
  reason: string
): { until: number; blockCount: number; durationMs: number } {
  const s = getOrInit(provider);
  s.blockCount += 1;
  const duration = durationForTier(s.blockCount);
  const now = Date.now();
  s.until = now + duration;
  log.warn(
    {
      provider,
      reason,
      blockCount: s.blockCount,
      until: new Date(s.until).toISOString(),
      durationMs: duration,
    },
    "provider cooldown applied"
  );
  persistIfEnabled(provider);
  setProviderCooldownCache(provider, { until: s.until, blockCount: s.blockCount, at: now }, s.until - now);
  return { until: s.until, blockCount: s.blockCount, durationMs: duration };
}

export function isProviderSmtpBlocked(
  provider: BigProviderId
): { blocked: true; until: number; blockCount: number } | { blocked: false } {
  if (!getConfig().PROVIDER_COOLDOWN_ENABLED) {
    return { blocked: false };
  }
  if (provider === "other") {
    return { blocked: false };
  }
  const s = state.get(provider);
  const now = Date.now();
  if (s && s.until > now) {
    return { blocked: true, until: s.until, blockCount: s.blockCount };
  }
  return { blocked: false };
}

/** @deprecated use applyCooldownFromSmtpResponse / network hooks */
export function markProviderCooling(provider: BigProviderId, reason: string): { until: number } {
  if (provider === "other") {
    return { until: 0 };
  }
  return bumpCooldown(provider, reason);
}

export function recordProviderSmtpUse(provider: BigProviderId): void {
  if (provider === "other") {
    return;
  }
  const now = Date.now();
  const s = getOrInit(provider);
  s.lastSmtpAt = now;
  persistIfEnabled(provider);
}

export function providerSmtpAllowNow(
  provider: BigProviderId
): { ok: true } | { waitMs: number } {
  if (provider === "other") {
    return { ok: true };
  }
  const c = getConfig();
  let gap = c.BIG_PROVIDER_SMTP_MIN_INTERVAL_MS;
  if (gap <= 0) {
    return { ok: true };
  }
  if (isMajorFreeMailProvider(provider)) {
    gap = Math.max(gap, c.MAJOR_FREE_MAIL_PROVIDERS_MIN_INTERVAL_MS);
  }
  const s = state.get(provider);
  if (!s) {
    return { ok: true };
  }
  const elapsed = Date.now() - s.lastSmtpAt;
  if (s.lastSmtpAt && elapsed < gap) {
    return { waitMs: gap - elapsed };
  }
  return { ok: true };
}

/**
 * Network-layer SMTP (probe): timeouts, refusals, reset.
 */
export function recordSmtpNetworkFailure(
  provider: BigProviderId,
  ev: {
    kind: "timeout" | "connect_refused" | "connect_reset" | "connect_error";
    message?: string;
    errno?: string;
  }
): void {
  if (provider === "other") {
    return;
  }
  const now = Date.now();
  const s = getOrInit(provider);

  if (ev.kind === "timeout") {
    s.timeoutStamps = pruneWindow(s.timeoutStamps, TIMEOUT_WINDOW_MS, now);
    s.timeoutStamps.push(now);
    if (s.timeoutStamps.length >= REPEATED_TIMEOUTS) {
      bumpCooldown(provider, "repeated_smtp_timeout");
      s.timeoutStamps = [];
    }
    return;
  }

  if (
    ev.kind === "connect_refused" ||
    ev.kind === "connect_reset" ||
    ev.kind === "connect_error" ||
    ev.errno === "ECONNREFUSED" ||
    ev.errno === "ECONNRESET" ||
    ev.errno === "EPIPE" ||
    ev.errno === "ECONNABORTED" ||
    ev.errno === "ETIMEDOUT"
  ) {
    bumpCooldown(
      provider,
      ev.errno
        ? `smtp_connect_${ev.errno}`
        : ev.kind
    );
  }
}

/**
 * Application-layer: RCPT/MAIL lines and classification.
 */
export function recordSmtpApplicationResult(provider: BigProviderId, r: RcptResult): void {
  if (provider === "other" || r.kind !== "rcpt") {
    return;
  }
  const now = Date.now();
  const s = getOrInit(provider);
  const text = r.text;
  const code = r.code;

  if (r.class === "provider_block" || (r.class === "temporary" && r.providerBlock)) {
    bumpCooldown(provider, "smtp_policy_block");
    return;
  }

  for (const p of RATE_OR_POLICY) {
    if (p.test(text) && (code >= 400 || r.class === "temporary" || r.class === "permanent_reject")) {
      bumpCooldown(provider, "smtp_rate_or_policy_text");
      return;
    }
  }

  if (code === 421) {
    bumpCooldown(provider, "smtp_421");
    return;
  }

  if (code === 450 || code === 451) {
    s.temp451Stamps = pruneWindow(s.temp451Stamps, TEMP_WINDOW_MS, now);
    s.temp451Stamps.push(now);
    if (s.temp451Stamps.length >= REPEATED_TEMP) {
      bumpCooldown(provider, "repeated_450_451");
      s.temp451Stamps = [];
    }
    return;
  }

  if (r.class === "protocol_error") {
    s.unknownStamps = pruneWindow(s.unknownStamps, UNKNOWN_WINDOW_MS, now);
    s.unknownStamps.push(now);
    if (s.unknownStamps.length >= UNKNOWN_BURST) {
      bumpCooldown(provider, "unknown_response_burst");
      s.unknownStamps = [];
    }
  }
}

export function getAllCooldowns(): Record<
  string,
  { untilIso: string; lastSmtpAtIso: string; blockCount: number; active: boolean }
> {
  const now = Date.now();
  const out: Record<string, { untilIso: string; lastSmtpAtIso: string; blockCount: number; active: boolean }> = {};
  for (const [k, v] of state) {
    out[k] = {
      untilIso: new Date(v.until).toISOString(),
      lastSmtpAtIso: new Date(v.lastSmtpAt).toISOString(),
      blockCount: v.blockCount,
      active: v.until > now,
    };
  }
  return out;
}

export function resetProviderCooldown(id: BigProviderId | undefined): void {
  if (!id) {
    state.clear();
    if (getConfig().PROVIDER_COOLDOWN_PERSIST) {
      try {
        getSqliteDb();
        coolSql.clearCooldownTable();
      } catch {
        // ignore
      }
    }
    return;
  }
  state.delete(id);
  if (getConfig().PROVIDER_COOLDOWN_PERSIST) {
    try {
      getSqliteDb();
      coolSql.deleteCooldownRow(id);
    } catch {
      // ignore
    }
  }
}

export function resetProviderStateForTests(): void {
  state.clear();
  moduleInitialized = false;
  try {
    if (getConfig().PROVIDER_COOLDOWN_PERSIST) {
      getSqliteDb();
      coolSql.clearCooldownTable();
    }
  } catch {
    // ignore
  }
}

export function getProviderCooldownIso(provider: BigProviderId): string | undefined {
  if (provider === "other") {
    return undefined;
  }
  const s = state.get(provider);
  if (!s || s.until <= Date.now()) {
    return undefined;
  }
  return new Date(s.until).toISOString();
}
