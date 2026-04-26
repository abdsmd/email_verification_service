const LOCAL_MAX = 64;
const DOMAIN_MAX = 255;

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;

export type ParsedEmail = { local: string; domain: string; raw: string };

export function parseEmail(
  raw: string
): { ok: true; value: ParsedEmail } | { ok: false; reason: string } {
  const s = raw.trim();
  if (s.length < 3 || s.length > 320) {
    return { ok: false, reason: "length" };
  }
  const at = s.lastIndexOf("@");
  if (at < 1 || at === s.length - 1) {
    return { ok: false, reason: "missing_at" };
  }
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  if (local.length > LOCAL_MAX || domain.length > DOMAIN_MAX) {
    return { ok: false, reason: "part_length" };
  }
  if (local.includes("..") || domain.includes("..")) {
    return { ok: false, reason: "consecutive_dot" };
  }
  if (!LOCAL_PART_RE.test(local) || !DOMAIN_RE.test(domain)) {
    return { ok: false, reason: "pattern" };
  }
  return { ok: true, value: { local: local.toLowerCase(), domain, raw: s.toLowerCase() } };
}
