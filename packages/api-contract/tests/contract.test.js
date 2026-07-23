import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BULK_MEMBER_IDS, MAX_PAGE_SIZE } from "../dist/index.js";
import { openApiDocument } from "../dist/openapi.js";

test("OpenAPI exposes the bounded read-only surface", () => {
  assert.equal(MAX_PAGE_SIZE, 100);
  assert.equal(MAX_BULK_MEMBER_IDS, 100);
  assert.equal(openApiDocument.openapi, "3.1.0");
  assert.ok(openApiDocument.paths["/guilds/{guildId}/leaderboards/weekly"]);
  assert.equal(Object.keys(openApiDocument.paths).length, 7);
});
