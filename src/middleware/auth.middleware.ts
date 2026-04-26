import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config/env.js";
import { HttpErrorStatus } from "../config/status-codes.js";
import { getLogger } from "../utils/logger.js";
import { isPublicPath } from "../config/public-routes.js";
import { requestPath } from "../utils/request-path.js";

function extractBearer(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}

/** Shared token for `Authorization: Bearer` (prefer STATION_SECRET, then API_KEY). */
export function getStationBearerToken(): string | undefined {
  const c = getConfig();
  const t = c.STATION_SECRET?.trim() || c.API_KEY?.trim();
  return t && t.length > 0 ? t : undefined;
}

const log = getLogger();

export function registerAuthPreHandler(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = requestPath(req.url);
    if (isPublicPath(path)) {
      return;
    }
    const key = getStationBearerToken();
    if (!key) {
      return;
    }
    const token = extractBearer(req.headers.authorization);
    if (token !== key) {
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
  });
}
