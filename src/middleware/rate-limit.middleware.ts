import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { getConfig } from "../config/env.js";
import { getRedisClient } from "../services/redis.client.js";

export async function registerServerRateLimit(app: FastifyInstance): Promise<void> {
  const c = getConfig();
  const redis = getRedisClient();
  await app.register(rateLimit, {
    max: (req: FastifyRequest) => {
      if (req.tenantRateMax !== undefined) {
        return req.tenantRateMax;
      }
      return c.RATE_LIMIT_MAX;
    },
    timeWindow: c.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req: FastifyRequest) => {
      if (req.tenantId) {
        return `${req.tenantId}:${req.ip}`;
      }
      return `ip:${req.ip}`;
    },
    ...(redis
      ? { redis, skipOnError: true, nameSpace: "vs-rl:" }
      : {}),
  });
}
