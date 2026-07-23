import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_MEMBER_IDS, MAX_PAGE_SIZE } from "../src/index";
import { openApiDocument } from "../src/openapi";

test("OpenAPI exposes the bounded read-only surface", () => {
  const paths = openApiDocument.paths as Record<string, unknown>;
  assert.equal(MAX_PAGE_SIZE, 100);
  assert.equal(MAX_BULK_MEMBER_IDS, 100);
  assert.equal(openApiDocument.openapi, "3.1.0");
  assert.ok(paths["/guilds/{guildId}/leaderboards/weekly"]);
  assert.equal(Object.keys(paths).length, 7);
});
