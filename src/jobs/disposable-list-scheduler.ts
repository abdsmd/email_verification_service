import cron from "node-cron";
import { resolveDataPath } from "../config/env.js";
import type { AppConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { mergeDisposableDomainSources } from "./mergeDisposableDomainSources.js";
import { reloadDisposableListFromDisk } from "../services/disposable.service.js";

let task: ReturnType<typeof cron.schedule> | null = null;

function scheduleDescription(expression: string, timezone: string): string {
  return `cron "${expression}" (${timezone})`;
}

/**
 * Runs merge from upstream; if the on-disk file changed, reloads the in-process disposable set
 * (no PM2 restart required).
 */
export function startDisposableListScheduler(config: AppConfig): void {
  if (!config.DISPOSABLE_LIST_CRON_ENABLED) {
    return;
  }

  const expression = config.DISPOSABLE_LIST_CRON_SCHEDULE.trim();
  const tz = config.DISPOSABLE_LIST_CRON_TIMEZONE.trim() || "UTC";
  if (!cron.validate(expression)) {
    getLogger().error(
      { expression, timezone: tz },
      "DISPOSABLE_LIST_CRON_SCHEDULE is not a valid node-cron expression; scheduler not started"
    );
    return;
  }

  const outPath = resolveDataPath(config.DATA_DIR, "disposable-domains.txt");
  const log = getLogger();

  const run = async (): Promise<void> => {
    try {
      const result = await mergeDisposableDomainSources(outPath);
      if (result.changed) {
        log.info(
          { uniqueCount: result.uniqueCount, path: outPath, sources: result.sources },
          "disposable list file updated from upstream"
        );
        await reloadDisposableListFromDisk();
      } else {
        log.debug(
          { uniqueCount: result.uniqueCount, path: outPath },
          "disposable list sync: no file change"
        );
      }
    } catch (e) {
      log.error({ err: e, path: outPath }, "disposable list scheduled sync failed");
    }
  };

  log.info(
    {
      schedule: scheduleDescription(expression, tz),
      outPath,
    },
    "disposable list: in-process scheduler started"
  );

  task = cron.schedule(
    expression,
    () => {
      void run();
    },
    { timezone: tz }
  );
}

export function stopDisposableListScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    getLogger().info("disposable list: in-process scheduler stopped");
  }
}
