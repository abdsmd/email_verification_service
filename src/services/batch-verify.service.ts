import pLimit from "p-limit";
import { getConfig } from "../config/env.js";
import type { BatchVerifyRequest } from "../types/api.types.js";
import type { VerificationResult } from "../types/verification.types.js";
import { getLogger } from "../utils/logger.js";
import { toErrorMessage } from "../utils/safe-error.js";
import { redactEmailForLog } from "../utils/log-email.js";
import { parseEmail } from "./syntax.service.js";
import { getVerifyLimiter } from "./concurrency.service.js";
import { incVerify } from "./metrics.service.js";
import { addScoreToResult } from "./scoring.service.js";
import { safeVerify } from "./verification.service.js";

const log = getLogger();

type MergedOpts = {
  skipSmtp?: boolean;
  skipCatchAll?: boolean;
  forceRefresh?: boolean;
};

function domainGroupKey(email: string): string {
  const p = parseEmail(email);
  return p.ok ? p.value.domain : "_invalid";
}

function mergeOpts(globalOpts: MergedOpts, itemOpts: MergedOpts): MergedOpts {
  return { ...globalOpts, ...itemOpts };
}

/**
 * One verification; never throws. Counts a single `incVerify` when work is actually scheduled.
 * Outer try/catch covers limiter/transport failures.
 */
async function verifyItemNeverThrows(email: string, opts: MergedOpts): Promise<VerificationResult> {
  try {
    return await getVerifyLimiter()(() => {
      try {
        incVerify();
        return safeVerify(email, opts);
      } catch (e) {
        log.error({ err: e, email: redactEmailForLog(email) }, "batch: safeVerify sync throw");
        return {
          email,
          code: "system_error",
          message: toErrorMessage(e),
          details: { reason: "system_error" as const },
        };
      }
    });
  } catch (e) {
    log.error({ err: e, email: redactEmailForLog(email) }, "batch: verify limiter or async failure");
    return {
      email,
      code: "system_error",
      message: toErrorMessage(e),
      details: { reason: "system_error" as const },
    };
  }
}

function systemErrorResult(email: string, reason: unknown, extra?: Record<string, unknown>): VerificationResult {
  return {
    email,
    code: "system_error",
    message: toErrorMessage(reason),
    details: { reason: "system_error" as const, ...extra },
  };
}

/**
 * Deduplicates by email (first row wins for merged options), groups by domain, runs domain
 * groups with limited parallelism, and uses `Promise.allSettled` at the group and item level.
 * Returns one result per input row (including duplicate addresses).
 */
export async function runBatchVerify(req: BatchVerifyRequest): Promise<VerificationResult[]> {
  const globalOpts: MergedOpts = req.options ?? {};
  const rows = req.items.map((it) => ({
    email: it.email,
    itemOpts: (it.options ?? {}) as MergedOpts,
  }));

  const firstSeen = new Map<string, MergedOpts>();
  const uniqueOrder: string[] = [];
  for (const row of rows) {
    if (!firstSeen.has(row.email)) {
      firstSeen.set(row.email, mergeOpts(globalOpts, row.itemOpts));
      uniqueOrder.push(row.email);
    }
  }

  const byDomain = new Map<string, string[]>();
  for (const email of uniqueOrder) {
    const key = domainGroupKey(email);
    const list = byDomain.get(key);
    if (list) list.push(email);
    else byDomain.set(key, [email]);
  }

  const domainEntries = [...byDomain.entries()];
  const resultsByEmail = new Map<string, VerificationResult>();
  const groupLimit = pLimit(getConfig().BATCH_DOMAIN_CONCURRENCY);

  const groupSettled = await Promise.allSettled(
    domainEntries.map(([domain, emailsInGroup]) =>
      groupLimit(async () => {
        const innerDomainLimit = pLimit(getConfig().BATCH_INNER_PER_DOMAIN_CONCURRENCY);
        const inner = await Promise.allSettled(
          emailsInGroup.map((email) => {
            const opts = firstSeen.get(email);
            return innerDomainLimit(() => verifyItemNeverThrows(email, opts ?? globalOpts));
          })
        );
        for (let i = 0; i < emailsInGroup.length; i++) {
          const email = emailsInGroup[i]!;
          const s = inner[i]!;
          if (s.status === "fulfilled") {
            resultsByEmail.set(email, s.value);
          } else {
            log.error(
              { err: s.reason, email: redactEmailForLog(email), domain },
              "batch: inner Promise.allSettled rejected"
            );
            resultsByEmail.set(email, systemErrorResult(email, s.reason, { layer: "item" as const }));
          }
        }
      })
    )
  );

  for (let gi = 0; gi < groupSettled.length; gi++) {
    const g = groupSettled[gi]!;
    if (g.status === "rejected") {
      const entry = domainEntries[gi]!;
      const domain = entry[0];
      const emailsInGroup = entry[1];
      log.error({ err: g.reason, domain }, "batch: domain group task rejected");
      for (const email of emailsInGroup) {
        if (!resultsByEmail.has(email)) {
          resultsByEmail.set(
            email,
            systemErrorResult(email, g.reason, { layer: "domain_group" as const, domain })
          );
        }
      }
    }
  }

  return rows.map((row) => {
    const r = resultsByEmail.get(row.email);
    if (!r) {
      return addScoreToResult(
        systemErrorResult(row.email, "missing result after batch (internal)", { layer: "batch_map" as const })
      );
    }
    return addScoreToResult(r.email === row.email ? r : { ...r, email: row.email });
  });
}
