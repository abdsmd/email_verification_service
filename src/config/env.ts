import { z } from "zod";
import path from "node:path";
import { config as dotenvFlow } from "dotenv-flow";
import { applyProcessEnvAliases } from "./env-aliases.js";

dotenvFlow();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Bind address. Default `127.0.0.1` so the HTTP server is not reachable from other machines.
   * Set `0.0.0.0` only when you need all interfaces (e.g. Docker published ports, LAN dev).
   */
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8090),
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
  /**
   * Multiplier applied to `SMTP_RETRY_BASE_DELAY_MS` for **big** freemail (Gmail, Outlook, …)
   * to reduce look-like-abuse reconnection speed when throttled.
   */
  SMTP_RETRY_BIG_PROVIDER_MULT: z.coerce.number().min(0.5).max(5).default(1),
  /**
   * If true and only for **non-big** providers: when the first MX returns a transient/greylist-style
   * RCPT, probe up to `MX_RCPT_TRANSIENT_FALLBACK_MAX_EXTRA` more MX in priority order. Off by default.
   */
  MX_RCPT_TRANSIENT_FALLBACK_ENABLED: z.coerce.boolean().default(false),
  /** Max **additional** MX hosts to try after a transient-only RCPT on a previous MX (0 = disabled path). */
  MX_RCPT_TRANSIENT_FALLBACK_MAX_EXTRA: z.coerce.number().int().min(0).max(5).default(1),
  /** Include `signals` (high-risk TLD, possible typo) on results when the address is syntactically valid. */
  VERIFICATION_SIGNALS_ENABLED: z.coerce.boolean().default(true),
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
  /**
   * When true, `node-cron` fetches upstream disposable lists on a schedule and hot-reloads memory (no PM2 restart).
   * Unset: enabled only when `NODE_ENV=production` (set `0` / `false` to disable in prod).
   */
  DISPOSABLE_LIST_CRON_ENABLED: z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s === "") {
        return process.env.NODE_ENV === "production";
      }
      const l = s.toLowerCase();
      if (l === "0" || l === "false" || l === "no" || l === "off") {
        return false;
      }
      return l === "1" || l === "true" || l === "yes" || l === "on";
    }),
  /** `node-cron` expression (5 fields: minute hour day month weekday). */
  DISPOSABLE_LIST_CRON_SCHEDULE: z.string().default("15 6 * * *"),
  /** IANA timezone for the schedule (e.g. UTC, Europe/Berlin). */
  DISPOSABLE_LIST_CRON_TIMEZONE: z.string().default("UTC"),
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
  /** Serve the installable PWA (manifest, service worker, / shell) from ./public. String `false`/`0` is false. */
  PWA_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((s) => {
      const l = s.trim().toLowerCase();
      if (l === "false" || l === "0" || l === "no" || l === "off") {
        return false;
      }
      return true;
    }),
  /**
   * Bearer token for `Authorization: Bearer <token>`. Takes precedence over API_KEY when both set.
   * @see API_KEY — legacy name, same use
   */
  STATION_SECRET: z.string().optional(),
  API_KEY: z.string().optional(),
  /**
   * Optional multi-tenant API keys. JSON array: `[{ "bearer": "…", "id": "tenant1", "rateLimitRpm": 120 }]`.
   * When set, each entry is a valid Bearer; `rateLimitRpm` is optional (requests per minute, converted to the configured window).
   * When unset, single `STATION_SECRET` / `API_KEY` applies (logical tenant `default`).
   */
  TENANT_KEYS_JSON: z.string().optional(),
  /** Expose OpenAPI + Swagger UI at `/v1/docs` and JSON at `/v1/docs/json` (still requires Bearer when auth is on). */
  API_DOCS_ENABLED: z.coerce.boolean().default(false),
  /** How long a successful idempotent request body is deduplicated (X-Idempotency-Key on verify/batch). */
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(60_000).max(7 * 24 * 3_600_000).default(3_600_000),
  IDEMPOTENCY_MAX_ENTRIES: z.coerce.number().int().min(100).max(1_000_000).default(10_000),
  /** Count requests slower than this as `verify_slow_total` in metrics. */
  SLOW_REQUEST_THRESHOLD_MS: z.coerce.number().int().min(1_000).default(5_000),
  /** How many recent verify durations to keep for p50/p95 in `/v1/metrics` (per process). */
  METRICS_LATENCIES_MAX: z.coerce.number().int().min(100).max(1_000_000).default(2_000),
  /** If set, append one JSON line per admin cache/cooldown action (path, tenant, time). */
  AUDIT_LOG_PATH: z.string().optional(),
  /** When true, responses include `explain` and `confidence` (RCPT-verdict confidence, not inbox guarantee). */
  VERIFICATION_EXPLAIN_ENABLED: z.coerce.boolean().default(true),
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
  /**
   * If set, [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit) and idempotency use Redis
   * for this process. Required for **consistent** limits across multiple app instances.
   */
  REDIS_URL: z.string().optional(),
  /**
   * When `true`, registers `POST /v1/verify/jobs` (202) and `GET /v1/verify/jobs/:id`.
   * Jobs are processed **in-process**; use one worker or a shared queue in front for multi-node.
   */
  ASYNC_VERIFY_JOBS_ENABLED: z.coerce.boolean().default(false),
  /** Max concurrent stored async jobs (pending+processing+done kept until polled or cap). */
  ASYNC_JOBS_MAX: z.coerce.number().int().min(10).max(100_000).default(2_000),
  /** HMAC key for `X-Webhook-Signature` on async verify callbacks. Defaults to `HMAC_SECRET` if unset. */
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
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
