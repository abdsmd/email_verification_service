import { getConfig } from "../config/env.js";

export function getDnsRetryConfig(): {
  dnsTimeoutMs: number;
  dnsRetries: number;
  retryBaseDelayMs: number;
} {
  const c = getConfig();
  return {
    dnsTimeoutMs: c.DNS_TIMEOUT_MS,
    dnsRetries: c.DNS_RETRIES,
    retryBaseDelayMs: c.SMTP_RETRY_BASE_DELAY_MS,
  };
}

export function getSmtpRetryConfig(applyBigProviderMult = false): { retries: number; baseDelayMs: number } {
  const c = getConfig();
  const mult = applyBigProviderMult ? c.SMTP_RETRY_BIG_PROVIDER_MULT : 1;
  return {
    retries: c.SMTP_RETRIES,
    baseDelayMs: Math.max(0, Math.round(c.SMTP_RETRY_BASE_DELAY_MS * mult)),
  };
}
