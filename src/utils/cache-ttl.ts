/**
 * Jittered TTL in [minMs, maxMs] (inclusive bounds on random step).
 * Used so independent workers don't expire identical keys at the same second.
 */
export function jitterTtlMs(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}
