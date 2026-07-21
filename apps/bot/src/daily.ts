import type { Client } from "discord.js";
import { db, getLeaderboard, getOrCreateGuild } from "@inochi/database";

export function scheduleDailyTopRoles(client: Client) {
  let lastRun = "";
  const run = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (lastRun === today) return;
    lastRun = today;
    for (const guild of client.guilds.cache.values()) {
      const row = await getOrCreateGuild(db, guild.id, guild.name);
      const roleId = row.settings.community.dailyTopRoleId;
      if (!roleId) continue;
      const role = guild.roles.cache.get(roleId);
      const [leader] = await getLeaderboard(db, guild.id, 1, 0, { minimumXp: 4_150 });
      if (!role || !leader) continue;
      for (const member of role.members.values()) if (member.id !== leader.userId) await member.roles.remove(role, "Inochi daily top member").catch(() => undefined);
      const winner = await guild.members.fetch(leader.userId).catch(() => null);
      if (winner && !winner.roles.cache.has(role.id)) await winner.roles.add(role, "Inochi daily top member").catch(() => undefined);
    }
  };
  void run();
  setInterval(() => void run(), 60 * 60_000);
}
