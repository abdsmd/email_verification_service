const sec = (s: string) => String(Number(s) * 1000);

/**
 * Map alternate / ops-style names onto canonical `process.env` keys used by the Zod schema.
 * Only sets a canonical var when it is currently unset/empty.
 */
export function applyProcessEnvAliases(e: NodeJS.ProcessEnv = process.env): void {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined || v === "") return;
    if (!e[k] || e[k] === "") {
      e[k] = v;
    }
  };

  // Listen / port
  set("HOST", e.API_HOST);
  set("PORT", e.API_PORT);

  // Concurrency and batch
  set("BATCH_MAX_ITEMS", e.MAX_BATCH_SIZE);
  set("MAX_CONCURRENCY", e.MAX_CONCURRENT_CHECKS);
  set("BATCH_INNER_PER_DOMAIN_CONCURRENCY", e.MAX_CONCURRENT_PER_DOMAIN);
  set("MAX_CONCURRENT_PER_PROVIDER", e.MAX_CONCURRENT_PER_PROVIDER);


  // SMTP: single timeout knob
  if (!e.SMTP_CONNECT_TIMEOUT_MS && !e.SMTP_COMMAND_TIMEOUT_MS && e.SMTP_TIMEOUT_MS) {
    e.SMTP_CONNECT_TIMEOUT_MS = e.SMTP_TIMEOUT_MS;
    e.SMTP_COMMAND_TIMEOUT_MS = e.SMTP_TIMEOUT_MS;
  }
  if (!e.SMTP_BANNER_READ_TIMEOUT_MS && e.SMTP_TIMEOUT_MS) {
    e.SMTP_BANNER_READ_TIMEOUT_MS = e.SMTP_TIMEOUT_MS;
  }
  set("SMTP_RETRIES", e.SMTP_MAX_MX_ATTEMPTS);

  // Scoring
  if (e.DISPOSABLE_MODE && !e.DISPOSABLE_DELIVERABILITY) {
    e.DISPOSABLE_DELIVERABILITY = e.DISPOSABLE_MODE;
  }
  if (e.ROLE_ACCOUNT_MODE && !e.ROLE_ACCOUNT_DELIVERABILITY) {
    e.ROLE_ACCOUNT_DELIVERABILITY = e.ROLE_ACCOUNT_MODE;
  }

  // Provider cooldown
  if (!e.PROVIDER_BLOCK_COOLDOWN_MS && e.PROVIDER_COOLDOWN_BASE_SECONDS) {
    e.PROVIDER_BLOCK_COOLDOWN_MS = String(Number(e.PROVIDER_COOLDOWN_BASE_SECONDS) * 1000);
  }

  // Cache TTLs (seconds → ms)
  if (e.MX_CACHE_TTL_SECONDS) {
    const ms = sec(e.MX_CACHE_TTL_SECONDS);
    set("MX_CACHE_TTL_MIN_MS", ms);
    set("MX_CACHE_TTL_MAX_MS", ms);
  }
  if (e.NO_MX_CACHE_TTL_SECONDS) {
    set("DEAD_DOMAIN_CACHE_TTL_MS", sec(e.NO_MX_CACHE_TTL_SECONDS));
  }
  if (e.CATCHALL_CACHE_TTL_SECONDS) {
    const ms = sec(e.CATCHALL_CACHE_TTL_SECONDS);
    set("CATCHALL_CACHE_TTL_MIN_MS", ms);
    set("CATCHALL_CACHE_TTL_MAX_MS", ms);
  }
  if (e.MAILBOX_VALID_CACHE_TTL_SECONDS) {
    set("RESULT_CACHE_TTL_MS", sec(e.MAILBOX_VALID_CACHE_TTL_SECONDS));
  } else if (e.TEMP_FAILURE_CACHE_TTL_SECONDS) {
    set("RESULT_CACHE_TTL_MS", sec(e.TEMP_FAILURE_CACHE_TTL_SECONDS));
  }
  if (e.TEMP_FAILURE_CACHE_TTL_SECONDS) {
    set("VERIFICATION_SOFT_FAILURE_CACHE_TTL_MS", sec(e.TEMP_FAILURE_CACHE_TTL_SECONDS));
  }
  if (e.MAILBOX_INVALID_CACHE_TTL_SECONDS) {
    set("VERIFICATION_NEGATIVE_CACHE_TTL_MS", sec(e.MAILBOX_INVALID_CACHE_TTL_SECONDS));
  }
}
