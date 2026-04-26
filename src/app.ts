import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { getConfig } from "./config/env.js";
import { registerServerRateLimit } from "./middleware/rate-limit.middleware.js";
import { registerErrorHandler, registerNotFoundHandler } from "./middleware/error.middleware.js";
import { registerAuthPreHandler } from "./middleware/auth.middleware.js";
import { registerHmacPreHandler } from "./middleware/hmac.middleware.js";
import { registerIpAllowlistPreHandler } from "./middleware/ip-allowlist.middleware.js";
import { registerRequestIdHook } from "./middleware/request-id.middleware.js";
import { registerHttpRoutes } from "./routes/register-routes.js";
import { ensureDisposableListLoaded } from "./services/disposable.service.js";
import { ensureRolePrefixesLoaded } from "./services/role.service.js";
import { initializeProviderCooldownModule } from "./services/provider-cooldown.service.js";
import type { FastifyRequest } from "fastify";

function registerJsonWithRawBody(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req: FastifyRequest, body: string, done) => {
      try {
        req.rawBody = body;
        if (!body || body.length === 0) {
          done(null, {});
          return;
        }
        done(null, JSON.parse(body) as unknown);
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  );
}

export async function buildApp(): Promise<FastifyInstance> {
  const c = getConfig();
  await ensureDisposableListLoaded();
  await ensureRolePrefixesLoaded();
  initializeProviderCooldownModule();

  const app = Fastify({
    logger: false,
    requestIdLogLabel: "reqId",
    bodyLimit: c.REQUEST_BODY_MAX_BYTES,
    trustProxy: c.TRUST_PROXY,
    requestTimeout: c.HTTP_REQUEST_TIMEOUT_MS,
    ...(c.HTTP_CONNECTION_TIMEOUT_MS > 0
      ? { connectionTimeout: c.HTTP_CONNECTION_TIMEOUT_MS }
      : {}),
    genReqId: (req) =>
      (req.headers["x-request-id"] as string) ||
      `vs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  });

  if (c.API_DOCS_ENABLED) {
    const { registerOpenApiIfEnabled } = await import("./openapi/register-openapi.js");
    await registerOpenApiIfEnabled(app, true);
  }

  registerJsonWithRawBody(app);
  registerRequestIdHook(app);
  registerIpAllowlistPreHandler(app);
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
  registerErrorHandler(app);
  registerNotFoundHandler(app);
  registerAuthPreHandler(app);
  registerHmacPreHandler(app);
  await registerServerRateLimit(app);
  if (c.CORS_ENABLED) {
    await app.register(cors, {
      origin: c.CORS_ORIGIN ? c.CORS_ORIGIN.split(",").map((s) => s.trim()) : false,
    });
  }

  await registerHttpRoutes(app, { asyncVerifyJobsEnabled: c.ASYNC_VERIFY_JOBS_ENABLED });

  return app;
}
