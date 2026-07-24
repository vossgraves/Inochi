import assert from "node:assert/strict";
import test from "node:test";
import {
  importProviderIds,
  importProviders,
  isImportProviderId,
  parseArcaneMessage,
  providerForBotUserId,
  type LeaderboardMessageSnapshot,
} from "../src/index";

const userId = "123456789012345678";
const secondUserId = "223456789012345678";

function snapshot(content: string): LeaderboardMessageSnapshot {
  return { content, embeds: [] };
}

test("provider registry exposes stable IDs, source values, and only verified presets", () => {
  assert.deepEqual(importProviderIds, ["mee6", "arcane", "probot", "amari", "lurkr", "carlbot", "tatsu"]);

  const expected = {
    mee6: { sourceValue: "xp", knownPreset: "mee6", strategies: ["web", "message"] },
    arcane: { sourceValue: "xp", knownPreset: undefined, strategies: ["message"] },
    probot: { sourceValue: "text_xp", knownPreset: undefined, strategies: ["message"] },
    amari: { sourceValue: "xp", knownPreset: "amari", strategies: ["message"] },
    lurkr: { sourceValue: "xp", knownPreset: "lurkr", strategies: ["web", "message"] },
    carlbot: { sourceValue: "level", knownPreset: undefined, strategies: ["message"] },
    tatsu: { sourceValue: "server_score", knownPreset: undefined, strategies: ["message"] },
  } as const;

  for (const id of importProviderIds) {
    const provider = importProviders[id];
    assert.equal(provider.id, id);
    assert.equal(provider.sourceValue, expected[id].sourceValue);
    assert.equal(provider.knownPreset, expected[id].knownPreset);
    assert.deepEqual(provider.strategies, expected[id].strategies);
    assert.ok(provider.botUserIds.length > 0);
    assert.ok(provider.messageInstructions.length > 20);
  }

  assert.equal(isImportProviderId("arcane"), true);
  assert.equal(isImportProviderId("unknown"), false);
  assert.equal(providerForBotUserId("1217870452253397082")?.id, "arcane");
  assert.equal(providerForBotUserId("000000000000000000"), undefined);
});

test("dedicated parsers read provider XP labels", () => {
  const cases = [
    ["mee6", `MEE6 Leaderboard\n<@${userId}> Level 8 - XP: 1,001`],
    ["arcane", `Arcane Rankings\n<@${userId}> Level 8 - XP: 1,002`],
    ["probot", `ProBot top text leaderboard\n<@${userId}> Text XP: 1,003`],
    ["amari", `AmariBot Leaderboard\n<@${userId}> Level 8 - EXP: 1,004`],
    ["lurkr", `Lurkr Leaderboard\n<@${userId}> XP: 1,005`],
    ["tatsu", `Tatsu server leaderboard\n<@${userId}> Server score: 1,006`],
  ] as const;

  for (const [provider, content] of cases) {
    const result = importProviders[provider].parseMessage(snapshot(content));
    assert.equal(result.recognized, true, provider);
    assert.equal(result.records[0]?.xp, Number(content.match(/1,\d{3}/)?.[0].replace(",", "")), provider);
  }
});

test("Arcane accepts Discord IDs without mentions", () => {
  const result = importProviders.arcane.parseMessage(snapshot(`Arcane leaderboard\n${userId} XP: 12,345\nPage 1/1`));
  assert.equal(result.records[0]?.userId, userId);
  assert.equal(result.records[0]?.xp, 12_345);
  assert.equal(result.totalPages, 1);
});

test("Arcane parser supports embed fields, XP suffixes, and level-only fallbacks", () => {
  const embedResult = parseArcaneMessage({
    content: "Arcane Leaderboard - Page 3 / 9",
    embeds: [{
      title: "Server Rankings",
      fields: [
        { name: "#1", value: `<@${userId}> | Level 42 | XP: 98,765` },
        { name: "#2", value: `<@!${secondUserId}> | 54_321 XP` },
      ],
    }],
  });

  assert.deepEqual(embedResult.records, [
    { userId, xp: 98765, level: undefined, exact: true, metric: "xp", page: 3 },
    { userId: secondUserId, xp: 54321, level: undefined, exact: true, metric: "xp", page: 3 },
  ]);
  assert.equal(embedResult.currentPage, 3);
  assert.equal(embedResult.totalPages, 9);

  const levelOnly = parseArcaneMessage(snapshot(`Arcane Rankings\n<@${userId}> - Lvl: 17`));
  assert.deepEqual(levelOnly.records[0], { userId, xp: 0, level: 17, exact: false, metric: "xp", page: undefined });
});

