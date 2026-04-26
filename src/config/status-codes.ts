import type { VerificationCode } from "../types/verification.types.js";

/** HTTP status to use for API-level failures (not verification outcomes) */
export const HttpErrorStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  TOO_MANY: 429,
  INTERNAL: 500,
} as const;

/** Mapping verification outcome to suggested client handling (for docs / SDKs) */
export const verificationOutcomeGroup: Record<
  VerificationCode,
  "ok" | "soft_fail" | "hard_fail" | "inconclusive" | "policy"
> = {
  valid: "ok",
  invalid: "hard_fail",
  dead: "hard_fail",
  undeliverable: "hard_fail",
  unknown: "inconclusive",
  retry_later: "soft_fail",
  greylisted: "soft_fail",
  mx_unreachable: "soft_fail",
  provider_blocked: "policy",
  disposable: "policy",
  role_account: "policy",
  catch_all: "inconclusive",
  system_error: "inconclusive",
};
