import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config/env.js";
import { HttpErrorStatus } from "../config/status-codes.js";
import { getLogger } from "../utils/logger.js";
import { isPublicPath } from "../config/public-routes.js";
import { requestPath } from "../utils/request-path.js";
import { getTenantKeyList, matchTenantForBearer } from "../config/tenant-keys.js";

function extractBearer(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}

/** Shared token for `Authorization: Bearer` when not using `TENANT_KEYS_JSON` (prefer STATION_SECRET, then API_KEY). */
export function getStationBearerToken(): string | undefined {
  const c = getConfig();
  const t = c.STATION_SECRET?.trim() || c.API_KEY?.trim();
  return t && t.length > 0 ? t : undefined;
}

const log = getLogger();

function applyLegacySingleKeyAuth(
  token: string | undefined,
  key: string
): { ok: true; tenantId: string; rateMax: number } | { ok: false } {
  if (token !== key) {
    return { ok: false };
  }
  const c = getConfig();
  return { ok: true, tenantId: "default", rateMax: c.RATE_LIMIT_MAX };
}

export function registerAuthPreHandler(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = requestPath(req.url);
    if (isPublicPath(path)) {
      return;
    }
    const { fromJson, list } = getTenantKeyList();
    if (fromJson && list.length > 0) {
      const token = extractBearer(req.headers.authorization);
      const m = matchTenantForBearer(token);
      if (m) {
        req.tenantId = m.id;
        req.tenantRateMax = m.rateLimitRpm;
        return;
      }
      log.warn(
        {
          path,
          method: req.method,
          ip: req.ip,
          hasAuthHeader: Boolean(req.headers.authorization),
          reason: "bearer_invalid_or_missing_multi_tenant",
        },
        "auth denied"
      );
      return reply.status(HttpErrorStatus.UNAUTHORIZED).send({ error: "unauthorized" });
    }
    const key = getStationBearerToken();
    if (!key) {
      return;
    }
    const token = extractBearer(req.headers.authorization);
    const r = applyLegacySingleKeyAuth(token, key);
    if (!r.ok) {
      log.warn(
        {
          path,
          method: req.method,
          ip: req.ip,
          hasAuthHeader: Boolean(req.headers.authorization),
          reason: "bearer_invalid_or_missing",
        },
        "auth denied"
      );
      return reply.status(HttpErrorStatus.UNAUTHORIZED).send({ error: "unauthorized" });
    }
    req.tenantId = r.tenantId;
    req.tenantRateMax = r.rateMax;
  });
}
