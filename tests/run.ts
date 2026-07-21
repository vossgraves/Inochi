import assert from "node:assert/strict";
import { defaultGuildSettings, levelForXp, parseGuildSettings, progressForXp, xpForLevel } from "@inochi/core";
import { parseCsv, parseLegacyPolarisJson, parseLurkrJson, parsePublicLeaderboardMessage } from "@inochi/importers";

const settings = defaultGuildSettings;
assert.equal(settings.games.wordRace.placeXp.length, 3);
assert.equal(settings.games.mathRace.difficulty, "medium");
assert.equal(settings.channelPolicy.mode, "denylist");
assert.equal(settings.multipliers.vote.multiplier, 1.2);
assert.equal(parseGuildSettings({ leaderboard: { private: true } }).leaderboard.visibility, "members");

for (const level of [0, 1, 5, 25, 100, 1000]) {
  assert.equal(levelForXp(xpForLevel(level, settings), settings), level);
}

const progress = progressForXp(xpForLevel(10, settings) + 50, settings);
assert.equal(progress.level, 10);
assert.ok(progress.progress >= 0 && progress.progress <= 1);

const id = "123456789012345678";
assert.equal(parseLegacyPolarisJson({ users: { [id]: { xp: 123 } } })[0]?.xp, 123);
assert.equal(parseLegacyPolarisJson([{ id, xp: 456 }])[0]?.xp, 456);
assert.equal(parseLurkrJson({ levels: [{ userId: id, xp: 90, level: 2 }] })[0]?.level, 2);
assert.equal(parseCsv(`ID,Total XP\n${id},1234`)[0]?.xp, 1234);
assert.deepEqual(
  parsePublicLeaderboardMessage(`#1 <@${id}> XP: 12,345`, 1)[0],
  { userId: id, xp: 12345, level: undefined, exact: true, metric: "xp", page: 1 },
);

console.log("All core and importer tests passed.");
