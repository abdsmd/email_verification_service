import net from "node:net";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { TimeoutError, withTimeout } from "../utils/timeout.js";
import {
  categorizeSmtpReply,
  classifySmtp,
  LineReader,
  mapSmtpSocketErrno,
  readSmtpResponse,
  writeSocket,
} from "./smtp-code-parser.service.js";
import { setMxHealthCache } from "./cache.service.js";
import type { RcptResult, SmtpClass } from "../types/smtp.types.js";
import { getSmtpRetryConfig } from "./retry-policy.service.js";
import { recordSmtpNetworkFailure } from "./provider-cooldown.service.js";
import { withProviderSmtpConcurrency } from "./provider-smtp-concurrency.service.js";
import { getSmtpHeloName, getSmtpMailFromAddress } from "../config/env.js";
import { canTryAnotherMxForTransient, isTransientRcptSuitableForNextMx } from "../utils/mx-transient-fallback.js";
import type { BigProviderId } from "../types/provider.types.js";

const log = getLogger();

function toRcpt(
  cl: { class: SmtpClass; line: string; providerBlockHint: boolean },
  code: number,
  lines: string[]
): RcptResult {
  if (cl.class === "protocol_error" || cl.class === "mx_unreachable") {
    return { kind: "mx_fail", error: "protocol", message: cl.line };
  }
  return {
    kind: "rcpt",
    class: cl.class,
    text: cl.line,
    code,
    providerBlock: cl.providerBlockHint,
    semantic: categorizeSmtpReply(code, lines),
  };
}

type SessionArgs = {
  host: string;
  port: number;
  helo: string;
  fromAddr: string;
  rcpt: string;
  connectMs: number;
  cmdMs: number;
};

function connectWithTimeout(
  host: string,
  port: number,
  connectMs: number
): Promise<net.Socket> {
  return withTimeout(
    new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection({ host, port, allowHalfOpen: false });
      const onConnect = () => {
        s.removeListener("error", onError);
        resolve(s);
      };
      const onError = (e: Error) => {
        s.removeListener("connect", onConnect);
        s.destroy();
        reject(e);
      };
      s.once("connect", onConnect);
      s.once("error", onError);
    }),
    connectMs,
    "tcp connect " + host
  );
}

