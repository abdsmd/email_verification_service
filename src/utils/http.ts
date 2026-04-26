import { fetch, Agent } from "undici";

const agent = new Agent({
  connect: { timeout: 10_000 },
  headersTimeout: 30_000,
  bodyTimeout: 60_000,
});

export { fetch, agent };

export async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    dispatcher: agent,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}
