import { describe, it, expect } from "vitest";
import {
  parseSmtpStatusLine,
  LineReader,
  readSmtpResponse,
  classifySmtp,
  categorizeSmtpReply,
  mapSmtpSocketErrno,
} from "../src/services/smtp-code-parser.service.js";

const L = (code: number, rest: string) => [`${String(code)} ${rest}`];

describe("smtp-code-parser", () => {
  it("parseSmtpStatusLine", () => {
    const a = parseSmtpStatusLine("250-OK");
    expect(a.code).toBe(250);
    expect(a.more).toBe(true);
    const b = parseSmtpStatusLine("250 OK");
    expect(b.more).toBe(false);
  });
  it("readSmtpResponse multiline", async () => {
    const r = new LineReader();
    r.pushData("250-test\r\n");
    r.pushData("250 done\r\n");
    const readLine = () => r.readLine();
    const res = await readSmtpResponse(() => readLine() as Promise<string | null>);
    if ("error" in res) {
      expect.fail("expected reply");
    }
    expect(res.code).toBe(250);
  });

  it("categorizeSmtpReply and classifySmtp: 250 vs 252 vs 550", () => {
    expect(categorizeSmtpReply(250, L(250, "ok"))).toBe("mailbox_ok");
    expect(categorizeSmtpReply(252, L(252, "x"))).toBe("accept_deferred");
    expect(classifySmtp(250, L(250, "x")).class).toBe("accept");
    expect(classifySmtp(252, L(252, "cannot verify user")).class).toBe("temporary");
    expect(classifySmtp(550, L(550, "nope")).class).toBe("permanent_reject");
  });

  it("mapSmtpSocketErrno maps errno to stable reasons", () => {
    expect(mapSmtpSocketErrno("timeout", undefined)).toBe("smtp_timeout");
    expect(mapSmtpSocketErrno("connect", "ECONNREFUSED")).toBe("smtp_connect_failed");
    expect(mapSmtpSocketErrno("connect", "ETIMEDOUT")).toBe("smtp_timeout");
    expect(mapSmtpSocketErrno("connect", "ECONNRESET")).toBe("smtp_connection_reset");
    expect(mapSmtpSocketErrno("connect", "EHOSTUNREACH")).toBe("mx_unreachable");
  });
});
