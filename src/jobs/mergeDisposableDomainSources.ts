import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Upstream lists merged into `disposable-domains.txt` (see README). */
export const DISPOSABLE_DOMAIN_SOURCES: readonly { name: string; url: string }[] = [
  {
    name: "disposable-email-domains/blocklist",
    url: "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf",
  },
  {
    name: "disposable/disposable (domains.txt)",
    url: "https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt",
  },
];

function parseDomains(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export type MergeDisposableResult = {
  changed: boolean;
  uniqueCount: number;
  sources: { name: string; count: number; url: string }[];
};

let mergeChain: Promise<unknown> = Promise.resolve();

/**
 * Fetches both upstream lists, dedupes, sorts, writes `outPath` only if content changed.
 * Serialized so overlapping CLI + in-process job do not clobber the same file.
 */
export function mergeDisposableDomainSources(outPath: string): Promise<MergeDisposableResult> {
  const run = async (): Promise<MergeDisposableResult> => {
    const results = await Promise.all(
      DISPOSABLE_DOMAIN_SOURCES.map(async ({ name, url }) => {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`${name}: HTTP ${res.status} for ${url}`);
        }
        const text = await res.text();
        const domains = parseDomains(text);
        return { name, url, count: domains.length, domains };
      })
    );

    const merged = new Set<string>();
    for (const { domains } of results) {
      for (const d of domains) {
        merged.add(d);
      }
    }

    const unique = Array.from(merged);
    unique.sort();

    const bySource = results
      .map((r) => `    #   - ${r.name}: ${r.count} (pre-dedup)`)
      .join("\n");
    const sourceUrls = results.map((r) => `    #   - ${r.url}`).join("\n");
    const today = new Date().toISOString().slice(0, 10);

    const header = `# Disposable email domains (merged blocklist, deduplicated, sorted)
# This file is auto-generated. Do not edit by hand (changes are overwritten on update).
# Sources (union):
#   1) disposable-email-domains/disposable-email-domains — community-vetted list
#   2) disposable/disposable project output — large aggregated list (also may flag more edge cases; see upstream)
${sourceUrls}
# Local: npm run update:disposable-list
# In-process schedule: see DISPOSABLE_LIST_CRON_* in .env; GitHub: .github/workflows/update-disposable-domains.yml
# Last merge: ${today} — unique domains: ${unique.length}
# Per-source line counts (before merge; overlap removed in ${unique.length}):
${bySource}
# Runtime: set DISPOSABLE_LIST_PATH to merge an additional file at startup if needed.

`;

    const body = header + unique.join("\n") + "\n";
    const digest = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

    let previous = "";
    try {
      previous = await fs.readFile(outPath, "utf8");
    } catch {
      // missing file: always write
    }

    if (digest(previous) === digest(body)) {
      return {
        changed: false,
        uniqueCount: unique.length,
        sources: results.map((r) => ({ name: r.name, count: r.count, url: r.url })),
      };
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, body, "utf8");

    return {
      changed: true,
      uniqueCount: unique.length,
      sources: results.map((r) => ({ name: r.name, count: r.count, url: r.url })),
    };
  };

  const p = mergeChain.then(run) as Promise<MergeDisposableResult>;
  mergeChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}
