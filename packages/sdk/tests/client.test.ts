import assert from "node:assert/strict";
import test from "node:test";
import { InochiClient, InochiRateLimitError } from "../src/index";

test("uses bearer auth and follows leaderboard cursors", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json({ scope: "total", members: [{ userId: cursor ? "2" : "1" }], nextCursor: cursor ? null : "next" });
  };
  const client = new InochiClient({ apiKey: "secret", baseUrl: "https://example.test/api/v1/", fetch: fetcher });
  const ids: string[] = [];
  for await (const member of client.leaderboards.iterateTotal("1234567890123456")) ids.push(member.userId);
  assert.deepEqual(ids, ["1", "2"]);
  assert.equal(new Headers(requests[0]!.init?.headers).get("authorization"), "Bearer secret");
});

test("exposes rate limit retry timing", async () => {
  const fetcher: typeof globalThis.fetch = async () => Response.json({ error: { code: "rate_limited", message: "Slow down", requestId: "id" } }, { status: 429, headers: { "retry-after": "2" } });
  const client = new InochiClient({ apiKey: "secret", fetch: fetcher });
  await assert.rejects(client.guild.get("1234567890123456"), (error: unknown) => error instanceof InochiRateLimitError && error.retryAfterMs === 2_000);
});
