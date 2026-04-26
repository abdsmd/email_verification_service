import { z } from "zod";

export const VerificationCodeSchema = z.enum([
  "valid",
  "invalid",
  "dead",
  "undeliverable",
  "unknown",
  "retry_later",
  "greylisted",
  "mx_unreachable",
  "provider_blocked",
  "disposable",
  "role_account",
  "catch_all",
  "system_error",
]);

export type VerificationCode = z.infer<typeof VerificationCodeSchema>;

export const VerifyOptionsSchema = z
  .object({
    skipSmtp: z.boolean().optional(),
    skipCatchAll: z.boolean().optional(),
    forceRefresh: z.boolean().optional(),
  })
  .optional()
  .default({});

export const DeliverabilityClassSchema = z.enum([
  "deliverable",
  "risky",
  "unknown",
  "undeliverable",
]);

export type DeliverabilityClass = z.infer<typeof DeliverabilityClassSchema>;

/** Outcome fields common to all verification results (code discriminates the union). */
const verificationOutcomeBase = z.object({
  email: z.string(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  providerCooldownUntil: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  score: z.number().min(0).max(100).optional(),
  deliverability: DeliverabilityClassSchema.optional(),
});

/**
 * API verification payload: `code` is the discriminant. Runtime responses are validated
 * with this schema after construction (Zod may strip unknown `details` keys on parse).
 */
export const VerificationResultSchema = z.discriminatedUnion("code", [
  verificationOutcomeBase.extend({ code: z.literal("valid") }),
  verificationOutcomeBase.extend({ code: z.literal("invalid") }),
  verificationOutcomeBase.extend({ code: z.literal("dead") }),
  verificationOutcomeBase.extend({ code: z.literal("undeliverable") }),
  verificationOutcomeBase.extend({ code: z.literal("unknown") }),
  verificationOutcomeBase.extend({ code: z.literal("retry_later") }),
  verificationOutcomeBase.extend({ code: z.literal("greylisted") }),
  verificationOutcomeBase.extend({ code: z.literal("mx_unreachable") }),
  verificationOutcomeBase.extend({ code: z.literal("provider_blocked") }),
  verificationOutcomeBase.extend({ code: z.literal("disposable") }),
  verificationOutcomeBase.extend({ code: z.literal("role_account") }),
  verificationOutcomeBase.extend({ code: z.literal("catch_all") }),
  verificationOutcomeBase.extend({ code: z.literal("system_error") }),
]);

export type VerificationResult = z.infer<typeof VerificationResultSchema>;
