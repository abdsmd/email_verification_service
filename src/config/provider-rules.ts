import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./env.js";
import type { BigProviderId } from "../types/provider.types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

type KnownJson = {
  domainSuffixes: Record<string, string>;
  mxSubstrings: Array<{ sub: string; id: BigProviderId }>;
};

let loaded: KnownJson | null = null;

function findDataFile(name: string): string {
  const c = getConfig();
  const fromEnv = path.resolve(process.cwd(), c.DATA_DIR, name);
  if (fs.existsSync(fromEnv)) return fromEnv;
  const fromSrc = path.join(process.cwd(), "src", "data", name);
  if (fs.existsSync(fromSrc)) return fromSrc;
  return path.join(here, "..", "data", name);
}

function loadJson(): KnownJson {
  if (loaded) return loaded;
  const p = findDataFile("known-providers.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as KnownJson;
  loaded = raw;
  return raw;
}

export function getDomainToProviderId(domain: string): BigProviderId | null {
  const d = domain.toLowerCase();
  const j = loadJson();
  if (j.domainSuffixes[d]) {
    return j.domainSuffixes[d] as BigProviderId;
  }
  for (const [suffix, id] of Object.entries(j.domainSuffixes)) {
    if (d === suffix || d.endsWith("." + suffix)) {
      return id as BigProviderId;
    }
  }
  // Programmatic heuristics not in JSON
  if (d === "googlemail.com" || d.endsWith(".google.com") || d === "gmail.com") return "gmail";
  if (d === "mail.com" || d.endsWith(".mail.com")) return "mail";
  if (d.includes("outlook.com") || d.includes("hotmail.com") || d.includes("live.com") || d.includes("msn.com") || d.endsWith(".onmicrosoft.com")) {
    return "outlook";
  }
  if (d.includes("protonmail.com") || d.includes("proton.me") || d.includes("pm.me")) return "proton";
  if (d === "rocketmail.com" || d.includes("yahoo.") || d.includes("ymail.com")) return "yahoo";
  if (d === "aol.com" || d.endsWith(".aol.com")) return "aol";
  if (d === "me.com" || d === "mac.com" || d.includes("icloud.com")) return "icloud";
  if (d.includes("zoho.com")) return "zoho";
  if (d.includes("yandex.")) return "yandex";
  if (d === "gmx.net" || d === "gmx.de" || d.includes("gmx.")) return "gmx";
  if (d === "messagingengine.com" || d.includes("fastmail.com")) return "fastmail";
  return null;
}

export function getMxProviderId(mxHost: string): BigProviderId | null {
  const ex = mxHost.toLowerCase();
  const j = loadJson();
  for (const s of j.mxSubstrings) {
    if (ex.includes(s.sub)) return s.id;
  }
  return null;
}
