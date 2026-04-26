import { getConfig } from "../config/env.js";

const m = {
  verifyTotal: 0,
  verifyBatch: 0,
  errors: 0,
  /** Count of verify (single) with duration over SLOW_REQUEST_THRESHOLD_MS */
  verifySlowTotal: 0,
  startedAt: Date.now(),
  /** By tenant id (or `default` / `unknown`) */
  verifyByTenant: new Map<string, number>(),
  batchByTenant: new Map<string, number>(),
  /** Rows processed in POST /v1/verify/batch (sum of items) */
  batchRowsByTenant: new Map<string, number>(),
  /** Ring buffer of last N verify durations (ms) for p50/p95 (single /verify only) */
  latencies: [] as number[],
};

function ringPush(ms: number): void {
  const cap = getConfig().METRICS_LATENCIES_MAX;
  m.latencies.push(ms);
  if (m.latencies.length > cap) {
    m.latencies = m.latencies.slice(-cap);
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

function pxx(arr: number[], p: number): number | null {
  if (arr.length === 0) {
    return null;
  }
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, p);
}

function bump(map: Map<string, number>, key: string, n: number = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

export function incVerify(tenantId?: string): void {
  if (!getConfig().METRICS_ENABLED) {
    return;
  }
  m.verifyTotal += 1;
  bump(m.verifyByTenant, tenantId ?? "unknown", 1);
}

export function incBatch(tenantId?: string): void {
  if (!getConfig().METRICS_ENABLED) {
    return;
  }
  m.verifyBatch += 1;
  bump(m.batchByTenant, tenantId ?? "unknown", 1);
}

export function incBatchRows(tenantId: string | undefined, rowCount: number): void {
  if (!getConfig().METRICS_ENABLED) {
    return;
  }
  if (rowCount <= 0) {
    return;
  }
  bump(m.batchRowsByTenant, tenantId ?? "unknown", rowCount);
}

export function incError(): void {
  if (!getConfig().METRICS_ENABLED) {
    return;
  }
  m.errors += 1;
}

export function recordVerifyDuration(_tenantId: string | undefined, durationMs: number): void {
  if (!getConfig().METRICS_ENABLED) {
    return;
  }
  const thr = getConfig().SLOW_REQUEST_THRESHOLD_MS;
  if (durationMs > thr) {
    m.verifySlowTotal += 1;
  }
  ringPush(durationMs);
}

export function getMetricsSnapshot() {
  const c = getConfig();
  const lat = m.latencies;
  return {
    verifyTotal: m.verifyTotal,
    verifyBatch: m.verifyBatch,
    errors: m.errors,
    verifySlowTotal: m.verifySlowTotal,
    startedAt: m.startedAt,
    verifyByTenant: Object.fromEntries(m.verifyByTenant),
    batchByTenant: Object.fromEntries(m.batchByTenant),
    batchRowsByTenant: Object.fromEntries(m.batchRowsByTenant),
    uptimeMs: Date.now() - m.startedAt,
    verifyDurationMs: {
      samples: lat.length,
      p50: pxx(lat, 0.5),
      p95: pxx(lat, 0.95),
      p99: pxx(lat, 0.99),
    },
    slowRequestThresholdMs: c.SLOW_REQUEST_THRESHOLD_MS,
  };
}

/** Per-tenant billable/usage view for GET /v1/usage (same process lifetime). */
export function getTenantUsage(tenantId: string) {
  const c = getConfig();
  if (!c.METRICS_ENABLED) {
    return null;
  }
  return {
    tenantId,
    postVerify: m.verifyByTenant.get(tenantId) ?? 0,
    postBatch: m.batchByTenant.get(tenantId) ?? 0,
    batchRows: m.batchRowsByTenant.get(tenantId) ?? 0,
  };
}

export function resetMetricsForTests(): void {
  m.verifyTotal = 0;
  m.verifyBatch = 0;
  m.errors = 0;
  m.verifySlowTotal = 0;
  m.startedAt = Date.now();
  m.verifyByTenant.clear();
  m.batchByTenant.clear();
  m.batchRowsByTenant.clear();
  m.latencies = [];
}
