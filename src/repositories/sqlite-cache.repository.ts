import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getConfig } from "../config/env.js";
import type { VerificationResult } from "../types/verification.types.js";
import type { DnsCacheValue } from "../types/cache.types.js";

let db: Database.Database | null = null;

function getDbPath(): string {
  const c = getConfig();
  const p = c.SQLITE_PATH && c.SQLITE_PATH.length > 0
    ? c.SQLITE_PATH
    : path.join(process.cwd(), "data", "verification-station.db");
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

export function getSqliteDb(): Database.Database {
  if (db) return db;
  const file = getDbPath();
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS cache_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cache_exp ON cache_kv(expires_at);
    CREATE TABLE IF NOT EXISTS provider_cooldown (
      provider TEXT PRIMARY KEY,
      until_ms INTEGER NOT NULL,
      block_count INTEGER NOT NULL,
      last_smtp_at_ms INTEGER NOT NULL
    );
  `);
  db = d;
  return d;
}

const now = () => Date.now();

function purgeExpired(d: Database.Database): void {
  d.prepare("DELETE FROM cache_kv WHERE expires_at < ?").run(now());
}

export function sqliteGetResult(key: string): VerificationResult | undefined {
  return sqliteGetJson<VerificationResult>("res:" + key);
}

export function sqliteSetResult(key: string, value: VerificationResult, ttlMs: number): void {
  sqliteSetJson("res:" + key, value, ttlMs);
}

export function sqliteGetJson<T>(fullKey: string): T | undefined {
  const d = getSqliteDb();
  purgeExpired(d);
  const row = d.prepare("SELECT v FROM cache_kv WHERE k = ? AND expires_at >= ?").get(
    fullKey,
    now()
  ) as { v: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return undefined;
  }
}

export function sqliteSetJson<T>(fullKey: string, value: T, ttlMs: number): void {
  const d = getSqliteDb();
  d.prepare("INSERT OR REPLACE INTO cache_kv (k, v, expires_at) VALUES (?, ?, ?)").run(
    fullKey,
    JSON.stringify(value),
    now() + Math.max(1, Math.floor(ttlMs))
  );
}

export function sqliteGetDns(key: string): DnsCacheValue | undefined {
  return (
    sqliteGetJson<DnsCacheValue>("mx:" + key) ??
    sqliteGetJson<DnsCacheValue>("dns:" + key)
  );
}

export function sqliteSetDns(key: string, value: DnsCacheValue, ttlMs: number): void {
  sqliteSetJson("mx:" + key, value, ttlMs);
}

export function sqliteDeleteKey(fullKey: string): void {
  getSqliteDb().prepare("DELETE FROM cache_kv WHERE k = ?").run(fullKey);
}

const NS_PREFIX: Record<Exclude<SqliteCacheNamespace, "all" | "mx" | "dns" | "res" | "result">, string> = {
  domain: "domain:%",
  dead: "dead:%",
  disposable: "disposable:%",
  role: "role:%",
  catchall: "catchall:%",
  "provider-cooldown": "provider-cooldown:%",
  "mx-health": "mx-health:%",
  "mx-persistent": "mx-persistent:%",
};

export type SqliteCacheNamespace =
  | "all"
  | "res"
  | "result"
  | "mx"
  | "dns"
  | "domain"
  | "dead"
  | "disposable"
  | "role"
  | "catchall"
  | "provider-cooldown"
  | "mx-health"
  | "mx-persistent";

export function sqliteClearNamespace(ns: "dns" | "res" | "all" | SqliteCacheNamespace): void {
  const d = getSqliteDb();
  if (ns === "all") {
    d.prepare("DELETE FROM cache_kv").run();
    return;
  }
  if (ns === "res" || ns === "result") {
    d.prepare("DELETE FROM cache_kv WHERE k LIKE ?").run("res:%");
    return;
  }
  if (ns === "dns" || ns === "mx") {
    d.prepare("DELETE FROM cache_kv WHERE k LIKE ? OR k LIKE ?").run("mx:%", "dns:%");
    return;
  }
  const p = NS_PREFIX[ns];
  d.prepare("DELETE FROM cache_kv WHERE k LIKE ?").run(p);
}

export function closeSqliteForTests(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }
}
