import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config/env.js";
import { HttpErrorStatus } from "../config/status-codes.js";
import { getLogger } from "../utils/logger.js";
import { requestPath } from "../utils/request-path.js";
import { checkAndStoreRequestId } from "../services/hmac-replay.service.js";
import { isPublicPath } from "../config/public-routes.js";

const log = getLogger();

function safeEqHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const MAX_REQUEST_ID_LEN = 256;
const MAX_TS_LEN = 48;

/**
 * Parse `X-Timestamp` to epoch ms. Accepts unix seconds (10 digits), unix ms (13 digits), or ISO-8601.
 */
export function parseTimestampToMs(raw: string): number | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (/^\d{10}$/.test(s)) {
    return Number(s) * 1000;
  }
  if (/^\d{13}$/.test(s)) {
    return Number(s);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function buildHmacSignatureBaseString(timestampHeader: string, rawBody: string): string {
  return `${timestampHeader}.${rawBody}`;
}

export function computeHmacSha256Hex(secret: string, baseString: string): string {
  return createHmac("sha256", secret).update(baseString, "utf8").digest("hex");
}

export function registerHmacPreHandler(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = requestPath(req.url);
    if (isPublicPath(path)) {
      return;
    }
    const secret = getConfig().HMAC_SECRET?.trim();
    if (!secret || secret.length === 0) {
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return;
    }

    const tsRaw = req.headers["x-timestamp"];
    const sig = req.headers["x-signature"];
    const rid = req.headers["x-request-id"];

    if (typeof tsRaw !== "string" || tsRaw.length === 0 || tsRaw.length > MAX_TS_LEN) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_missing_timestamp" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "missing_hmac_timestamp" });
    }
    if (typeof sig !== "string" || sig.length === 0) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_missing_signature" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "missing_hmac_signature" });
    }
    if (typeof rid !== "string" || rid.length === 0 || rid.length > MAX_REQUEST_ID_LEN) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_missing_request_id" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "missing_request_id" });
    }

    const tMs = parseTimestampToMs(tsRaw);
    if (tMs === null) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_bad_timestamp" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "invalid_timestamp" });
    }
    const skew = getConfig().HMAC_SKEW_MS;
    if (Math.abs(Date.now() - tMs) > skew) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_timestamp_skew" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "timestamp_out_of_range" });
    }

    const rawBody = req.rawBody ?? "";
    const base = buildHmacSignatureBaseString(tsRaw, rawBody);
    const expected = computeHmacSha256Hex(secret, base);
    if (!safeEqHex(expected, sig)) {
      log.warn({ path, method: req.method, ip: req.ip, reason: "hmac_signature_mismatch" }, "hmac denied");
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "bad_hmac" });
    }

    if (checkAndStoreRequestId(rid) === "replay") {
      log.warn(
        { path, method: req.method, ip: req.ip, requestId: rid, reason: "hmac_replay" },
        "hmac denied"
      );
      return reply.status(HttpErrorStatus.CONFLICT).send({ error: "request_replay" });
    }
  });
}
