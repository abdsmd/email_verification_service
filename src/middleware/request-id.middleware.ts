import type { FastifyInstance } from "fastify";

/**
 * If client sends `x-request-id` and the framework has not set `id` yet, mirror it
 * (Fastify `genReqId` in buildApp is primary).
 */
export function registerRequestIdHook(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    const x = req.headers["x-request-id"];
    if (typeof x === "string" && x.length > 0 && !req.id) {
      (req as { id: string }).id = x;
    }
  });
}
