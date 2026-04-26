import { z } from "zod";

export const SmtpClassSchema = z.enum([
  "permanent_reject",
  "temporary",
  "accept",
  "provider_block",
  "mx_unreachable",
  "protocol_error",
]);

export type SmtpClass = z.infer<typeof SmtpClassSchema>;

/** RCPT/MAIL line semantics for mapping to verification outcomes. */
export const SmtpRcptSemanticSchema = z.enum([
  "mailbox_ok",
  "accept_deferred",
  "service_unavailable",
  "temp_mailbox",
  "temp_local",
  "insufficient_storage",
  "reject_mailbox",
  "reject_not_local",
  "limit_exceeded",
  "reject_invalid",
  "transaction_failed",
  "other",
]);

export type SmtpRcptSemantic = z.infer<typeof SmtpRcptSemanticSchema>;

export const SmtpSocketErrorReasonSchema = z.enum([
  "smtp_connect_failed",
  "smtp_timeout",
  "smtp_connection_reset",
  "mx_unreachable",
]);

export type SmtpSocketErrorReason = z.infer<typeof SmtpSocketErrorReasonSchema>;

export type RcptResult =
  | {
      kind: "rcpt";
      class: SmtpClass;
      text: string;
      code: number;
      providerBlock: boolean;
      semantic: SmtpRcptSemantic;
    }
  | {
      kind: "mx_fail";
      error: "connect" | "timeout" | "protocol";
      message: string;
      /** Node OS errno when available (e.g. ECONNREFUSED) */
      errno?: string;
      /** Derived from errno + error kind for API details.reason */
      smtpSocketReason?: SmtpSocketErrorReason;
    }
  | { kind: "all_mx_failed" };
