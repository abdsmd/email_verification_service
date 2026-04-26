import type { FastifyInstance } from "fastify";
import type { OpenAPIV3 } from "openapi-types";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { openApiV1Document } from "./spec.js";

export async function registerOpenApiIfEnabled(
  app: FastifyInstance,
  enabled: boolean
): Promise<void> {
  if (!enabled) {
    return;
  }
  await app.register(swagger, {
    mode: "static",
    specification: { document: openApiV1Document as unknown as OpenAPIV3.Document },
  });
  await app.register(swaggerUi, {
    routePrefix: "/v1/docs",
  });
}
