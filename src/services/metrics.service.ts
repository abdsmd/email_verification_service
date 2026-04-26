import { getConfig } from "../config/env.js";

const m = {
  verifyTotal: 0,
  verifyBatch: 0,
  errors: 0,
  startedAt: Date.now(),
};

export function incVerify(): void {
  if (!getConfig().METRICS_ENABLED) return;
  m.verifyTotal += 1;
}

export function incBatch(): void {
  if (!getConfig().METRICS_ENABLED) return;
  m.verifyBatch += 1;
}

export function incError(): void {
  if (!getConfig().METRICS_ENABLED) return;
  m.errors += 1;
}

export function getMetricsSnapshot() {
  return { ...m, uptimeMs: Date.now() - m.startedAt };
}

export function resetMetricsForTests(): void {
  m.verifyTotal = 0;
  m.verifyBatch = 0;
  m.errors = 0;
  m.startedAt = Date.now();
}
