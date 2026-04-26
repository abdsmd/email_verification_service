import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getConfig } from "../config/env.js";
import { HttpErrorStatus } from "../config/status-codes.js";
import { getLogger } from "../utils/logger.js";
import { isPublicPath } from "../config/public-routes.js";

const log = getLogger();

function parseAllowlist(s: string | undefined): Set<string> | null {
  if (!s || s.trim().length === 0) return null;
  const set = new Set(
    s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
  );
  return set.size > 0 ? set : null;
}

export function registerIpAllowlistPreHandler(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(req.url)) {
      return;
    }
    const raw = getConfig().IP_ALLOWLIST;
    const allow = parseAllowlist(raw);
    if (!allow) {
      return;
    }
    const ip = req.ip;
    if (!allow.has(ip)) {
      log.warn(
        { path: req.url, method: req.method, ip, reason: "ip_not_allowed" },
        "forbidden: IP not on allowlist"
      );
      return reply.status(HttpErrorStatus.FORBIDDEN).send({ error: "forbidden" });
    }
  });
}
