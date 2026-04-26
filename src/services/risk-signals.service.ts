/**
 * Optional non-blocking signals (high-risk TLD, common freemail typos) for integrator UX.
 * Does not change verification codes unless you build policy on the client.
 */

const HIGH_RISK_TLD = new Set([
  "zip",
  "mov",
  "top",
  "work",
  "click",
  "review",
  "xyz",
  "icu",
  "buzz",
  "gq",
  "ml",
  "tk",
  "ga",
  "cf",
  "sbs",
]);

/** common typo / homograph domain → likely intended base domain (informational) */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmai.com": "gmail.com",
  "gmailc.om": "gmail.com",
  "gmail.co": "gmail.com",
  "gnail.com": "gmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "ymail.co": "yahoo.com",
  "outlok.com": "outlook.com",
  "outook.com": "outlook.com",
  "hotmial.com": "hotmail.com",
  "hotrmail.com": "hotmail.com",
};

function tldOf(domain: string): string {
  const p = domain.toLowerCase().split(".");
  return p.length >= 2 ? (p.at(-1) ?? "") : "";
}

export type EmailSignals = {
  highRiskTld?: boolean;
  possibleTypoOf?: string;
};

export function computeEmailSignals(_local: string, domain: string): EmailSignals {
  const d = domain.toLowerCase();
  const tld = tldOf(d);
  const out: EmailSignals = {};

  if (tld && HIGH_RISK_TLD.has(tld)) {
    out.highRiskTld = true;
  }

  const tip = DOMAIN_TYPOS[d];
  if (tip) {
    out.possibleTypoOf = tip;
  }

  if (out.highRiskTld === undefined && !out.possibleTypoOf) {
    return {};
  }
  return out;
}