async function runSmtpSession(a: SessionArgs): Promise<RcptResult> {
  const c = getConfig();
  const socket = await connectWithTimeout(a.host, a.port, a.connectMs);
  const reader = new LineReader();
  let wallTimer: ReturnType<typeof setTimeout> | undefined;

  const readLineCmd = () =>
    withTimeout(reader.readLine(), a.cmdMs, "smtp read") as Promise<string | null>;
  const readLineBanner = () =>
    withTimeout(reader.readLine(), c.SMTP_BANNER_READ_TIMEOUT_MS, "smtp banner") as Promise<string | null>;

  const done = (r: RcptResult) => {
    if (wallTimer !== undefined) {
      clearTimeout(wallTimer);
      wallTimer = undefined;
    }
    try {
      socket.removeAllListeners("timeout");
    } catch {
      // ignore
    }
    try {
      socket.setTimeout(0);
    } catch {
      // ignore
    }
    try {
      void writeSocket(socket, "QUIT\r\n");
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        socket.end();
        socket.destroy();
      } catch {
        // ignore
      }
      reader.end();
    }, 30);
    return r;
  };

  try {
    wallTimer = setTimeout(() => {
      log.debug({ host: a.host }, "smtp session wall clock exceeded");
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reader.end();
    }, c.SMTP_SESSION_MAX_MS);

    socket.setTimeout(Math.max(c.SMTP_COMMAND_TIMEOUT_MS * 2, 5_000));
    socket.on("timeout", () => {
      log.debug({ host: a.host }, "smtp socket idle timeout");
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reader.end();
    });
    socket.on("data", (ch) => reader.pushData(ch));
    socket.on("end", () => reader.end());
    socket.on("close", () => reader.end());

    const banner = await readSmtpResponse(() => readLineBanner() as Promise<string | null>);
    if ("error" in banner) {
      return done({ kind: "mx_fail", error: "protocol", message: banner.message, smtpSocketReason: "smtp_connect_failed" });
    }
    if (banner.code !== 220) {
      return done({ kind: "mx_fail", error: "protocol", message: `banner ${banner.code}`, smtpSocketReason: "smtp_connect_failed" });
    }

    await writeSocket(socket, `EHLO ${a.helo}\r\n`);
    const eR = await readSmtpResponse(() => readLineCmd() as Promise<string | null>);
    const ehloOk = !("error" in eR) && eR.code >= 200 && eR.code < 300;
    if (!ehloOk) {
      await writeSocket(socket, `HELO ${a.helo}\r\n`);
      const hR = await readSmtpResponse(() => readLineCmd() as Promise<string | null>);
      if ("error" in hR || hR.code < 200 || hR.code >= 300) {
        return done({ kind: "mx_fail", error: "protocol", message: "HELO", smtpSocketReason: "smtp_connect_failed" });
      }
    }

    await writeSocket(socket, `MAIL FROM:<${a.fromAddr}>\r\n`);
    const mR = await readSmtpResponse(() => readLineCmd() as Promise<string | null>);
    if ("error" in mR) {
      return done({ kind: "mx_fail", error: "protocol", message: "MAIL", smtpSocketReason: "smtp_connect_failed" });
    }
    if (mR.code < 200 || mR.code >= 300) {
      const cl = classifySmtp(mR.code, mR.lines);
      return done(toRcpt(cl, mR.code, mR.lines));
    }

    await writeSocket(socket, `RCPT TO:<${a.rcpt}>\r\n`);
    const rR = await readSmtpResponse(() => readLineCmd() as Promise<string | null>);
    if ("error" in rR) {
      return done({ kind: "mx_fail", error: "protocol", message: "RCPT", smtpSocketReason: "smtp_connect_failed" });
    }
    const cl = classifySmtp(rR.code, rR.lines);
    return done(toRcpt(cl, rR.code, rR.lines));
  } catch (e) {
    if (wallTimer !== undefined) {
      clearTimeout(wallTimer);
      wallTimer = undefined;
    }
    try {
      socket.removeAllListeners("timeout");
    } catch {
      // ignore
    }
    try {
      socket.setTimeout(0);
    } catch {
      // ignore
    }
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    reader.end();
    throw e;
  }
}

export type RcptCheckOptions = {
  toAddress: string;
  provider?: BigProviderId;
  /**
   * When set with env `MX_RCPT_TRANSIENT_FALLBACK_ENABLED`, a transient/greylist RCPT
   * on an MX can fall through to the next host (capped) — not used for big freemail in verify.
   */
  allowTransientRcptMxFallback?: boolean;
  /** Slower inter-retry delay for throttled big providers (env `SMTP_RETRY_BIG_PROVIDER_MULT`). */
  useBigProviderRetryMult?: boolean;
};

