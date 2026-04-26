import { getLogger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { normalizeEmail } from "../utils/normalize-email.js";
import type { VerificationResult } from "../types/verification.types.js";
import type { BigProviderId } from "../types/provider.types.js";
import {
  getCachedResult,
  setCachedResult,
  getDeadDomainCache,
  getDisposableCache,
  getPersistentMxCache,
  getRoleCache,
  setDeadDomainCache,
  setDomainExistsCache,
  setDisposableCache,
  setPersistentMxCache,
  setRoleCache,
} from "./cache.service.js";
import { ensureDisposableListLoaded, isDisposableDomainSync } from "./disposable.service.js";
import { ensureRolePrefixesLoaded, isRoleLocalPart } from "./role.service.js";
import { parseEmail } from "./syntax.service.js";
import { lookupMx, checkMxExchangesAddressable } from "./mx.service.js";
import { clearMxPathFailures, recordMxPathFailure } from "./mx-failure-tracker.service.js";
import { detectBigProvider, isFreeEmailProvider } from "./provider-classifier.service.js";
import {
  isProviderSmtpBlocked,
  providerSmtpAllowNow,
  recordProviderSmtpUse,
  recordSmtpApplicationResult,
  getProviderCooldownIso,
} from "./provider-cooldown.service.js";
import { probeCatchAll } from "./catchall.service.js";
import { probeRcpt } from "./smtp.service.js";
import { mapSmtpSocketErrno } from "./smtp-code-parser.service.js";
import type { RcptResult, SmtpSocketErrorReason } from "../types/smtp.types.js";
import { addScoreToResult } from "./scoring.service.js";
import { incError } from "./metrics.service.js";
import { toErrorMessage } from "../utils/safe-error.js";
import { getConfig } from "../config/env.js";
import { redactEmailForLog } from "../utils/log-email.js";

const log = getLogger();

type Opts = {
  skipSmtp?: boolean;
  skipCatchAll?: boolean;
  forceRefresh?: boolean;
};

function nowIso(until: number) {
  return new Date(until).toISOString();
}

/**
 * When result is retry_later, count toward persistent-undeliverable unless kind is `smtp_timeout` (rule 6).
 */
function withMxPersistent(
  domain: string,
  base: VerificationResult,
  kind: "mx_host_dns" | "smtp" | "smtp_timeout"
): VerificationResult {
  if (base.code !== "retry_later") return base;
  const { persistent } = recordMxPathFailure(domain, kind);
  if (!persistent) return base;
  const u: VerificationResult = {
    ...base,
    code: "undeliverable",
    message: "Delivery path has repeatedly failed; treated as not routable at this time",
    details: { ...base.details, reason: "mx_unreachable_persistent" as const, layer: "mx" as const },
  };
  setDeadDomainCache(domain, { result: addScoreToResult(u), reason: "mx_unreachable_persistent" });
  setPersistentMxCache(domain, { persistent: true, at: Date.now() });
  return u;
}

/**
 * Turn SMTP probe outcome into a verification code. 4xx / greylist / 421 / 452 and many 5xx
 * policy cases map to `retry_later` or `greylisted`—*not* `undeliverable` / `invalid`—so
 * temporary infrastructure or greylisting is not conflated with a definite bad mailbox. Only
 * stable mailbox rejects (e.g. 550/553 semantics, 554) become `undeliverable` where appropriate.
 */
function mapSmtpToResult(
  email: string,
  domain: string,
  provider: BigProviderId,
  r: RcptResult
): VerificationResult {
  if (r.kind === "all_mx_failed") {
    return withMxPersistent(
      domain,
      {
        email,
        code: "retry_later",
        message: "No MX completed SMTP; retry later",
        details: { layer: "smtp", reason: "smtp_connect_failed" as const },
      },
      "smtp"
    );
  }
  if (r.kind === "mx_fail") {
    const sk: SmtpSocketErrorReason =
      r.smtpSocketReason ?? mapSmtpSocketErrno(r.error, r.errno);
    if (r.error === "timeout" || sk === "smtp_timeout") {
      return {
        email,
        code: "retry_later",
        message: r.message,
        details: { layer: "smtp", reason: sk, error: r.error, errno: r.errno },
      };
    }
    if (r.error === "connect") {
      return withMxPersistent(
        domain,
        {
          email,
          code: "retry_later",
          message: r.message,
          details: { layer: "smtp", reason: sk, error: r.error, errno: r.errno },
        },
        "smtp"
      );
    }
    return withMxPersistent(
      domain,
      {
        email,
        code: "retry_later",
        message: r.message,
        details: {
          layer: "smtp",
          reason: "smtp_protocol" as const,
          error: r.error,
          errno: r.errno,
        },
      },
      "smtp"
    );
  }

  recordSmtpApplicationResult(provider, r);
  const cd = getProviderCooldownIso(provider);

  // Transient / policy (rate limit, RBL, "blocked") — always retry_later, never undeliverable/invalid
  if (r.class === "provider_block" || (r.class === "temporary" && r.providerBlock)) {
    return {
      email,
      code: "retry_later",
      message: r.text,
      details: { smtp: r.code, reason: "provider_smtp" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }

  if (r.semantic === "mailbox_ok" || r.class === "accept") {
    clearMxPathFailures(domain);
    return {
      email,
      code: "valid",
      message: "RCPT accept",
      details: { smtp: r.code, semantic: r.semantic },
    };
  }

  if (r.semantic === "accept_deferred") {
    return {
      email,
      code: "unknown",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_252" as const, semantic: r.semantic, variant: "risky" as const },
    };
  }

  if (r.semantic === "service_unavailable") {
    return {
      email,
      code: "retry_later",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_421" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }

  if (r.semantic === "insufficient_storage") {
    return {
      email,
      code: "retry_later",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_452" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }

  if (r.semantic === "temp_mailbox" || r.semantic === "temp_local") {
    return {
      email,
      code: "greylisted",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_4xx_temporary" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }

  if (r.semantic === "reject_mailbox" || r.semantic === "reject_invalid") {
    return {
      email,
      code: "undeliverable",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_550_553" as const, semantic: r.semantic },
    };
  }

  if (r.semantic === "reject_not_local") {
    const t = (r.text || "").toLowerCase();
    if (
      /(user unknown|no such|not found|invalid user|address rejected|bad mailbox|does not exist|unknown user|5\.1\.1)/i.test(
        t
      )
    ) {
      return {
        email,
        code: "undeliverable",
        message: r.text,
        details: { smtp: r.code, reason: "reject_not_local" as const, semantic: r.semantic },
      };
    }
    if (/(relay|not local|use .* route|not accepted here|forward)/i.test(t)) {
      return {
        email,
        code: "unknown",
        message: r.text,
        details: { smtp: r.code, reason: "smtp_551" as const, semantic: r.semantic, variant: "routing" as const },
      };
    }
    return {
      email,
      code: "undeliverable",
      message: r.text,
      details: { smtp: r.code, reason: "reject_not_local" as const, semantic: r.semantic },
    };
  }

  if (r.semantic === "limit_exceeded") {
    const t = (r.text || "").toLowerCase();
    if (/(over quota|full|exceeded|storage|message size|allocat|mailbox full)/i.test(t)) {
      return {
        email,
        code: "retry_later",
        message: r.text,
        details: { smtp: r.code, reason: "smtp_552_full" as const, semantic: r.semantic },
        providerCooldownUntil: cd,
      };
    }
    return {
      email,
      code: "unknown",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_risky" as const, semantic: r.semantic, variant: "552" as const },
    };
  }

  if (r.semantic === "transaction_failed") {
    return {
      email,
      code: "undeliverable",
      message: r.text,
      details: { smtp: r.code, reason: "smtp_554" as const, semantic: r.semantic },
    };
  }

  if (r.class === "permanent_reject") {
    return {
      email,
      code: "undeliverable",
      message: r.text,
      details: { smtp: r.code, semantic: r.semantic, reason: "smtp_5xx" as const },
    };
  }
  if (r.class === "temporary") {
    return {
      email,
      code: "greylisted",
      message: r.text,
      details: { smtp: r.code, variant: "4xx" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }
  if (r.class === "protocol_error") {
    return {
      email,
      code: "retry_later",
      message: r.text,
      details: { smtp: r.code, variant: "protocol" as const, semantic: r.semantic },
      providerCooldownUntil: cd,
    };
  }
  return {
    email,
    code: "retry_later",
    message: r.text,
    details: { smtp: r.code, semantic: r.semantic },
    providerCooldownUntil: cd,
  };
}

export async function verifyOne(rawEmail: string, opts: Opts = {}): Promise<VerificationResult> {
  const t0 = Date.now();
  const key = normalizeEmail(rawEmail);
  const stationCfg = getConfig();
  const skipSmtp = opts.skipSmtp ?? !stationCfg.SMTP_PROBING_ENABLED;
  const skipCatchAll = opts.skipCatchAll ?? !stationCfg.CATCH_ALL_ENABLED;
  if (!opts.forceRefresh) {
    const c = getCachedResult(key);
    if (c) {
      const withDur = { ...c, durationMs: Date.now() - t0 };
      return addScoreToResult(withDur);
    }
  }

  await ensureDisposableListLoaded();
  await ensureRolePrefixesLoaded();

  const syn = parseEmail(rawEmail);
  if (!syn.ok) {
    return addScoreToResult({ email: rawEmail, code: "dead", message: `syntax: ${syn.reason}` });
  }
  const { local, domain, raw } = syn.value;

  if (!opts.forceRefresh) {
    const pmc = getPersistentMxCache(domain);
    if (pmc) {
      return addScoreToResult({
        email: raw,
        code: "undeliverable",
        message: "Delivery path has repeatedly failed; treated as not routable at this time",
        details: { reason: "mx_unreachable_persistent" as const, layer: "mx" as const, cached: true },
      });
    }
    const dead = getDeadDomainCache(domain);
    if (dead) {
      const hit = { ...dead.result, email: raw, durationMs: Date.now() - t0 };
      return addScoreToResult(hit);
    }
    if (getDisposableCache(domain)) {
      return addScoreToResult({ email: raw, code: "disposable", message: "Disposable domain (cached)" });
    }
    if (getRoleCache(local)) {
      return addScoreToResult({ email: raw, code: "role_account", message: "Role or generic local part (cached)" });
    }
  }

  if (isDisposableDomainSync(domain)) {
    if (!opts.forceRefresh) {
      setDisposableCache(domain, { v: true });
    }
    return addScoreToResult({ email: raw, code: "disposable", message: "Disposable domain" });
  }
  if (isRoleLocalPart(local)) {
    if (!opts.forceRefresh) {
      setRoleCache(local, { v: true });
    }
    return addScoreToResult({ email: raw, code: "role_account", message: "Role or generic local part" });
  }

  const mxr = await lookupMx(domain, Boolean(opts.forceRefresh));
  if (mxr.kind === "nxdomain") {
    const o = {
      email: raw,
      code: "undeliverable" as const,
      message: "Domain does not exist",
      details: { reason: "domain_invalid" as const, layer: "dns" as const },
    };
    if (!opts.forceRefresh) {
      const scored = addScoreToResult(o);
      setDeadDomainCache(domain, { result: scored, reason: "domain_invalid" });
      return scored;
    }
    return addScoreToResult(o);
  }
  if (mxr.kind === "no_mx" || (mxr.kind === "ok" && mxr.records.length === 0)) {
    const o = {
      email: raw,
      code: "undeliverable" as const,
      message: "No MX records for domain",
      details: { reason: "no_mx" as const, layer: "dns" as const },
    };
    if (!opts.forceRefresh) {
      setDomainExistsCache(domain, { exists: true, at: Date.now() });
      const scored = addScoreToResult(o);
      setDeadDomainCache(domain, { result: scored, reason: "no_mx" });
      return scored;
    }
    return addScoreToResult(o);
  }
  if (mxr.kind === "ok" && mxr.records.length > 0 && !opts.forceRefresh) {
    setDomainExistsCache(domain, { exists: true, at: Date.now() });
  }
  if (mxr.kind === "error") {
    return addScoreToResult(
      mxr.transient
        ? {
            email: raw,
            code: "retry_later",
            message: `DNS: ${mxr.message}`,
            details: { code: mxr.code, layer: "dns" as const, reason: "mx_lookup" as const, transient: true },
          }
        : {
            email: raw,
            code: "undeliverable",
            message: `DNS: ${mxr.message}`,
            details: { code: mxr.code, layer: "dns" as const, reason: "mx_lookup" as const },
          }
    );
  }

  const orderedExchanges = mxr.records.map((m) => m.exchange);
  const addr = await checkMxExchangesAddressable(orderedExchanges);
  if (addr.kind === "all_failed") {
    if (addr.anyTransient) {
      return addScoreToResult(
        withMxPersistent(
          domain,
          {
            email: raw,
            code: "retry_later",
            message: "All MX hostnames failed DNS (A/AAAA); retry later",
            details: { reason: "mx_unreachable" as const, layer: "mx" as const },
          },
          "mx_host_dns"
        )
      );
    }
    return addScoreToResult({
      email: raw,
      code: "undeliverable",
      message: "No MX hostnames resolve in DNS (A/AAAA)",
      details: { reason: "mx_unreachable" as const, layer: "mx" as const },
    });
  }

  const mxHosts = addr.routableExchanges;
  const { id: provider, isBig } = detectBigProvider(domain, mxHosts[0] ?? domain);

  if (skipSmtp) {
    const r: VerificationResult = {
      email: raw,
      code: "unknown",
      message: "MX OK; SMTP not executed",
      details: { mx: mxHosts[0] },
    };
    if (!opts.forceRefresh) setCachedResult(key, r);
    const out = { ...r, durationMs: Date.now() - t0 };
    return addScoreToResult(out);
  }

  const block = isProviderSmtpBlocked(provider);
  if (block.blocked) {
    return addScoreToResult({
      email: raw,
      code: "retry_later",
      message: "Provider SMTP cooling down on this station; retry after cooldown",
      details: { reason: "provider_cooldown", blockCount: block.blockCount },
      providerCooldownUntil: nowIso(block.until),
    });
  }

  if (isBig) {
    const wait = providerSmtpAllowNow(provider);
    if ("waitMs" in wait) {
      await sleep(wait.waitMs);
    }
  }

  if (!skipCatchAll && !isBig) {
    try {
      const c = await probeCatchAll(mxHosts, domain, { forceRefresh: Boolean(opts.forceRefresh) });
      if (c.kind === "catch_all") {
        const out: VerificationResult = {
          email: raw,
          code: "catch_all",
          message: "Server accepts unprovisioned address; treat as catch-all",
          details: { probe: c.probe },
        };
        if (!opts.forceRefresh) setCachedResult(key, out);
        const o2 = { ...out, durationMs: Date.now() - t0 };
        return addScoreToResult(o2);
      }
    } catch (e) {
      log.warn({ err: e }, "catch-all probe failed, continuing");
    }
  }

  const main = await probeRcpt(mxHosts, { toAddress: raw, provider });
  if (isBig) {
    recordProviderSmtpUse(provider);
  }
  const out = mapSmtpToResult(raw, domain, provider, main);
  if (!opts.forceRefresh) setCachedResult(key, out);
  const final = { ...out, durationMs: Date.now() - t0 };
  return addScoreToResult(final, { isFreeEmail: isFreeEmailProvider(provider) });
}

export async function safeVerify(email: string, opts: Opts): Promise<VerificationResult> {
  try {
    return await verifyOne(email, opts);
  } catch (e) {
    incError();
    log.error({ err: e, email: redactEmailForLog(email) }, "verifyOne crashed");
    return addScoreToResult({
      email,
      code: "retry_later",
      message: toErrorMessage(e),
      details: { error: "internal" },
    });
  }
}
