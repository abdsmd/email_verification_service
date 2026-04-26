import { getConfig, resolveDataPath } from "../config/env.js";
import { mergeDisposableDomainSources } from "../jobs/mergeDisposableDomainSources.js";

const c = getConfig();
const out = resolveDataPath(c.DATA_DIR, "disposable-domains.txt");

mergeDisposableDomainSources(out)
  .then((r) => {
    const parts = r.sources.map((s) => `${s.name}:${s.count}`).join(", ");
    console.log(
      r.changed
        ? `Wrote ${r.uniqueCount} unique domains to ${out} (${parts})`
        : `Unchanged: ${r.uniqueCount} unique domains (${parts})`
    );
    process.exit(0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
