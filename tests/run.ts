import assert from "node:assert/strict";
import { analyzeCurve, curveBenchmarks, defaultGuildSettings, levelForXp, parseGuildSettings, progressForXp, xpBetweenLevels, xpForLevel } from "@inochi/core";
import { parseCsv, parseLegacyPolarisJson, parseLurkrJson, parsePublicLeaderboardMessage } from "@inochi/importers";
import { renderRankCard } from "@inochi/rank-card";

async function main() {
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
  for (const invalidXp of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(levelForXp(invalidXp, settings), 0);
    assert.deepEqual(progressForXp(invalidXp, settings), progressForXp(0, settings));
  }

  assert.equal(xpBetweenLevels(10, settings), xpForLevel(11, settings) - xpForLevel(10, settings));
  assert.equal(xpBetweenLevels(settings.curve.maxLevel, settings), 0);
  assert.deepEqual(curveBenchmarks(settings, [0, 10]).map(({ level, xp }) => ({ level, xp })), [
    { level: 0, xp: xpForLevel(0, settings) },
    { level: 10, xp: xpForLevel(10, settings) },
  ]);
  assert.equal(analyzeCurve(settings).strictlyIncreasing, true);

  const duplicateCurve = structuredClone(settings);
  duplicateCurve.curve = { cubic: 0, quadratic: 0, linear: 30, rounding: 100, maxLevel: 5 };
  const duplicateAnalysis = analyzeCurve(duplicateCurve);
  assert.equal(duplicateAnalysis.strictlyIncreasing, false);
  assert.deepEqual(duplicateAnalysis.duplicateLevels, [1, 3, 4]);
  assert.equal(duplicateAnalysis.allZero, false);

  const zeroCurve = structuredClone(settings);
  zeroCurve.curve = { cubic: 0, quadratic: 0, linear: 0, rounding: 1, maxLevel: 3 };
  assert.deepEqual(analyzeCurve(zeroCurve), { strictlyIncreasing: false, duplicateLevels: [1, 2, 3], allZero: true });

  const id = "123456789012345678";
  assert.equal(parseLegacyPolarisJson({ users: { [id]: { xp: 123 } } })[0]?.xp, 123);
  assert.equal(parseLegacyPolarisJson([{ id, xp: 456 }])[0]?.xp, 456);
  assert.equal(parseLurkrJson({ levels: [{ userId: id, xp: 90, level: 2 }] })[0]?.level, 2);
  assert.equal(parseCsv(`ID,Total XP\n${id},1234`)[0]?.xp, 1234);
  assert.deepEqual(
    parsePublicLeaderboardMessage(`#1 <@${id}> XP: 12,345`, 1)[0],
    { userId: id, xp: 12345, level: undefined, exact: true, metric: "xp", page: 1 },
  );

  const rankCard = await renderRankCard({
    username: "A deliberately long username that must be measured and ellipsized",
    avatarUrl: "invalid://avatar-fallback",
    rank: 12,
    level: 0,
    xp: 0,
    currentLevelXp: 0,
    nextLevelXp: 100,
    progress: 0,
    accentColor: "#6ee7b7",
  });
  assert.deepEqual([...rankCard.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(rankCard.readUInt32BE(16), 960);
  assert.equal(rankCard.readUInt32BE(20), 300);

  console.log("All core, importer, and rank-card tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
