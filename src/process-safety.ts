import { getLogger } from "./utils/logger.js";

function isTestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

let registered = false;

/**
 * Unhandled errors are always logged. In production/development, the process exits so PM2 can restart
 * a potentially corrupted worker. In Vitest, we only log (exit would kill the test run).
 */
export function registerProcessSafetyHandlers(): void {
  if (registered) {
    return;
  }
  registered = true;
  const log = getLogger();
  const exitAfterLog = (code: number) => {
    if (!isTestRuntime()) {
      process.exit(code);
    }
  };

  process.on("uncaughtException", (err, origin) => {
    try {
      log.fatal({ err, origin }, "uncaughtException");
    } catch {
      console.error("uncaughtException (logger failed)", err, origin);
    }
    exitAfterLog(1);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    try {
      log.fatal({ err, reason: reason === err ? undefined : String(reason) }, "unhandledRejection");
    } catch {
      console.error("unhandledRejection (logger failed)", err);
    }
    exitAfterLog(1);
  });
}
