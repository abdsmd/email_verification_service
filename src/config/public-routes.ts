import { requestPath } from "../utils/request-path.js";

/**
 * Routes that skip bearer / HMAC / allowlist (health, metrics, ready probes, PWA shell).
 */
export function isPublicPath(url: string): boolean {
  const p = requestPath(url);
  if (p.startsWith("/health") || p.startsWith("/v1/ready") || p.startsWith("/v1/metrics")) {
    return true;
  }
  if (p === "/" || p === "/index.html" || p === "/manual-verify") return true;
  if (p.startsWith("/icons/") || p.startsWith("/css/")) return true;
  if (
    p === "/manifest.webmanifest" ||
    p === "/sw.js" ||
    p === "/favicon.svg" ||
    p === "/offline.html"
  ) {
    return true;
  }
  return false;
}
