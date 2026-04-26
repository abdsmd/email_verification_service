import pino from "pino";
import { getConfig } from "../config/env.js";

export function buildLogger() {
  const c = getConfig();
  return pino({
    level: c.LOG_LEVEL,
    name: "verification-station",
    formatters: { level: (label) => ({ level: label }) },
    ...(c.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:isoDateTime" },
          },
        }
      : {}),
  });
}

let root: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!root) root = buildLogger();
  return root;
}
