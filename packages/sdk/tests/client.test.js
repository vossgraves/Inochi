import assert from "node:assert/strict";
import test from "node:test";
import { InochiClient, InochiRateLimitError } from "../dist/index.js";

test("uses bearer auth and follows leaderboard cursors", async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json({ scope: "total", members: [{ userId: cursor ? "2" : "1" }], nextCursor: cursor ? null : "next" });
  };
  const client = new InochiClient({ apiKey: "secret", baseUrl: "https://example.test/api/v1/", fetch });
  const ids = [];
  for await (const member of client.leaderboards.iterateTotal("1234567890123456")) ids.push(member.userId);
  assert.deepEqual(ids, ["1", "2"]);
  assert.equal(requests[0].init.headers.get("authorization"), "Bearer secret");
});

test("exposes rate limit retry timing", async () => {
  const fetch = async () => Response.json({ error: { code: "rate_limited", message: "Slow down", requestId: "id" } }, { status: 429, headers: { "retry-after": "2" } });
  const client = new InochiClient({ apiKey: "secret", fetch });
  await assert.rejects(client.guild.get("1234567890123456"), (error) => error instanceof InochiRateLimitError && error.retryAfterMs === 2_000);
});
