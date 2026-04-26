import pLimit from "p-limit";
import { getConfig } from "../config/env.js";

let limit: ReturnType<typeof pLimit> | null = null;

export function getVerifyLimiter() {
  if (!limit) {
    limit = pLimit(getConfig().MAX_CONCURRENCY);
  }
  return limit;
}

export function resetLimiterForTests(): void {
  limit = null;
}
