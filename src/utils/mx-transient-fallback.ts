import type { RcptResult } from "../types/smtp.types.js";

/**
 * When the first MX returns a **transient** SMTP RCPT outcome, optionally probe the
 * next MX (strictly capped) — off by default; never used for "big" freemail in verifyOne.
 */
export function isTransientRcptSuitableForNextMx(r: RcptResult): boolean {
  if (r.kind !== "rcpt") {
    return false;
  }
  if (r.class === "provider_block" || (r.class === "temporary" && r.providerBlock)) {
    return false;
  }
  if (r.class === "accept" || r.semantic === "mailbox_ok" || r.semantic === "accept_deferred") {
    return false;
  }
  if (r.class === "permanent_reject") {
    return false;
  }
  if (r.class === "temporary") {
    return true;
  }
  if (
    r.semantic === "temp_mailbox" ||
    r.semantic === "temp_local" ||
    r.semantic === "service_unavailable" ||
    r.semantic === "insufficient_storage" ||
    r.semantic === "limit_exceeded"
  ) {
    return true;
  }
  return false;
}

export function canTryAnotherMxForTransient(args: {
  mxi: number;
  mxCount: number;
  extraTriesSoFar: number;
  maxExtra: number;
}): boolean {
  if (args.mxi >= args.mxCount - 1) {
    return false;
  }
  if (args.extraTriesSoFar >= args.maxExtra) {
    return false;
  }
  return true;
}
