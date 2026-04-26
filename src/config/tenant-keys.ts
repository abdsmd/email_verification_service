import { z } from "zod";
import { getConfig } from "./env.js";
import { createHash, timingSafeEqual } from "node:crypto";

const TenantKeyEntrySchema = z.object({
  bearer: z.string().min(8),
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  /** Optional cap: max requests per **minute**, converted to your configured `RATE_LIMIT_WINDOW_MS` window. */
  rateLimitRpm: z.coerce.number().int().min(1).max(1_000_000).optional(),
});

const TenantKeysArraySchema = z.array(TenantKeyEntrySchema);

export type TenantKeyEntry = z.infer<typeof TenantKeyEntrySchema>;

type CachedT = { list: TenantKeyEntry[]; fromJson: boolean; raw: string };

let cached: CachedT | null = null;

/**
 * When `TENANT_KEYS_JSON` is unset or empty, multi-tenant mode is off: single
 * `STATION_SECRET` / `API_KEY` with logical tenant `default` and `RATE_LIMIT_MAX`.
 */
export function getTenantKeyList(): { list: TenantKeyEntry[]; fromJson: boolean } {
  const raw = getConfig().TENANT_KEYS_JSON?.trim() ?? "";
  if (cached && cached.raw === raw) {
    return { list: cached.list, fromJson: cached.fromJson };
  }
  if (!raw) {
    cached = { list: [], fromJson: false, raw: "" };
    return { list: [], fromJson: false };
  }
  const parsed = JSON.parse(raw) as unknown;
  const list = TenantKeysArraySchema.parse(parsed);
  if (list.length === 0) {
    cached = { list: [], fromJson: false, raw };
    return { list: [], fromJson: false };
  }
  const seen = new Set<string>();
  for (const t of list) {
    if (seen.has(t.id)) {
      throw new Error(`TENANT_KEYS_JSON: duplicate tenant id "${t.id}"`);
    }
    seen.add(t.id);
  }
  cached = { list, fromJson: true, raw };
  return { list, fromJson: true };
}

export function resetTenantKeysForTests(): void {
  cached = null;
}

function hashToken(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * If multi-tenant JSON is configured, match bearer to `{ id, rateLimitRpm }` where
 * `rateLimitRpm` is the max **per rate-limit window** (aligned with `RATE_LIMIT_WINDOW_MS`).
 */
export function matchTenantForBearer(
  bearer: string | undefined
): { id: string; rateLimitRpm: number } | null {
  if (!bearer) {
    return null;
  }
  const { list, fromJson } = getTenantKeyList();
  if (!fromJson || list.length === 0) {
    return null;
  }
  const c = getConfig();
  const windowMs = c.RATE_LIMIT_WINDOW_MS;
  const defaultMax = c.RATE_LIMIT_MAX;

  for (const t of list) {
    if (bearer.length !== t.bearer.length) {
      continue;
    }
    const a = Buffer.from(hashToken(bearer), "utf8");
    const b = Buffer.from(hashToken(t.bearer), "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (t.rateLimitRpm === undefined) {
        return { id: t.id, rateLimitRpm: defaultMax };
      }
      const maxPerWindow = Math.max(1, Math.round((t.rateLimitRpm * windowMs) / 60_000));
      return { id: t.id, rateLimitRpm: maxPerWindow };
    }
  }
  return null;
}
