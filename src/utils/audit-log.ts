import { appendFile } from "node:fs/promises";
import { getConfig } from "../config/env.js";
import { getLogger } from "./logger.js";

const log = getLogger();

type AuditEvent = {
  t: string;
  action: string;
  path: string;
  tenantId?: string;
  detail?: unknown;
};

export async function writeAuditIfConfigured(event: Omit<AuditEvent, "t">): Promise<void> {
  const p = getConfig().AUDIT_LOG_PATH;
  if (!p) {
    return;
  }
  const line: AuditEvent = { t: new Date().toISOString(), ...event };
  try {
    await appendFile(p, JSON.stringify(line) + "\n", "utf8");
  } catch (e) {
    log.error({ err: e, path: p }, "audit log append failed");
  }
}