test("exact XP wins when a provider row also exposes a level", () => {
  const result = importProviders.arcane.parseMessage(snapshot(`Arcane leaderboard\n<@${userId}> Level: 12 | XP: 4,200`));
  assert.deepEqual(result.records, [{ userId, xp: 4200, level: undefined, exact: true, metric: "xp", page: undefined }]);
});

test("Carl-bot exposes level-only values without pretending they are exact XP", () => {
  const result = importProviders.carlbot.parseMessage(snapshot(`Carl-bot level leaderboard\n<@${userId}> (Level 12)`));
  assert.deepEqual(result.records[0], { userId, xp: 0, level: 12, exact: false, metric: "xp", page: undefined });
});

test("nested Components V2 text and pagination labels are parsed", () => {
  const result = importProviders.lurkr.parseMessage({
    content: "",
    embeds: [],
    components: [{
      type: 17,
      components: [
        {
          type: 9,
          components: [{ type: 10, content: `## Lurkr Leaderboard\n<@${userId}> XP: 4,321` }],
          accessory: { type: 11, media: { url: "https://example.test/rank.png" } },
        },
        { type: 1, components: [{ type: 2, label: "Page 2 of 7", custom_id: "next" }] },
      ],
    }],
  });

  assert.equal(result.records[0]?.xp, 4321);
  assert.equal(result.records[0]?.page, 2);
  assert.equal(result.page, 2);
  assert.equal(result.currentPage, 2);
  assert.equal(result.totalPages, 7);
});

test("compact pagination in Components V2 is accepted without treating numeric component fields as text", () => {
  const result = importProviders.mee6.parseMessage({
    content: "",
    embeds: [],
    components: [{ type: 17, components: [
      { type: 10, content: `MEE6 Leaderboard\n<@${userId}> XP: 900` },
      { type: 2, label: "[4 / 12]", value: 999_999 },
    ] }],
  });

  assert.equal(result.records[0]?.page, 4);
  assert.equal(result.totalPages, 12);
});

test("timed modes are rejected rather than imported as total XP", () => {
  const modes = ["Daily", "Weekly", "Monthly", "Today", "Past 24 hours", "This week", "30 days"];
  for (const mode of modes) {
    const result = importProviders.arcane.parseMessage(snapshot(`${mode} Arcane leaderboard\n<@${userId}> XP: 10`));
    assert.equal(result.recognized, true, mode);
    assert.equal(result.records.length, 0, mode);
    assert.match(result.warnings.join(" "), /Timed leaderboards/, mode);
  }
});

test("provider-incompatible modes are rejected with specific warnings", () => {
  const voice = importProviders.probot.parseMessage(snapshot(`ProBot voice leaderboard\n<@${userId}> XP: 10`));
  assert.equal(voice.records.length, 0);
  assert.match(voice.warnings.join(" "), /voice leaderboards/);

  const unspecifiedProBot = importProviders.probot.parseMessage(snapshot(`ProBot leaderboard\n<@${userId}> XP: 10`));
  assert.equal(unspecifiedProBot.records.length, 0);
  assert.match(unspecifiedProBot.warnings.join(" "), /text leaderboard/);

  const global = importProviders.tatsu.parseMessage(snapshot(`Tatsu global leaderboard\n<@${userId}> Score: 10`));
  assert.equal(global.records.length, 0);
  assert.match(global.warnings.join(" "), /server leaderboard/);

  const unspecifiedTatsu = importProviders.tatsu.parseMessage(snapshot(`Tatsu leaderboard\n<@${userId}> Score: 10`));
  assert.equal(unspecifiedTatsu.records.length, 0);
  assert.match(unspecifiedTatsu.warnings.join(" "), /server leaderboard/);

  const wrongCarlMode = importProviders.carlbot.parseMessage(snapshot(`Carl-bot activity leaderboard\n<@${userId}> XP: 10`));
  assert.equal(wrongCarlMode.records.length, 0);
  assert.match(wrongCarlMode.warnings.join(" "), /level leaderboard/);
});

test("unrecognized and image-only messages cannot leak records", () => {
  const unrecognized = importProviders.arcane.parseMessage(snapshot(`<@${userId}> XP: 500`));
  assert.equal(unrecognized.recognized, false);
  assert.deepEqual(unrecognized.records, []);

  const imageOnly = importProviders.carlbot.parseMessage({
    content: "Carl-bot level leaderboard",
    embeds: [],
    attachments: [{ name: "leaderboard.png", contentType: "image/png" }],
  });
  assert.equal(imageOnly.records.length, 0);
  assert.match(imageOnly.warnings.join(" "), /Image-only/);
});

test("Tatsu exact records retain their source metric and conversion warning", () => {
  const result = importProviders.tatsu.parseMessage(snapshot(`Tatsu server leaderboard\n<@${userId}> Server points: 700`));
  assert.equal(result.records[0]?.metric, "server_score");
  assert.match(result.warnings.join(" "), /one-to-one/);
});
