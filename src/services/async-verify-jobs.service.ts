import { createHmac, randomBytes } from "node:crypto";
import { fetch } from "undici";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import type { VerificationResult } from "../types/verification.types.js";
import { verifyOne } from "./verification.service.js";

const log = getLogger();

export type AsyncVerifyJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  email: string;
  options: { skipSmtp?: boolean; skipCatchAll?: boolean; forceRefresh?: boolean };
  callbackUrl?: string;
  createdAt: number;
  result?: VerificationResult;
  errorMessage?: string;
};

const jobs = new Map<string, AsyncVerifyJob>();
const queue: string[] = [];
let running = false;

function webhookSecret(): string | null {
  const c = getConfig();
  return c.WEBHOOK_SIGNING_SECRET?.trim() || c.HMAC_SECRET?.trim() || null;
}

function evictOldTerminalIfNeeded(): void {
  const c = getConfig();
  while (jobs.size >= c.ASYNC_JOBS_MAX) {
    const terminals = [...jobs.entries()].filter(
      ([, v]) => v.status === "completed" || v.status === "failed"
    );
    if (terminals.length === 0) {
      return;
    }
    terminals.sort((a, b) => a[1].createdAt - b[1].createdAt);
    const [id] = terminals[0]!;
    jobs.delete(id);
  }
}

export function resetAsyncJobsForTests(): void {
  jobs.clear();
  queue.length = 0;
  running = false;
}

async function postWebhook(j: AsyncVerifyJob): Promise<void> {
  if (!j.callbackUrl) {
    return;
  }
  const sec = webhookSecret();
  if (!sec) {
    log.warn(
      { jobId: j.id },
      "callbackUrl set but no WEBHOOK_SIGNING_SECRET or HMAC_SECRET; skipping webhook"
    );
    return;
  }
  const body = JSON.stringify({
    jobId: j.id,
    status: j.status,
    result: j.result,
    error: j.errorMessage,
  });
  const ts = String(Date.now());
  const sig = createHmac("sha256", sec).update(`${ts}.${body}`, "utf8").digest("hex");
  try {
    const res = await fetch(j.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Webhook-Timestamp": ts,
        "X-Webhook-Signature": sig,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn({ jobId: j.id, status: res.status }, "webhook post non-2xx");
    }
  } catch (e) {
    log.warn({ err: e, jobId: j.id }, "webhook post failed");
  }
}

function pump(): void {
  if (running) {
    return;
  }
  const id = queue[0];
  if (!id) {
    return;
  }
  const j = jobs.get(id);
  if (!j || j.status !== "pending") {
    queue.shift();
    setImmediate(pump);
    return;
  }
  queue.shift();
  running = true;
  j.status = "processing";
  void (async () => {
    try {
      const r = await verifyOne(j.email, j.options);
      j.status = "completed";
      j.result = r;
    } catch (e) {
      j.status = "failed";
      j.errorMessage = e instanceof Error ? e.message : String(e);
    }
    await postWebhook({ ...j });
    running = false;
    if (queue.length > 0) {
      setImmediate(pump);
    }
  })();
}

export function enqueueAsyncVerify(
  email: string,
  options: { skipSmtp?: boolean; skipCatchAll?: boolean; forceRefresh?: boolean },
  callbackUrl: string | undefined
): { job: AsyncVerifyJob } | { error: "queue_full" } {
  const c = getConfig();
  evictOldTerminalIfNeeded();
  if (jobs.size >= c.ASYNC_JOBS_MAX) {
    return { error: "queue_full" };
  }
  const id = randomBytes(16).toString("hex");
  const j: AsyncVerifyJob = {
    id,
    status: "pending",
    email,
    options,
    callbackUrl,
    createdAt: Date.now(),
  };
  jobs.set(id, j);
  queue.push(id);
  setImmediate(pump);
  return { job: j };
}

export function getAsyncJob(id: string): AsyncVerifyJob | undefined {
  return jobs.get(id);
}
