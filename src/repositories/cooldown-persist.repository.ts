import { getSqliteDb } from "./sqlite-cache.repository.js";
import type { BigProviderId } from "../types/provider.types.js";

export type CooldownRow = {
  provider: BigProviderId;
  untilMs: number;
  blockCount: number;
  lastSmtpAtMs: number;
};

export function loadCooldownRowsFromSqlite(): CooldownRow[] {
  const d = getSqliteDb();
  const rows = d
    .prepare("SELECT provider, until_ms, block_count, last_smtp_at_ms FROM provider_cooldown")
    .all() as Array<{
    provider: string;
    until_ms: number;
    block_count: number;
    last_smtp_at_ms: number;
  }>;
  return rows.map((r) => ({
    provider: r.provider as BigProviderId,
    untilMs: r.until_ms,
    blockCount: r.block_count,
    lastSmtpAtMs: r.last_smtp_at_ms,
  }));
}

export function upsertCooldownRow(row: CooldownRow): void {
  const d = getSqliteDb();
  d.prepare(
    `INSERT INTO provider_cooldown (provider, until_ms, block_count, last_smtp_at_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       until_ms = excluded.until_ms,
       block_count = excluded.block_count,
       last_smtp_at_ms = excluded.last_smtp_at_ms`
  ).run(row.provider, row.untilMs, row.blockCount, row.lastSmtpAtMs);
}

export function deleteCooldownRow(provider: BigProviderId): void {
  getSqliteDb().prepare("DELETE FROM provider_cooldown WHERE provider = ?").run(provider);
}

export function clearCooldownTable(): void {
  getSqliteDb().prepare("DELETE FROM provider_cooldown").run();
}
