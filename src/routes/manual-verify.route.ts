import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { getLogger } from "../utils/logger.js";

const log = getLogger();

function manualVerifyHtmlPath(): string {
  return path.join(process.cwd(), "public", "manual-verify.html");
}

/**
 * Serves the manual verify UI at GET /manual-verify (HTML), independent of PWA_ENABLED.
 */
export function registerManualVerifyPage(app: FastifyInstance): void {
  app.get("/manual-verify", async (_req, reply) => {
    const htmlPath = manualVerifyHtmlPath();
    if (!fs.existsSync(htmlPath)) {
      log.warn({ htmlPath }, "manual verify page missing");
      return reply.status(503).send({
        error: "service_unavailable",
        message: "manual verify page is not available (public/manual-verify.html missing)",
      });
    }
    const html = fs.readFileSync(htmlPath, "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });
}
