import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger();

/** Resolves to `<cwd>/public` — run `node dist/server.js` (or `npm start`) from the app root, or the Docker WORKDIR. */
function publicRootDir(): string {
  return path.join(process.cwd(), "public");
}

/**
 * Serves the PWA shell (index, manifest, service worker) from the repo /image `public/` directory.
 * Registered after API routes so `/v1/*` wins.
 */
export async function registerPwaStaticFiles(app: FastifyInstance): Promise<void> {
  const c = getConfig();
  if (!c.PWA_ENABLED) {
    return;
  }
  const root = publicRootDir();
  if (!fs.existsSync(root)) {
    log.warn({ root }, "PWA enabled but public directory missing; skip static");
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    decorateReply: false,
  });
  log.info({ root }, "PWA static files registered");
}
