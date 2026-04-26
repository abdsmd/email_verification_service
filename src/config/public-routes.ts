import { requestPath } from "../utils/request-path.js";

/**
 * Routes that skip bearer / HMAC / allowlist (health, metrics, ready probes).
 */
export function isPublicPath(url: string): boolean {
  const p = requestPath(url);
  return p.startsWith("/health") || p.startsWith("/v1/ready") || p.startsWith("/v1/metrics");
}
