import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ ok: true, service: "verification-station" }));
  app.get("/v1/ready", async () => ({ ready: true }));
}
