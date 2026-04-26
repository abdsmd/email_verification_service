import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { getConfig } from "../config/env.js";

export async function registerServerRateLimit(app: FastifyInstance): Promise<void> {
  const c = getConfig();
  await app.register(rateLimit, {
    max: c.RATE_LIMIT_MAX,
    timeWindow: c.RATE_LIMIT_WINDOW_MS,
  });
}
