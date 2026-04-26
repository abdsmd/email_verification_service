import pLimit from "p-limit";
import { getConfig } from "../config/env.js";
import type { BigProviderId } from "../types/provider.types.js";

const limits = new Map<BigProviderId, ReturnType<typeof pLimit>>();

function limitFor(id: BigProviderId): ReturnType<typeof pLimit> {
  let lim = limits.get(id);
  if (!lim) {
    lim = pLimit(getConfig().MAX_CONCURRENT_PER_PROVIDER);
    limits.set(id, lim);
  }
  return lim;
}

export async function withProviderSmtpConcurrency<T>(
  provider: BigProviderId | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!provider || provider === "other") {
    return fn();
  }
  return limitFor(provider)(fn) as Promise<T>;
}

export function resetProviderSmtpConcurrencyForTests(): void {
  limits.clear();
}
