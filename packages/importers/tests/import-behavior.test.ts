import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLurkr,
  parseCsv,
  parseLegacyXpJson,
  parseLurkrJson,
  parsePublicLeaderboardMessage,
} from "../src/index";

const userId = "123456789012345678";
const secondUserId = "223456789012345678";

test("CSV imports accept BOM, common delimiters, quoting, and grouped XP", () => {
  assert.deepEqual(parseCsv(`\uFEFFUser ID,Total XP\r\n"${userId}","12,345"`), [
    { userId, xp: 12345, exact: true, metric: "xp" },
  ]);
  assert.equal(parseCsv(`${userId};9_876`)[0]?.xp, 9876);
  assert.equal(parseCsv(`${userId}\t1 234`)[0]?.xp, 1234);
});

test("file parsers discard malformed IDs, negative XP, fractions, and unsafe integers", () => {
  const invalidXp = ["-1", "1.5", String(Number.MAX_SAFE_INTEGER + 1), "not-a-number"];
  for (const xp of invalidXp) {
    assert.deepEqual(parseCsv(`${userId},${xp}`), [], xp);
    assert.deepEqual(parseLegacyXpJson({ [userId]: xp }), [], xp);
    assert.deepEqual(parseLurkrJson({ levels: [{ userId, xp }] }), [], xp);
  }

  assert.deepEqual(parseCsv("short-id,100"), []);
  assert.deepEqual(parseLegacyXpJson(null), []);
  assert.deepEqual(parseLurkrJson({ users: [] }), []);
});

test("legacy JSON supports object maps, nested maps, arrays, and scalar XP values", () => {
  assert.equal(parseLegacyXpJson({ users: { [userId]: { xp: "1,234" } } })[0]?.xp, 1234);
  assert.equal(parseLegacyXpJson({ xp: { [userId]: 2345 } })[0]?.xp, 2345);
  assert.equal(parseLegacyXpJson([{ id: userId, xp: 3456 }])[0]?.xp, 3456);
  assert.equal(parseLegacyXpJson([{ userId, xp: 4567 }])[0]?.xp, 4567);
});

test("Lurkr JSON keeps exact XP and optional valid levels", () => {
  assert.deepEqual(parseLurkrJson({ levels: [
    { userId, xp: "1_000", level: "5" },
    { userId: secondUserId, xp: 0, level: -1 },
  ] }), [
    { userId, xp: 1000, level: 5, exact: true, metric: "xp" },
    { userId: secondUserId, xp: 0, level: undefined, exact: true, metric: "xp" },
  ]);
});

test("compatibility message parsing handles raw IDs, mentions, pages, and exact precedence", () => {
  assert.deepEqual(parsePublicLeaderboardMessage([
    `${userId} Level: 8 XP: 8,765`,
    `<@!${secondUserId}> Lvl: 4`,
  ].join("\n"), 6), [
    { userId, xp: 8765, level: undefined, exact: true, metric: "xp", page: 6 },
    { userId: secondUserId, xp: 0, level: 4, exact: false, metric: "xp", page: 6 },
  ]);
});

test("Lurkr public pagination follows explicit page metadata and requests a fixed limit", async () => {
  const originalFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const page = Number(url.searchParams.get("page"));
    return new Response(JSON.stringify({
      levels: [{ userId: page === 1 ? userId : secondUserId, xp: page * 100 }],
      pagination: { page, limit: 100, totalPages: 2 },
    }));
  };

  try {
    const result = await fetchLurkr("705009450855039039");
    assert.equal(result.pages, 2);
    assert.deepEqual(result.records.map(({ xp, page }) => ({ xp, page })), [{ xp: 100, page: 1 }, { xp: 200, page: 2 }]);
    assert.deepEqual(urls.map((url) => url.searchParams.get("limit")), ["100", "100"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lurkr public pagination derives completeness from total and page size metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests += 1;
    const page = Number(new URL(String(input)).searchParams.get("page"));
    return new Response(JSON.stringify({
      levels: [{ userId: page === 1 ? userId : secondUserId, xp: page }],
      meta: { currentPage: page, perPage: 1, total: 2 },
    }));
  };

  try {
    const result = await fetchLurkr("705009450855039039");
    assert.equal(requests, 2);
    assert.equal(result.pages, 2);
    assert.equal(result.records.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lurkr public pagination stops and warns when the API reports the wrong page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    levels: [{ userId, xp: 100 }],
    pagination: { page: 2, limit: 100, totalPages: 3 },
  }));

  try {
    const result = await fetchLurkr("705009450855039039");
    assert.equal(result.pages, 1);
    assert.deepEqual(result.records, []);
    assert.match(result.warnings.join(" "), /reported page 2 while page 1 was requested/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lurkr public import rejects unsupported payloads and maps private leaderboard errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ users: [] }));
    await assert.rejects(fetchLurkr("705009450855039039"), /unsupported leaderboard response/);

    globalThis.fetch = async () => new Response("forbidden", { status: 403 });
    await assert.rejects(fetchLurkr("705009450855039039"), /official export or message capture/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
