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

export function getSmtpRetryConfig(): { retries: number; baseDelayMs: number } {
  const c = getConfig();
  return { retries: c.SMTP_RETRIES, baseDelayMs: c.SMTP_RETRY_BASE_DELAY_MS };
}
