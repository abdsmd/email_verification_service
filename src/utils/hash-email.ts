import { createHash } from "node:crypto";
import { normalizeEmail } from "./normalize-email.js";

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
}
