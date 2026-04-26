import { getDomainToProviderId, getMxProviderId } from "../config/provider-rules.js";
import type { BigProviderId } from "../types/provider.types.js";

export function detectBigProvider(
  emailDomain: string,
  primaryMx: string
): { id: BigProviderId; isBig: boolean } {
  const byDom = getDomainToProviderId(emailDomain);
  const byMx = getMxProviderId(primaryMx);
  const id: BigProviderId = (byDom ?? byMx ?? "other") as BigProviderId;
  return { id, isBig: id !== "other" };
}

const FREE_EMAIL_IDS = new Set<BigProviderId>([
  "gmail",
  "outlook",
  "yahoo",
  "aol",
  "icloud",
  "gmx",
  "yandex",
  "zoho",
  "mail",
]);

export function isFreeEmailProvider(id: BigProviderId): boolean {
  return id !== "other" && FREE_EMAIL_IDS.has(id);
}

const MAJOR_FREE_MAIL_IDS = new Set<BigProviderId>(["gmail", "outlook", "yahoo"]);

/** Gmail / Outlook / Yahoo — stricter minimum SMTP spacing when rate limiting is enabled */
export function isMajorFreeMailProvider(id: BigProviderId): boolean {
  return MAJOR_FREE_MAIL_IDS.has(id);
}
