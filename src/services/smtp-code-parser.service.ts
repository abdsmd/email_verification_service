import net from "node:net";
import type { SmtpClass, SmtpRcptSemantic, SmtpSocketErrorReason } from "../types/smtp.types.js";

// --- SMTP line parsing (wire format) ---

export function parseSmtpStatusLine(
  line: string
): { code: number; more: boolean; rest: string } {
  const m = line.match(/^(\d{3})([- ])(.*)$/);
  if (!m) {
    return { code: 0, more: false, rest: line };
  }
  return { code: Number(m[1]), more: m[2] === "-", rest: m[3] };
}

export function joinSmtpText(lines: string[]): string {
  return lines.map((l) => l.replace(/^\d{3}[- ]?/, "")).join(" ").trim();
}

/*
 * Application-layer mapping from numeric SMTP reply codes and multiline text to internal
 * semantics. RFC 5321 class: 2xx success, 4xx transient, 5xx permanent (for our purposes;
 * some servers abuse 4xx/5xx—text heuristics in `classifySmtp` refine that).
 *
 * RCPT-specific: 250/251 = mailbox OK; 252 = VRFY-style “will try” (we treat as deferred risk);
 * 421 = service closing; 450/451 = temp mailbox/policy; 452 = no storage; 550/551/552/553/554
 * = various rejects (we split by semantic + line text, not by code alone).
 */
const BLOCK_PATTERNS = [
  /blocked/i,
  /block\s*list/i,
  /rate\s*limit/i,
  /reputation/i,
  /dynamic\s*ip/i,
  /rbl/i,
  /spamhaus/i,
  /policy/i,
  /not\s*allowed/i,
  /client\s*host\s*rejected/i,
  /access\s*denied/i,
  /banned/i,
  /rejected\s+due/i,
  /** Yahoo (and similar): sender-IP / reputation — not “mailbox does not exist” */
  /\bTSS\d+/i,
  /all messages from .+will be .+deferred/i,
  /postmaster\.yahooinc\.com/i,
];

export function isProviderBlockText(s: string): boolean {
  return BLOCK_PATTERNS.some((p) => p.test(s));
}

/**
 * Narrow numeric code to a `SmtpRcptSemantic` (multiline text is *not* used here; use
 * `classifySmtp` when you need line-based heuristics, e.g. 552 with “quota” vs “size”).
 */
export function categorizeSmtpReply(code: number, _lines: string[]): SmtpRcptSemantic {
  if (code === 250 || code === 251) return "mailbox_ok";
  if (code === 252) return "accept_deferred";
  if (code === 421) return "service_unavailable";
  if (code === 450) return "temp_mailbox";
  if (code === 451) return "temp_local";
  if (code === 452) return "insufficient_storage";
  if (code === 550) return "reject_mailbox";
  if (code === 551) return "reject_not_local";
  if (code === 552) return "limit_exceeded";
  if (code === 553) return "reject_invalid";
  if (code === 554) return "transaction_failed";
  return "other";
}

/** Transport-level errno → stable reason strings for the API. */
export function mapSmtpSocketErrno(
  error: "connect" | "timeout" | "protocol",
  errno?: string
): SmtpSocketErrorReason {
  if (error === "timeout") return "smtp_timeout";
  if (error === "protocol") return "smtp_connect_failed";
  if (!errno) return "smtp_connect_failed";
  switch (errno) {
    case "ECONNREFUSED":
      return "smtp_connect_failed";
    case "ETIMEDOUT":
      return "smtp_timeout";
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
      return "smtp_connection_reset";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "mx_unreachable";
    default:
      return "smtp_connect_failed";
  }
}

/**
 * Maps a full multiline SMTP response to a coarse class. Transient 4xx and “try again” 5xx
 * must *not* be classified as `permanent_reject`—we surface those as `retry_later` / `greylisted`
 * upstream so clients do not treat a greylist as a hard “invalid address”.
 * Order: handle 250/251/252 and 552 before broad 2xx/5xx ranges.
 */
export function classifySmtp(
  code: number,
  lines: string[]
): { class: SmtpClass; line: string; providerBlockHint: boolean } {
  const text = joinSmtpText(lines);
  if (code === 250 || code === 251) {
    return { class: "accept", line: text, providerBlockHint: false };
  }
  if (code === 252) {
    return { class: "temporary", line: text, providerBlockHint: isProviderBlockText(text) };
  }
  if (code === 552) {
    return { class: "temporary", line: text, providerBlockHint: isProviderBlockText(text) };
  }
  if (code >= 500 && code < 600) {
    if (isProviderBlockText(text)) {
      return { class: "provider_block", line: text, providerBlockHint: true };
    }
    if (code === 550 || code === 551 || code === 553) {
      return { class: "permanent_reject", line: text, providerBlockHint: false };
    }
    if (code === 554) {
      return { class: "permanent_reject", line: text, providerBlockHint: false };
    }
    return { class: "permanent_reject", line: text, providerBlockHint: isProviderBlockText(text) };
  }
  if (code === 421) {
    return { class: "temporary", line: text, providerBlockHint: isProviderBlockText(text) };
  }
  if (code >= 400 && code < 500) {
    if (isProviderBlockText(text) && (code === 450 || code === 451)) {
      return { class: "provider_block", line: text, providerBlockHint: true };
    }
    return { class: "temporary", line: text, providerBlockHint: isProviderBlockText(text) };
  }
  if (code >= 200 && code < 300) {
    return { class: "accept", line: text, providerBlockHint: false };
  }
  return { class: "protocol_error", line: text, providerBlockHint: false };
}
export type SmtpMultiline = { code: number; lines: string[]; raw: string };

export class LineReader {
  private buf = "";
  private q: string[] = [];
  private resolvers: Array<(v: string | null) => void> = [];
  private ended = false;

  pushData(chunk: Buffer | string) {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("binary");
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const t = line.replace(/\r$/, "");
      this.q.push(t);
      const r = this.resolvers.shift();
      if (r) r(t);
    }
  }

  end() {
    this.ended = true;
    for (const r of this.resolvers) r(null);
    this.resolvers = [];
  }

  readLine(): Promise<string | null> {
    if (this.q.length) return Promise.resolve(this.q.shift()!);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

const MAX_SMTP_MULTILINE_LINES = 200;

export async function readSmtpResponse(
  readLine: () => Promise<string | null>
): Promise<SmtpMultiline | { error: true; message: string }> {
  const lines: string[] = [];
  while (true) {
    if (lines.length > MAX_SMTP_MULTILINE_LINES) {
      return { error: true, message: "multiline smtp response too large" };
    }
    const l = await readLine();
    if (l == null) {
      return { error: true, message: "connection closed" };
    }
    lines.push(l);
    const p = parseSmtpStatusLine(l);
    if (p.code > 0 && !p.more) {
      return { code: p.code, lines, raw: lines.join("\n") };
    }
  }
}

export async function writeSocket(socket: net.Socket, data: string): Promise<void> {
  return new Promise((res, rej) => {
    socket.write(data, (e) => (e ? rej(e) : res()));
  });
}
