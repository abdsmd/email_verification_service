import { getConfig } from "../config/env.js";
import { detectBigProvider, isFreeEmailProvider } from "./provider-classifier.service.js";
import type { DeliverabilityClass, VerificationCode, VerificationResult } from "../types/verification.types.js";

const BASE = {
  syntax: 10,
  domain: 10,
  mx: 20,
  smtpConnected: 15,
  mailboxAccepted: 35,
  mailboxRejected: -80,
  disposable: -40,
  role: -15,
  catchAll: -25,
  freeEmail: -5,
} as const;

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function deliverabilityFromScore(score: number): DeliverabilityClass {
  if (score >= 90) return "deliverable";
  if (score >= 60) return "risky";
  if (score >= 30) return "unknown";
  return "undeliverable";
}

function getReason(d: unknown): string | undefined {
  if (!d || typeof d !== "object" || !("reason" in d)) return undefined;
  const r = (d as { reason?: unknown }).reason;
  return typeof r === "string" ? r : undefined;
}

function shouldOmitScore(r: Pick<VerificationResult, "code" | "message" | "details">): boolean {
  if (r.code === "system_error") {
    return true;
  }
  if (r.code === "retry_later" || r.code === "greylisted" || r.code === "provider_blocked") {
    return true;
  }
  if (r.code === "unknown") {
    const reason = getReason(r.details);
    if (reason === "smtp_252") return true;
    if (r.message?.includes("SMTP not executed")) return false; // partial score
  }
  return false;
}

function inferFreeFromEmail(r: Pick<VerificationResult, "email" | "details">): boolean {
  const m = r.email?.match(/@([^\s@]+)\s*$/i);
  if (!m) return false;
  const dom = m[1].toLowerCase();
  const mxHint =
    r.details && typeof r.details === "object" && "mx" in r.details
      ? String((r.details as { mx?: string }).mx ?? dom)
      : dom;
  const { id } = detectBigProvider(dom, mxHint);
  return isFreeEmailProvider(id);
}

export type ScoreContext = { isFreeEmail?: boolean };

/**
 * Business rules + 0-100 point model. Omits `score` and `deliverability` when no final result (retry/soft).
 */
export function scoreVerificationResult(
  r: VerificationResult,
  ctx: ScoreContext = {}
): Pick<VerificationResult, "score" | "deliverability"> {
  if (shouldOmitScore(r)) {
    return {};
  }

  const free =
    ctx.isFreeEmail !== undefined
      ? ctx.isFreeEmail
      : r.code === "valid"
        ? inferFreeFromEmail(r)
        : false;

  const d = r.details;
  const reason = getReason(d);

  // ——— Overrides (classification + score) ———
  if (r.code === "dead") {
    return { score: 0, deliverability: "undeliverable" };
  }

  if (r.code === "undeliverable") {
    if (reason === "domain_invalid" || reason === "no_mx" || reason === "mx_lookup") {
      return { score: 0, deliverability: "undeliverable" };
    }
    if (reason === "mx_unreachable_persistent") {
      return { score: 0, deliverability: "undeliverable" };
    }
    if (
      reason === "smtp_550_553" ||
      reason === "reject_not_local" ||
      reason === "smtp_554" ||
      reason === "smtp_5xx"
    ) {
      const s = clamp0to100(
        BASE.syntax + BASE.domain + BASE.mx + BASE.smtpConnected + BASE.mailboxRejected
      );
      return { score: s, deliverability: "undeliverable" };
    }
    if (reason === "mx_unreachable") {
      return { score: 0, deliverability: "undeliverable" };
    }
    return { score: 0, deliverability: "undeliverable" };
  }

  if (r.code === "invalid") {
    const s = clamp0to100(
      BASE.syntax + BASE.domain + BASE.mx + BASE.smtpConnected + BASE.mailboxRejected
    );
    return { score: s, deliverability: "undeliverable" };
  }

  if (r.code === "valid") {
    let s = BASE.syntax + BASE.domain + BASE.mx + BASE.smtpConnected + BASE.mailboxAccepted;
    if (free) s += BASE.freeEmail;
    s = clamp0to100(s);
    return { score: s, deliverability: deliverabilityFromScore(s) };
  }

  if (r.code === "catch_all") {
    const s = clamp0to100(
      BASE.syntax +
        BASE.domain +
        BASE.mx +
        BASE.smtpConnected +
        BASE.mailboxAccepted +
        BASE.catchAll
    );
    return { score: s, deliverability: "risky" };
  }

  if (r.code === "role_account") {
    if (getConfig().ROLE_ACCOUNT_DELIVERABILITY === "undeliverable") {
      return { score: 0, deliverability: "undeliverable" };
    }
    const s = clamp0to100(BASE.syntax + BASE.domain + BASE.mx + BASE.role);
    return { score: s, deliverability: deliverabilityFromScore(s) };
  }

  if (r.code === "disposable") {
    const mode = getConfig().DISPOSABLE_DELIVERABILITY;
    if (mode === "undeliverable") {
      return { score: 0, deliverability: "undeliverable" };
    }
    return { score: 65, deliverability: "risky" };
  }

  if (r.code === "unknown") {
    if (r.message?.includes("MX OK; SMTP not executed")) {
      const s = clamp0to100(BASE.syntax + BASE.domain + BASE.mx);
      return { score: s, deliverability: deliverabilityFromScore(s) };
    }
    const s = clamp0to100(40);
    return { score: s, deliverability: "unknown" };
  }

  if (r.code === "mx_unreachable") {
    return { score: 25, deliverability: "undeliverable" };
  }

  const s = clamp0to100(30);
  return { score: s, deliverability: "unknown" };
}

export function addScoreToResult<T extends VerificationResult>(
  r: T,
  ctx?: ScoreContext
): T & { score?: number; deliverability?: DeliverabilityClass } {
  const out = scoreVerificationResult(r, ctx);
  if (out.score === undefined && out.deliverability === undefined) {
    const { score: _sc, deliverability: _dc, ...rest } = r;
    return { ...rest } as T & { score?: number; deliverability?: DeliverabilityClass };
  }
  return { ...r, ...out };
}

/**
 * @deprecated use scoreVerificationResult; kept for quick comparisons in tests
 */
export function scoreForCode(code: VerificationCode): number {
  const x = scoreVerificationResult({ email: "x@y.z", code, details: {} } as VerificationResult);
  return x.score ?? 0;
}