import assert from "node:assert/strict";
import test from "node:test";
import {
  importProviderIds,
  importProviders,
  isImportProviderId,
  parseAmariMessage,
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

/*
  Regression tests for two reported /import failures, both reproduced against
  real AmariBot and Arcane leaderboard messages before being fixed.
*/

test("multi-line entries pair a mention with a value on a following line", () => {
  // Amari puts the mention, the level and the exp on three separate lines.
  // Every pattern used to join them with [^\n]*?, so this produced no records.
  const result = parseAmariMessage({
    content: "",
    embeds: [{
      title: "Leaderboard",
      description: `Mauve Hideout Server\n\n🥇 <@${userId}>\nLevel: 4\nExp: 35/55\n\n🥈 <@${secondUserId}>\nLevel: 2\nExp: 28/35`,
      fields: [],
    }],
  });
  assert.equal(result.recognized, true);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.userId), [userId, secondUserId]);
});

test("a slashed value is read as level progress rather than lifetime XP", () => {
  // "Exp: 35/55" is progress inside the level. Importing 35 as total XP would
  // silently understate every member.
  const result = parseAmariMessage({
    content: "",
    embeds: [{ title: "Leaderboard", description: `<@${userId}>\nLevel: 4\nExp: 35/55`, fields: [] }],
  });
  const record = result.records.find((entry) => entry.userId === userId);
  assert.ok(record, "expected a record for the member");
  assert.equal(record.exact, false, "a fractional exp must not be recorded as an exact XP total");
  assert.equal(record.level, 4);
  assert.ok(result.warnings.some((warning) => /progress inside the current level/i.test(warning)));
});

test("a level on a previous line is never mistaken for an XP total", () => {
  // "Level: 7" followed by "Exp: ..." on the next line must not let the number
  // before the unit reach across the newline and import 7 as XP.
  const result = parseAmariMessage({
    content: "",
    embeds: [{ title: "Leaderboard", description: `<@${userId}>\nLevel: 7\nExp: 900/1000`, fields: [] }],
  });
  const record = result.records.find((entry) => entry.userId === userId);
  assert.ok(record);
  assert.notEqual(record.xp, 7, "the level value leaked into the XP field");
});

test("member IDs are recovered from row avatars when a board prints usernames", () => {
  // Arcane's Components V2 board lists plain usernames, so the text holds no
  // snowflake. The IDs are only present in the avatar CDN URLs.
  const result = parseArcaneMessage({
    content: "",
    embeds: [{ title: "Mauve Hideout", description: "", fields: [] }],
    components: [{
      type: 17,
      components: [
        { type: 10, content: "View leaderboard" },
        {
          type: 9,
          components: [{ type: 10, content: "#1 - @someone - LVL: 9" }],
          accessory: { type: 11, media: { url: `https://cdn.discordapp.com/avatars/${userId}/abc.png` } },
        },
        {
          type: 9,
          components: [{ type: 10, content: "#2 - @another - LVL: 5" }],
          accessory: { type: 11, media: { url: `https://cdn.discordapp.com/avatars/${secondUserId}/def.png` } },
        },
      ],
    }],
  });
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.userId), [userId, secondUserId]);
  assert.deepEqual(result.records.map((record) => record.level), [9, 5]);
  assert.ok(result.warnings.some((warning) => /row avatars/i.test(warning)), "avatar pairing must be flagged for review");
});

test("guild-specific avatar URLs resolve to the member, not the guild", () => {
  // /guilds/<guildId>/users/<userId>/avatars/<hash> puts the guild ID first.
  const result = parseArcaneMessage({
    content: "",
    embeds: [{ title: "Leaderboard", description: "", fields: [] }],
    components: [{
      type: 17,
      components: [
        { type: 9, components: [{ type: 10, content: "#1 - @a - LVL: 3" }], accessory: { type: 11, media: { url: `https://cdn.discordapp.com/guilds/999888777666555444/users/${userId}/avatars/x.png` } } },
        { type: 9, components: [{ type: 10, content: "#2 - @b - LVL: 1" }], accessory: { type: 11, media: { url: `https://cdn.discordapp.com/guilds/999888777666555444/users/${secondUserId}/avatars/y.png` } } },
      ],
    }],
  });
  assert.deepEqual(result.records.map((record) => record.userId), [userId, secondUserId]);
});

test("avatar pairing bails out when IDs and values do not line up", () => {
  // Three avatars against two values means the positional pairing is unsafe.
  const result = parseArcaneMessage({
    content: "",
    embeds: [{ title: "Leaderboard", description: "", fields: [] }],
    components: [{
      type: 17,
      components: [
        { type: 9, components: [{ type: 10, content: "#1 - @a - LVL: 3" }], accessory: { type: 11, media: { url: `https://cdn.discordapp.com/avatars/${userId}/x.png` } } },
        { type: 9, components: [{ type: 10, content: "#2 - @b - LVL: 1" }], accessory: { type: 11, media: { url: `https://cdn.discordapp.com/avatars/${secondUserId}/y.png` } } },
        { type: 9, components: [{ type: 10, content: "#3 - @c" }], accessory: { type: 11, media: { url: "https://cdn.discordapp.com/avatars/323456789012345678/z.png" } } },
      ],
    }],
  });
  assert.equal(result.records.length, 0, "unbalanced rows must not be guessed at");
});