async function probeRcptUnscoped(
  mxHosts: string[],
  check: RcptCheckOptions
): Promise<RcptResult> {
  const c = getConfig();
  const { retries, baseDelayMs } = getSmtpRetryConfig(
    check.useBigProviderRetryMult === true
  );
  const helo = getSmtpHeloName();
  const fromAddr = getSmtpMailFromAddress();

  let lastFail: RcptResult = { kind: "all_mx_failed" };
  let lastHostTried = "";
  const allowTransientMx =
    check.allowTransientRcptMxFallback === true &&
    c.MX_RCPT_TRANSIENT_FALLBACK_ENABLED;
  const maxExtra = c.MX_RCPT_TRANSIENT_FALLBACK_MAX_EXTRA;
  let extraTransientHops = 0;

  mx: for (let mxi = 0; mxi < mxHosts.length; mxi++) {
    const host = mxHosts[mxi];
    lastHostTried = host;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const r = await runSmtpSession({
          host,
          port: 25,
          helo,
          fromAddr,
          rcpt: check.toAddress,
          connectMs: c.SMTP_CONNECT_TIMEOUT_MS,
          cmdMs: c.SMTP_COMMAND_TIMEOUT_MS,
        });
        if (r.kind === "rcpt") {
          if (
            allowTransientMx &&
            isTransientRcptSuitableForNextMx(r) &&
            canTryAnotherMxForTransient({
              mxi,
              mxCount: mxHosts.length,
              extraTriesSoFar: extraTransientHops,
              maxExtra,
            })
          ) {
            extraTransientHops += 1;
            log.debug(
              { host, mxi, extraTransientHops, code: r.code, semantic: r.semantic },
              "smtp: transient rcpt, trying next mx"
            );
            continue mx;
          }
          return r;
        }
        lastFail = r;
        if (mxi < mxHosts.length - 1) {
          break;
        }
        if (attempt < retries) {
          await sleep(baseDelayMs * (attempt + 1));
        }
      } catch (e) {
        if (e instanceof TimeoutError) {
          log.debug({ host, err: (e as Error).message }, "smtp timeout");
          lastFail = {
            kind: "mx_fail",
            error: "timeout",
            message: (e as Error).message,
            smtpSocketReason: mapSmtpSocketErrno("timeout", undefined),
          };
          if (attempt < retries) {
            await sleep(baseDelayMs * (attempt + 1));
            continue;
          }
          if (mxi < mxHosts.length - 1) break;
          return lastFail;
        }
        const err = e as NodeJS.ErrnoException;
        const errno = err.code;
        const n = typeof errno === "string" ? errno : undefined;
        lastFail = {
          kind: "mx_fail",
          error: "connect",
          message: (e as Error).message,
          errno: n,
          smtpSocketReason: mapSmtpSocketErrno("connect", n),
        };
        if (
          err.code === "ECONNREFUSED" ||
          err.code === "EHOSTUNREACH" ||
          err.code === "ENETUNREACH" ||
          err.code === "ETIMEDOUT" ||
          err.code === "ECONNRESET" ||
          err.code === "EPIPE"
        ) {
          log.debug({ host, code: err.code }, "smtp connect error");
          break;
        }
        if (mxi < mxHosts.length - 1) break;
        return lastFail;
      }
    }
  }
  if (lastFail.kind === "mx_fail" && lastHostTried) {
    setMxHealthCache(lastHostTried, {
      host: lastHostTried,
      status: "fail",
      at: Date.now(),
      socketReason: lastFail.smtpSocketReason,
    });
  }
  if (lastFail.kind === "mx_fail" && check.provider && check.provider !== "other") {
    if (lastFail.error === "timeout") {
      recordSmtpNetworkFailure(check.provider, { kind: "timeout", message: lastFail.message });
    } else {
      const n = lastFail.errno;
      if (n === "ECONNREFUSED") {
        recordSmtpNetworkFailure(check.provider, { kind: "connect_refused", errno: n, message: lastFail.message });
      } else if (n === "ECONNRESET" || n === "EPIPE" || n === "ECONNABORTED") {
        recordSmtpNetworkFailure(check.provider, { kind: "connect_reset", errno: n, message: lastFail.message });
      } else {
        recordSmtpNetworkFailure(check.provider, { kind: "connect_error", errno: n, message: lastFail.message });
      }
    }
  }
  if (lastFail.kind === "mx_fail") {
    return lastFail;
  }
  return { kind: "all_mx_failed" };
}

export async function probeRcpt(
  mxHosts: string[],
  check: RcptCheckOptions
): Promise<RcptResult> {
  return withProviderSmtpConcurrency(check.provider, () => probeRcptUnscoped(mxHosts, check));
}
