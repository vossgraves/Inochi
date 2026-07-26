import { writeFile } from "node:fs/promises";
import { renderRankCard } from "../packages/rank-card/src/index";
import { defaultGuildSettings, levelForXp, xpForLevel } from "../packages/core/src/index";

/*
  Renders the rank card shown in the landing hero.

  The hero used to be a div mock: a fake card assembled from styled elements
  that only resembled the real output. This runs the actual renderer the bot
  uses for /rank, so what a visitor sees on the landing page is the product,
  not an illustration of it.

  Run with `npm run brand:sample-card`. The output is committed so builds and
  deploys do not depend on canvas being available.
*/
const XP = 38351;

async function main() {
  const settings = defaultGuildSettings;
  const level = levelForXp(XP, settings);
  const currentLevelXp = xpForLevel(level, settings);
  const nextLevelXp = xpForLevel(level + 1, settings);
  const span = Math.max(1, nextLevelXp - currentLevelXp);

  const png = await renderRankCard({
    username: "kazegami",
    // Deliberately unresolvable: the renderer falls back to the initial, which
    // keeps this build step offline and avoids baking in someone's avatar.
    avatarUrl: "",
    rank: 12,
    level,
    xp: XP,
    currentLevelXp,
    nextLevelXp,
    progress: (XP - currentLevelXp) / span,
    accentColor: settings.rankCard.accentColor,
    avatarShape: settings.rankCard.avatarShape,
    surface: settings.rankCard.surface,
    progressStyle: settings.rankCard.progressStyle,
  });

  const destination = new URL("../apps/web/public/brand/sample-rank-card.png", import.meta.url);
  await writeFile(destination, png);
  console.log(`Rendered ${destination.pathname} (level ${level}, ${png.byteLength} bytes)`);
}

void main();
