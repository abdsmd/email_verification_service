import { randomProbeLocalPart } from "../utils/random-localpart.js";
import { getCatchAllCache, setCatchAllCache } from "./cache.service.js";
import { detectBigProvider } from "./provider-classifier.service.js";
import { probeRcpt } from "./smtp.service.js";

export function buildRandomProbeAddress(domain: string): string {
  return `${randomProbeLocalPart()}@${domain}`;
}

export type CatchAllProbeResult =
  | { kind: "not_catch_all" }
  | { kind: "catch_all"; probe: string; rcpt: Awaited<ReturnType<typeof probeRcpt>> };

/**
 * Caches a definitive "not catch-all" per domain. Positive catch-all is not cached
 * (would require serializing the full RCPT; probe remains authoritative).
 */
export async function probeCatchAll(
  mxHosts: string[],
  domain: string,
  opts?: { forceRefresh?: boolean }
): Promise<CatchAllProbeResult> {
  if (!opts?.forceRefresh) {
    const c = getCatchAllCache(domain);
    if (c?.kind === "not_catch_all") {
      return { kind: "not_catch_all" };
    }
  }
  const randomEmail = buildRandomProbeAddress(domain);
  const { id: prov } = detectBigProvider(domain, mxHosts[0] ?? domain);
  const rcpt = await probeRcpt(mxHosts, { toAddress: randomEmail, provider: prov });
  if (rcpt.kind === "rcpt" && rcpt.class === "accept") {
    return { kind: "catch_all", probe: randomEmail, rcpt };
  }
  if (!opts?.forceRefresh) {
    setCatchAllCache(domain, { kind: "not_catch_all" });
  }
  return { kind: "not_catch_all" };
}
