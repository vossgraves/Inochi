import assert from "node:assert/strict";
import { analyzeCurve, applyLevelingPreset, curveBenchmarks, defaultGuildSettings, levelForXp, parseGuildSettings, progressForXp, xpBetweenLevels, xpForLevel } from "@inochi/core";
import { fetchLurkr, importProviderIds, importProviders, parseCsv, parseLegacyPolarisJson, parseLurkrJson, parsePublicLeaderboardMessage, providerForBotUserId } from "@inochi/importers";
import { renderRankCard } from "@inochi/rank-card";
import { buildDiscordInviteUrl, discordInvitePermissions } from "../apps/web/lib/discord";

async function main() {
  const settings = defaultGuildSettings;
  assert.equal(settings.games.wordRace.placeXp.length, 3);
  assert.equal(settings.games.mathRace.difficulty, "medium");
  assert.equal(settings.channelPolicy.mode, "denylist");
  assert.equal(settings.multipliers.vote.multiplier, 1.2);
  assert.equal(parseGuildSettings({ leaderboard: { private: true } }).leaderboard.visibility, "members");
  assert.equal(parseGuildSettings({ curve: {} }).curve.constant, 150);
  assert.equal(parseGuildSettings({ rankCard: {} }).rankCard.avatarShape, "rounded");
  assert.equal(parseGuildSettings({ logging: {} }).logging.levelUps, true);
  assert.equal(parseGuildSettings({ backups: {} }).backups.cadence, "weekly");

  const inviteUrl = buildDiscordInviteUrl("123456789012345678");
  assert.equal(inviteUrl.origin, "https://discord.com");
  assert.equal(inviteUrl.pathname, "/oauth2/authorize");
  assert.equal(inviteUrl.searchParams.get("client_id"), "123456789012345678");
  assert.equal(inviteUrl.searchParams.get("scope"), "bot applications.commands");
  assert.equal(inviteUrl.searchParams.get("permissions"), discordInvitePermissions.toString());
  assert.equal(inviteUrl.searchParams.get("integration_type"), "0");
  assert.equal(discordInvitePermissions, 275146722304n);

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

  const lurkr = applyLevelingPreset(settings, "lurkr");
  assert.deepEqual(lurkr.gain, { min: 15, max: 40, cooldownSeconds: 60 });
  assert.equal(xpForLevel(0, lurkr), 0);
  assert.equal(xpForLevel(1, lurkr), 100);
  assert.equal(xpForLevel(10, lurkr), 4_150);
  const mee6 = applyLevelingPreset(settings, "mee6");
  assert.equal(xpForLevel(1, mee6), 100);
  assert.equal(xpForLevel(10, mee6), 4_675);
  const amari = applyLevelingPreset(settings, "amari");
  assert.deepEqual(amari.gain, { min: 1, max: 1, cooldownSeconds: 8 });
  assert.equal(xpForLevel(1, amari), 35);

  const duplicateCurve = structuredClone(settings);
  duplicateCurve.curve = { constant: 0, cubic: 0, quadratic: 0, linear: 30, rounding: 100, maxLevel: 5 };
  const duplicateAnalysis = analyzeCurve(duplicateCurve);
  assert.equal(duplicateAnalysis.strictlyIncreasing, false);
  assert.deepEqual(duplicateAnalysis.duplicateLevels, [1, 3, 4]);
  assert.equal(duplicateAnalysis.allZero, false);

  const zeroCurve = structuredClone(settings);
  zeroCurve.curve = { constant: 0, cubic: 0, quadratic: 0, linear: 0, rounding: 1, maxLevel: 3 };
  assert.deepEqual(analyzeCurve(zeroCurve), { strictlyIncreasing: false, duplicateLevels: [1, 2, 3], allZero: true });

  const id = "123456789012345678";
  assert.equal(parseLegacyPolarisJson({ users: { [id]: { xp: 123 } } })[0]?.xp, 123);
  assert.equal(parseLegacyPolarisJson([{ id, xp: 456 }])[0]?.xp, 456);
  assert.equal(parseLurkrJson({ levels: [{ userId: id, xp: 90, level: 2 }] })[0]?.level, 2);
  assert.equal(parseCsv(`ID,Total XP\n${id},1234`)[0]?.xp, 1234);
  assert.equal(parseCsv(`ID,Total XP\n"${id}","12,345"`)[0]?.xp, 12345);
  assert.deepEqual(
    parsePublicLeaderboardMessage(`#1 <@${id}> XP: 12,345`, 1)[0],
    { userId: id, xp: 12345, level: undefined, exact: true, metric: "xp", page: 1 },
  );
  assert.deepEqual(importProviderIds, ["mee6", "arcane", "probot", "amari", "lurkr", "carlbot", "tatsu"]);
  assert.equal(importProviders.arcane.botUserIds.length, 3);
  assert.equal(providerForBotUserId("1217870452253397082")?.id, "arcane");
  assert.equal(providerForBotUserId("172002255350792192")?.id, "tatsu");
  assert.equal(importProviders.arcane.fetchPublic, undefined);
  const arcaneResult = importProviders.arcane.parseMessage({ content: "Leaderboard · Page 2/3", embeds: [{ fields: [{ name: "#1", value: `<@${id}> · Level 8 · XP: 9,876` }] }] });
  assert.equal(arcaneResult.recognized, true);
  assert.deepEqual(arcaneResult.records[0], { userId: id, xp: 9876, level: undefined, exact: true, metric: "xp", page: 2 });
  const imageOnly = importProviders.carlbot.parseMessage({ content: "Level leaderboard", embeds: [], attachments: [{ name: "leaderboard.png", contentType: "image/png" }] });
  assert.equal(imageOnly.records.length, 0);
  assert.ok(imageOnly.warnings.some((warning) => warning.includes("Image-only")));
  const tatsuResult = importProviders.tatsu.parseMessage({ content: `Server leaderboard\n<@${id}> Score: 500`, embeds: [] });
  assert.equal(tatsuResult.records[0]?.metric, "server_score");
  assert.equal(importProviders.tatsu.parseMessage({ content: `Global leaderboard\n<@${id}> Score: 500`, embeds: [] }).records.length, 0);
  assert.equal(importProviders.tatsu.parseMessage({ content: `Leaderboard\n<@${id}> Score: 500`, embeds: [] }).records.length, 0);
  assert.equal(importProviders.probot.parseMessage({ content: `Voice leaderboard\n<@${id}> XP: 500`, embeds: [] }).records.length, 0);
  assert.equal(importProviders.probot.parseMessage({ content: `Leaderboard\n<@${id}> XP: 500`, embeds: [] }).records.length, 0);
  assert.equal(importProviders.probot.parseMessage({ content: `Weekly text leaderboard\n<@${id}> XP: 500`, embeds: [] }).records.length, 0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ levels: [{ userId: id, xp: 321, level: 4 }] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const publicLurkr = await fetchLurkr("705009450855039039");
    assert.equal(publicLurkr.records[0]?.xp, 321);
    assert.equal(publicLurkr.pages, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

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
    avatarShape: "circle",
    surface: "clean",
  });
  assert.deepEqual([...rankCard.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(rankCard.readUInt32BE(16), 960);
  assert.equal(rankCard.readUInt32BE(20), 300);
  const rankCardWithDifferentText = await renderRankCard({
    username: "Another deliberately long username with the same initial",
    avatarUrl: "invalid://avatar-fallback",
    rank: 12,
    level: 0,
    xp: 0,
    currentLevelXp: 0,
    nextLevelXp: 100,
    progress: 0,
    accentColor: "#6ee7b7",
    avatarShape: "circle",
    surface: "clean",
  });
  assert.notDeepEqual(rankCard, rankCardWithDifferentText, "Changing only rendered text must change the PNG");

  console.log("All core, importer, and rank-card tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
