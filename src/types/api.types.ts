import { z } from "zod";
import { getConfig } from "../config/env.js";
import { VerifyOptionsSchema, VerificationResultSchema } from "./verification.types.js";

export const SingleVerifyRequestSchema = z.object({
  email: z
    .string()
    .min(3)
    .max(320)
    .transform((s) => s.trim().toLowerCase()),
  jobId: z.string().min(1).max(128).optional(),
  options: VerifyOptionsSchema,
});

const BATCH_HARD_CAP = 10_000;

export const BatchVerifyRequestSchema = z
  .object({
    items: z.array(SingleVerifyRequestSchema).min(1).max(BATCH_HARD_CAP),
    options: VerifyOptionsSchema,
  })
  .superRefine((data, ctx) => {
    const max = getConfig().BATCH_MAX_ITEMS;
    if (data.items.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: max,
        type: "array",
        inclusive: true,
        path: ["items"],
        message: `Array must contain at most ${max} element(s)`,
      });
    }
  });

export const CacheClearRequestSchema = z
  .object({
    type: z
      .enum([
        "all",
        "result",
        "dns",
        "mx",
        "domain",
        "dead",
        "disposable",
        "role",
        "catchall",
        "provider_cooldown",
        "mx_health",
        "mx_persistent",
      ])
      .default("all"),
  })
  .optional()
  .default({ type: "all" });

export const CooldownResetRequestSchema = z
  .object({
    provider: z
      .enum([
        "gmail",
        "outlook",
        "yahoo",
        "aol",
        "icloud",
        "zoho",
        "proton",
        "yandex",
        "gmx",
        "fastmail",
        "mail",
        "other",
      ])
      .optional(),
  })
  .optional()
  .default({});

export type SingleVerifyRequest = z.infer<typeof SingleVerifyRequestSchema>;
export type BatchVerifyRequest = z.infer<typeof BatchVerifyRequestSchema>;
export { VerificationResultSchema };
