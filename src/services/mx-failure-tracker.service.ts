import { getConfig } from "../config/env.js";
import { clearPersistentMxCache } from "./cache.service.js";

/** Rolling timestamps of delivery-path failures (DNS/SMTP) per recipient domain. */
const eventsByDomain = new Map<string, number[]>();

function prune(array: number[], since: number): number[] {
  return array.filter((t) => t > since);
}

/**
 * Record one failure for this domain. Timeouts are not counted toward `mx_unreachable_persistent` (rule 6).
 * @returns { count, persistent } where persistent means non-timeout failures in window &gt;= threshold.
 */
export function recordMxPathFailure(
  domain: string,
  kind: "mx_host_dns" | "smtp" | "smtp_timeout"
): { count: number; persistent: boolean } {
  if (kind === "smtp_timeout") {
    return { count: 0, persistent: false };
  }
  const c = getConfig();
  const windowMs = c.MX_PERSISTENT_FAILURE_WINDOW_MS;
  const threshold = c.MX_PERSISTENT_FAILURE_THRESHOLD;
  const now = Date.now();
  const start = now - windowMs;
  const prev = eventsByDomain.get(domain.toLowerCase()) ?? [];
  const next = prune(prev, start);
  next.push(now);
  eventsByDomain.set(domain.toLowerCase(), next);
  return { count: next.length, persistent: next.length >= threshold };
}

export function clearMxPathFailures(domain: string): void {
  const k = domain.toLowerCase();
  eventsByDomain.delete(k);
  clearPersistentMxCache(k);
}

export function getMxFailureCountForTests(domain: string): number {
  return eventsByDomain.get(domain.toLowerCase())?.length ?? 0;
}

export function resetMxFailureTrackerForTests(): void {
  eventsByDomain.clear();
}
