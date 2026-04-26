import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

const BUILTIN = new Set(
  [
    "admin",
    "administrator",
    "abuse",
    "postmaster",
    "hostmaster",
    "webmaster",
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "mailer-daemon",
    "maildaemon",
    "uucp",
    "ftp",
    "www",
    "root",
    "info",
    "support",
    "help",
    "sales",
    "billing",
    "security",
    "contact",
  ].map((p) => p.toLowerCase())
);

const fromFile = new Set<string>();
let loadPromise: Promise<void> | null = null;

export async function ensureRolePrefixesLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  const c = getConfig();
  const p = path.resolve(process.cwd(), c.DATA_DIR, "role-prefixes.txt");
  loadPromise = (async () => {
    try {
      const text = await fs.readFile(p, "utf8");
      for (const line of text.split("\n")) {
        const s = line.trim().toLowerCase();
        if (s && !s.startsWith("#")) fromFile.add(s);
      }
    } catch (e) {
      getLogger().debug({ err: e, p }, "role-prefixes file optional");
    }
  })();
  return loadPromise;
}

export function isRoleLocalPart(local: string): boolean {
  const merged = new Set([...BUILTIN, ...fromFile]);
  const l = local.toLowerCase();
  if (merged.has(l)) return true;
  for (const p of merged) {
    if (l.startsWith(p + ".") || l.startsWith(p + "-") || l.startsWith(p + "_")) {
      return true;
    }
  }
  return false;
}
