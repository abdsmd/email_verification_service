import fs from "node:fs/promises";
import path from "node:path";
import { getConfig, resolveOptionalPath } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
const fileLoaded = new Set<string>();
let loadFilePromise: Promise<void> | null = null;

async function readDisposableFiles(): Promise<void> {
  fileLoaded.clear();
  const extra = resolveOptionalPath(getConfig().DISPOSABLE_LIST_PATH);
  const dataPath = findDataFile("disposable-domains.txt");
  for (const p of [dataPath, extra].filter(Boolean) as string[]) {
    try {
      const text = await fs.readFile(p, "utf8");
      for (const line of text.split("\n")) {
        const d = line.trim().toLowerCase();
        if (d && !d.startsWith("#")) fileLoaded.add(d);
      }
      getLogger().info({ count: fileLoaded.size, path: p }, "disposable domains merged");
    } catch {
      // optional file
    }
  }
}

const BUILTIN = new Set(
  [
    "mailinator.com",
    "guerrillamail.com",
    "yopmail.com",
    "tempmail.com",
    "10minutemail.com",
    "trashmail.com",
    "getnada.com",
    "disposable.com",
  ].map((d) => d.toLowerCase())
);

function findDataFile(name: string): string {
  const c = getConfig();
  const fromEnv = path.resolve(process.cwd(), c.DATA_DIR, name);
  return fromEnv;
}

export function isDisposableDomainSync(domain: string): boolean {
  return BUILTIN.has(domain.toLowerCase()) || fileLoaded.has(domain.toLowerCase());
}

export async function ensureDisposableListLoaded(): Promise<void> {
  if (loadFilePromise) return loadFilePromise;
  loadFilePromise = readDisposableFiles();
  return loadFilePromise;
}

/** Re-reads disposable files from disk and replaces the in-memory set (e.g. after a scheduled list sync). */
export async function reloadDisposableListFromDisk(): Promise<void> {
  loadFilePromise = null;
  loadFilePromise = readDisposableFiles();
  await loadFilePromise;
}
