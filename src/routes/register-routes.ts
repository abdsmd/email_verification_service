import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.route.js";
import { registerVerifyRoutes } from "./verify.route.js";
import { registerBatchRoutes } from "./batch.route.js";
import { registerMetricsRoutes } from "./metrics.route.js";
import { registerUsageRoute } from "./usage.route.js";
import { registerVerifyJobsRoutes } from "./verify-jobs.route.js";
import { registerCacheRoutes } from "./cache.route.js";
import { registerCooldownRoutes } from "./cooldown.route.js";
import { registerPwaStaticFiles } from "../pwa/register-static.js";

export type RegisterHttpRoutesOptions = {
  asyncVerifyJobsEnabled: boolean;
};

/**
 * All HTTP API routes and static PWA assets, in a single ordered list (middleware runs first in app).
 */
export async function registerHttpRoutes(
  app: FastifyInstance,
  options: RegisterHttpRoutesOptions
): Promise<void> {
  registerHealthRoutes(app);
  registerVerifyRoutes(app);
  registerBatchRoutes(app);
  registerMetricsRoutes(app);
  registerUsageRoute(app);
  registerVerifyJobsRoutes(app, options.asyncVerifyJobsEnabled);
  registerCacheRoutes(app);
  registerCooldownRoutes(app);
  await registerPwaStaticFiles(app);
}
