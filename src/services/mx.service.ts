import dns from "node:dns/promises";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { TimeoutError, withTimeout } from "../utils/timeout.js";
import { getCachedDns, setCachedDns, deleteCachedDns } from "./cache.service.js";

const log = getLogger();

/*
 * DNS MX for a domain: `ok` = records present; `no_mx` = name exists but no MX/empty (ENODATA/empty
 * set); `nxdomain` = no such domain; `error` = lookup failure (distinguished transient vs not for
 * retry policy). A/AAAA checks on each MX host are separate (`checkMxExchangesAddressable`).
 */
export type MxLookupResult =
  | { kind: "ok"; records: { exchange: string; priority: number }[] }
  | { kind: "no_mx" }
  | { kind: "nxdomain" }
  | { kind: "error"; message: string; code?: string; transient: boolean };

/** Result of A/AAAA checks on MX hostnames. When ok, `routableExchanges` is the priority-ordered subset that resolve. */
export type MxHostAddressability =
  | { kind: "ok"; routableExchanges: string[] }
  | { kind: "all_failed"; anyTransient: boolean; reason: "mx_unreachable" };

/** Public for tests: normalize priority + strip trailing dot on exchanges. */
export function normalizeMxRecords(
  records: { exchange: string; priority: number }[]
): { exchange: string; priority: number }[] {
  return [...records]
    .map((r) => ({
      exchange: r.exchange.replace(/\.$/, "").toLowerCase(),
      priority: r.priority,
    }))
    .sort((a, b) => a.priority - b.priority);
}

export async function lookupMx(domain: string, forceRefresh: boolean): Promise<MxLookupResult> {
  const c = getConfig();
  const key = domain.toLowerCase();
  if (forceRefresh) {
    deleteCachedDns(key);
  }
  const hit = getCachedDns(key);
  if (hit) {
    if (hit.nx) return { kind: "nxdomain" };
    if (hit.mx.length === 0) return { kind: "no_mx" };
    return { kind: "ok", records: hit.mx };
  }

  for (let attempt = 0; attempt <= c.DNS_RETRIES; attempt++) {
    try {
      const raw = await withTimeout(
        dns.resolveMx(domain),
        c.DNS_TIMEOUT_MS,
        "dns.resolveMx"
      );
      const norm = normalizeMxRecords(raw);
      if (norm.length === 0) {
        setCachedDns(key, { mx: [], nx: false });
        return { kind: "no_mx" };
      }
      setCachedDns(key, { mx: norm, nx: false });
      return { kind: "ok", records: norm };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.name === "TimeoutError" || (e as { name?: string }).name === "TimeoutError") {
        if (attempt === c.DNS_RETRIES) {
          return {
            kind: "error",
            message: (e as Error).message,
            code: "TIMEOUT",
            transient: true,
          };
        }
        continue;
      }
      if (err.code === "ENOTFOUND" || err.code === "EAI_NONAME") {
        setCachedDns(key, { mx: [], nx: true });
        return { kind: "nxdomain" };
      }
      /** No MX record set for this name (name exists, RR type empty). Not the same as SERVFAIL. */
      if (err.code === "ENODATA") {
        setCachedDns(key, { mx: [], nx: false });
        return { kind: "no_mx" };
      }
      log.warn({ err, domain, attempt }, "dns.resolveMx failed");
      if (attempt === c.DNS_RETRIES) {
        const transient = err.code === "ESERVFAIL" || err.code === "EAI_AGAIN" || err.code === "ETIMEOUT" || !err.code;
        return { kind: "error", message: err.message, code: err.code, transient };
      }
    }
  }
  return { kind: "error", message: "dns exhausted", transient: true };
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}

/** Returns whether this MX host has at least one A or AAAA, or classifies the failure. */
export async function resolveMxHostAddrs(exchange: string, timeoutMs: number): Promise<{
  hasAddr: boolean;
  transient: boolean;
}> {
  const host = exchange.toLowerCase();
  const errors: { code?: string; isTimeout: boolean }[] = [];
  for (const [fn, label] of [
    [() => dns.resolve4(host), "A" as const],
    [() => dns.resolve6(host), "AAAA" as const],
  ] as const) {
    try {
      const addrs = await withTimeout(fn(), timeoutMs, `dns.resolve ${label} ${host}`);
      if (addrs.length > 0) return { hasAddr: true, transient: false };
    } catch (e) {
      if (e instanceof TimeoutError || (e as { name?: string }).name === "TimeoutError") {
        errors.push({ isTimeout: true });
        continue;
      }
      const code = isErrnoException(e) ? e.code : undefined;
      errors.push({ code, isTimeout: false });
    }
  }
  const anyTimeout = errors.some((x) => x.isTimeout);
  const codes = errors.map((x) => x.code).filter((c): c is string => typeof c === "string");
  if (anyTimeout) return { hasAddr: false, transient: true };
  if (codes.length >= 2 && codes.every((c) => c === "ENOTFOUND" || c === "EAI_NONAME" || c === "ENODATA")) {
    return { hasAddr: false, transient: false };
  }
  if (codes.some((c) => c === "ESERVFAIL" || c === "EAI_AGAIN")) {
    return { hasAddr: false, transient: true };
  }
  return { hasAddr: false, transient: true };
}

/** Rule 3: every MX host must resolve (A and/or AAAA). Any transient error → retry; all permanent → undeliverable. */
export async function checkMxExchangesAddressable(exchanges: string[]): Promise<MxHostAddressability> {
  if (exchanges.length === 0) {
    return { kind: "all_failed", anyTransient: true, reason: "mx_unreachable" };
  }
  const c = getConfig();
  const t = c.MX_HOST_DNS_TIMEOUT_MS;
  const routable: string[] = [];
  let anyTransient = false;
  let anyPermanent = false;
  for (const ex of exchanges) {
    const { hasAddr, transient } = await resolveMxHostAddrs(ex, t);
    if (hasAddr) {
      routable.push(ex);
    } else {
      if (transient) anyTransient = true;
      else anyPermanent = true;
    }
  }
  if (routable.length > 0) return { kind: "ok", routableExchanges: routable };
  if (anyTransient) return { kind: "all_failed", anyTransient: true, reason: "mx_unreachable" };
  if (anyPermanent) {
    return { kind: "all_failed", anyTransient: false, reason: "mx_unreachable" };
  }
  return { kind: "all_failed", anyTransient: true, reason: "mx_unreachable" };
}

export { TimeoutError };
