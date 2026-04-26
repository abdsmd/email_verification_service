import type { VerificationResult } from "../types/verification.types.js";

const CODE_EXPLAIN: Partial<Record<VerificationResult["code"], string>> = {
  valid: "Recipient accepted at RCPT (probe); not a guarantee of inbox placement.",
  invalid: "Address failed basic structure or domain rules at syntax check.",
  dead: "Unusable format or local part rejected by local validation.",
  undeliverable: "No viable delivery path: DNS, MX, or SMTP indicates not routable or rejected.",
  unknown: "Inconclusive outcome (e.g. ambiguous SMTP response, partial data).",
  retry_later: "Transient: greylisting, throttling, or server asks to try again. Retry with backoff; not a final mailbox verdict.",
  greylisted: "Recipient server is temporarily deferring. Retry later.",
  mx_unreachable: "Could not use MX path from this host (DNS or connect path).",
  provider_blocked: "Station throttling to this large provider. Retry after cooldown window.",
  disposable: "Domain is on a disposable or throwaway list.",
  role_account: "Local part looks like a role or shared mailbox (e.g. info@).",
  catch_all: "Domain appears to accept arbitrary local parts (catch-all / wide acceptance).",
  system_error: "Internal failure. Retry or check station logs.",
};

/**
 * Human-readable one-liner and 0-100 **confidence in the current verdict** (not “inbox likelihood”).
 * Soft-failure / inconclusive codes use lower confidence.
 */
export function attachExplainAndConfidence(
  r: VerificationResult
): { explain: string; confidence: number } {
  const explain =
    CODE_EXPLAIN[r.code] ?? "Verification completed; see `code` and `details` for policy-specific reasons.";

  if (r.score !== undefined) {
    return { explain, confidence: Math.min(100, Math.max(0, Math.round(r.score))) };
  }
  const c = softConfidenceByCode(r.code, r);
  return { explain, confidence: c };
}

function softConfidenceByCode(code: VerificationResult["code"], r: VerificationResult): number {
  switch (code) {
    case "retry_later":
    case "greylisted":
    case "provider_blocked":
      return 35;
    case "unknown": {
      const msg = r.message?.toLowerCase() ?? "";
      if (msg.includes("smtp not executed")) {
        return 55;
      }
      return 40;
    }
    case "mx_unreachable":
      return 45;
    case "undeliverable":
    case "dead":
    case "invalid":
      return 88;
    case "disposable":
    case "role_account":
    case "catch_all":
      return 82;
    case "valid":
      return 85;
    case "system_error":
      return 0;
    default:
      return 50;
  }
}
