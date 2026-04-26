import { z } from "zod";
import path from "node:path";
import { config as dotenvFlow } from "dotenv-flow";
import { applyProcessEnvAliases } from "./env-aliases.js";

dotenvFlow();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  STATION_ID: z.string().default("verification-station"),
  /** Opaque label for multi-region / fleet ops (logging only) */
  STATION_REGION: z.string().optional(),
  /**
   * SMTP EHLO/HELO hostname. Defaults to `STATION_ID` in SMTP if unset.
   * @see MAIL_FROM
   */
  HELO_DOMAIN: z.string().optional(),
  /**
   * Full `MAIL FROM:<addr>` (e.g. verify@example.com). If unset, uses `noreply@MAIL_FROM_DOMAIN`.
   */
  MAIL_FROM: z.string().optional(),
  MAIL_FROM_DOMAIN: z.string().default("invalid.local"),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(20),
  /** Max items per /v1/verify/batch (dedupe is applied after this check) */
  BATCH_MAX_ITEMS: z.coerce.number().int().min(1).max(10_000).default(500),
  /** How many different domain *groups* may be processed in parallel in a batch */
  BATCH_DOMAIN_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(8),
  /**
   * Max concurrent SMTP / verify operations targeting the *same* recipient domain
   * within one batch (and within each domain group).
   */
  BATCH_INNER_PER_DOMAIN_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(2),
  /** Per big-provider id: max concurrent active SMTP sessions (probe path) */
  MAX_CONCURRENT_PER_PROVIDER: z.coerce.number().int().min(1).max(50).default(3),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  DNS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DNS_RETRIES: z.coerce.number().int().min(0).default(1),
  SMTP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  SMTP_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SMTP_BANNER_READ_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Hard cap for a single SMTP probe session (connect + EHLO + MAIL + RCPT); forces socket teardown */
  SMTP_SESSION_MAX_MS: z.coerce.number().int().positive().default(90_000),
  SMTP_RETRIES: z.coerce.number().int().min(0).default(1),
  SMTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(200),
  SMTP_USE_STARTTLS: z.coerce.boolean().default(true),
  DNS_CACHE_MAX: z.coerce.number().int().positive().default(5_000),
  /** @deprecated use MX_CACHE_TTL_*; still used for sqlite fallback if MX not set in older deploys */
  DNS_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  /** Max entries per cache layer (LRU) */
  LAYER_CACHE_MAX: z.coerce.number().int().positive().default(5_000),
  /** Keys: `mx:domain` — successful MX / negative DNS facts */
  MX_CACHE_TTL_MIN_MS: z.coerce.number().int().positive().default(6 * 3_600_000),
  MX_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(24 * 3_600_000),
  /** Keys: `domain:domain` — apex known to exist in DNS (not ENOTFOUND) */
  DOMAIN_EXISTS_CACHE_TTL_MS: z.coerce.number().int().positive().default(24 * 3_600_000),
  /** Keys: `dead:domain` — prior undeliverable / path facts */
  DEAD_DOMAIN_CACHE_TTL_MS: z.coerce.number().int().positive().default(24 * 3_600_000),
  /** Keys: `disposable:domain` */
  DISPOSABLE_CACHE_TTL_MIN_MS: z.coerce.number().int().positive().default(7 * 24 * 3_600_000),
  DISPOSABLE_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(30 * 24 * 3_600_000),
  /** Keys: `catchall:domain` */
  CATCHALL_CACHE_TTL_MIN_MS: z.coerce.number().int().positive().default(6 * 3_600_000),
  CATCHALL_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(24 * 3_600_000),
  /** Keys: `provider-cooldown:{id}` (mirror of in-memory; TTL derived from `until`) */
  PROVIDER_COOLDOWN_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(7 * 24 * 3_600_000),
  /** Keys: `mx-health:host` */
  SMTP_HEALTH_CACHE_TTL_MIN_MS: z.coerce.number().int().positive().default(15 * 60_000),
  SMTP_HEALTH_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(60 * 60_000),
  /** Keys: `mx-persistent:domain` */
  PERSISTENT_MX_CACHE_TTL_MIN_MS: z.coerce.number().int().positive().default(6 * 3_600_000),
  PERSISTENT_MX_CACHE_TTL_MAX_MS: z.coerce.number().int().positive().default(24 * 3_600_000),
  /** Keys: `role:local` */
  ROLE_PREFIX_CACHE_TTL_MS: z.coerce.number().int().positive().default(30 * 24 * 3_600_000),
  RESULT_CACHE_MAX: z.coerce.number().int().positive().default(2_000),
  /** `valid` and similar positive outcomes */
  RESULT_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  /** Hard / policy negatives (undeliverable, disposable, catch-all, etc.) */
  VERIFICATION_NEGATIVE_CACHE_TTL_MS: z.coerce.number().int().positive().default(21_600_000),
  /** Transient: retry_later, greylisted, etc. (also partial unknowns) */
  VERIFICATION_SOFT_FAILURE_CACHE_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
  DISPOSABLE_LIST_PATH: z.string().optional(),
  DATA_DIR: z.string().default("src/data"),
  PROVIDER_BLOCK_COOLDOWN_MS: z.coerce.number().int().positive().default(1_800_000),
  /** Minimum spacing between SMTP probes to the same *big* provider (0 = disabled, e.g. tests) */
  BIG_PROVIDER_SMTP_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(4_000),
  /**
   * Floor for Gmail / Outlook / Yahoo when the base big-provider interval is enabled (positive).
   * Prevents aggressive SMTP cadence to major free-mail MX even if the base interval is low.
   */
  MAJOR_FREE_MAIL_PROVIDERS_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(5_000),
  CORS_ENABLED: z.coerce.boolean().default(false),
  CORS_ORIGIN: z.string().optional(),
  /**
   * Bearer token for `Authorization: Bearer <token>`. Takes precedence over API_KEY when both set.
   * @see API_KEY — legacy name, same use
   */
  STATION_SECRET: z.string().optional(),
  API_KEY: z.string().optional(),
  HMAC_SECRET: z.string().optional(),
  /** Max JSON body size (bytes) */
  REQUEST_BODY_MAX_BYTES: z.coerce.number().int().min(1_000).max(100_000_000).default(1_048_576),
  /** Max time for a single HTTP request (verify can be slow; must exceed worst-case SMTP session) */
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /**
   * If the client sends no data on a connection for this long, close it (0 = Node / Fastify default).
   */
  HTTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(0),
  /** After SIGINT/SIGTERM, `close()` then wait; then force-close remaining sockets */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(30_000),
  /** Trust `X-Forwarded-For` / proxy when resolving client IP (allowlist) */
  TRUST_PROXY: z.coerce.boolean().default(false),
  /** Comma-separated client IPs; if set, only these may access protected routes */
  IP_ALLOWLIST: z.string().optional(),
  /** Max |now - X-Timestamp| for HMAC (default 5 minutes) */
  HMAC_SKEW_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  /** How long a given `X-Request-Id` is remembered for HMAC replay protection */
  HMAC_REPLAY_TTL_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(600_000),
  CACHE_BACKEND: z.enum(["memory", "sqlite"]).default("memory"),
  SQLITE_PATH: z.string().optional(),
  METRICS_ENABLED: z.coerce.boolean().default(true),
  /** Persist provider cooldown (until, block count) to SQLite (same file as cache when using sqlite) */
  PROVIDER_COOLDOWN_PERSIST: z.coerce.boolean().default(false),
  /** Per-MX host A/AAAA resolution timeout */
  MX_HOST_DNS_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** Failures in the rolling window before mx_unreachable_persistent (timeouts excluded from this count) */
  MX_PERSISTENT_FAILURE_THRESHOLD: z.coerce.number().int().min(2).default(5),
  /** Rolling window for mx_unreachable_persistent (ms) */
  MX_PERSISTENT_FAILURE_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),
  /**
   * When code is `disposable`, map to deliverability+score:
   * - risky: mid-risky band (default)
   * - undeliverable: score 0, class undeliverable
   */
  DISPOSABLE_DELIVERABILITY: z.enum(["risky", "undeliverable"]).default("risky"),
  /**
   * When code is `role_account`, how to map score+deliverability
   * (mirrors `DISPOSABLE_MODE` in ops templates).
   */
  ROLE_ACCOUNT_DELIVERABILITY: z.enum(["risky", "undeliverable"]).default("risky"),
  /** Global default: when false, verification skips RCPT (same as per-request `skipSmtp: true`) */
  SMTP_PROBING_ENABLED: z.coerce.boolean().default(true),
  CATCH_ALL_ENABLED: z.coerce.boolean().default(true),
  /** When false, layer caches and result cache writes are no-ops (reads always miss) */
  CACHE_ENABLED: z.coerce.boolean().default(true),
  /** When false, provider block/cooldown gating is disabled */
  PROVIDER_COOLDOWN_ENABLED: z.coerce.boolean().default(true),
  /** When false, do not log full email addresses in error paths */
  LOG_FULL_EMAIL: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  applyProcessEnvAliases();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function resetConfigForTests(): void {
  cached = null;
}

export function resolveDataPath(p: string, filename: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p, filename);
}

export function resolveOptionalPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/** EHLO/HELO string sent to remote MX. */
export function getSmtpHeloName(): string {
  const c = getConfig();
  const h = c.HELO_DOMAIN?.trim();
  return h && h.length > 0 ? h : c.STATION_ID;
}

/** `MAIL FROM:<...>` local-part@domain. */
export function getSmtpMailFromAddress(): string {
  const c = getConfig();
  const f = c.MAIL_FROM?.trim();
  if (f && f.length > 0) {
    return f;
  }
  return `noreply@${c.MAIL_FROM_DOMAIN}`;
}
