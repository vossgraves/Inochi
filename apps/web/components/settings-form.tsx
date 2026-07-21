"use client";

import { useState } from "react";
import type { GuildSettings } from "@inochi/core";
import { Save } from "lucide-react";
import { DataTools } from "./data-tools";

interface Props { guildId: string; initial: GuildSettings }

function NumberField({ value, onChange, min, max, step = 1 }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />;
}

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="field-row"><label className="field-label">{title}<small>{description}</small></label>{children}</div>;
}

function Section({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <section className="section" id={label}><header className="section-head"><h2 className="mono">{title}</h2><span className="status">{label}</span></header><div className="section-body">{children}</div></section>;
}

export function SettingsForm({ guildId, initial }: Props) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState("No unsaved changes");
  const set = (recipe: (draft: GuildSettings) => void) => {
    setSettings((current) => { const draft = structuredClone(current); recipe(draft); return draft; });
    setStatus("Unsaved changes");
  };
  const save = async () => {
    setStatus("Saving...");
    const response = await fetch(`/api/guilds/${guildId}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    setStatus(response.ok ? "Saved" : `Save failed: ${(await response.json()).error}`);
  };
  const rotation = settings.games.rotation;
  const word = settings.games.wordRace;
  const math = settings.games.mathRace;
  return <>
    <Section label="xp" title="XP / Core progression">
      <Row title="Enable XP" description="Award XP for eligible server messages."><Toggle checked={settings.enabled} onChange={(value) => set((draft) => { draft.enabled = value; })} /></Row>
      <Row title="Minimum XP" description="Smallest base award per cooldown."><NumberField value={settings.gain.min} min={0} max={5000} onChange={(value) => set((draft) => { draft.gain.min = value; })} /></Row>
      <Row title="Maximum XP" description="Largest base award per cooldown."><NumberField value={settings.gain.max} min={0} max={5000} onChange={(value) => set((draft) => { draft.gain.max = value; })} /></Row>
      <Row title="Cooldown" description="Seconds before a member can earn message XP again."><NumberField value={settings.gain.cooldownSeconds} min={0} max={31536000} step={.25} onChange={(value) => set((draft) => { draft.gain.cooldownSeconds = value; })} /></Row>
      <Row title="Global multiplier" description="Applied to all ordinary chat XP before vote boosts."><NumberField value={settings.multipliers.global} min={0} max={100} step={.05} onChange={(value) => set((draft) => { draft.multipliers.global = value; })} /></Row>
      <Row title="top.gg vote boost" description="Give recent voters an additional chat XP multiplier."><Toggle checked={settings.multipliers.vote.enabled} onChange={(value) => set((draft) => { draft.multipliers.vote.enabled = value; })} /></Row>
      <Row title="Vote multiplier" description="Multiplier granted after a verified top.gg vote."><NumberField value={settings.multipliers.vote.multiplier} min={1} max={10} step={.05} onChange={(value) => set((draft) => { draft.multipliers.vote.multiplier = value; })} /></Row>
      <Row title="Vote duration" description="Hours the boost remains active."><NumberField value={settings.multipliers.vote.durationHours} min={1} max={168} onChange={(value) => set((draft) => { draft.multipliers.vote.durationHours = value; })} /></Row>
      <Row title="Channel policy mode" description="Deny listed locations or allow XP only in listed locations."><select value={settings.channelPolicy.mode} onChange={(event) => set((draft) => { draft.channelPolicy.mode = event.target.value as "allowlist" | "denylist"; })}><option value="denylist">Denylist</option><option value="allowlist">Allowlist</option></select></Row>
      <Row title="Policy locations" description="Category, channel, forum, or thread IDs. Parent rules inherit into threads."><textarea rows={4} value={settings.channelPolicy.channelIds.join("\n")} onChange={(event) => set((draft) => { draft.channelPolicy.channelIds = event.target.value.split(/\s|,/).map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="XP in threads" description="Threads must also pass their parent channel/category policy."><Toggle checked={settings.channelPolicy.threadsEnabled} onChange={(value) => set((draft) => { draft.channelPolicy.threadsEnabled = value; })} /></Row>
    </Section>
    <Section label="curve" title="Curve / Level geometry">
      <Row title="Cubic coefficient" description="The L³ term in the XP curve."><NumberField value={settings.curve.cubic} min={0} max={100} step={.01} onChange={(value) => set((draft) => { draft.curve.cubic = value; })} /></Row>
      <Row title="Quadratic coefficient" description="The L² term in the XP curve."><NumberField value={settings.curve.quadratic} min={0} max={10000} step={.01} onChange={(value) => set((draft) => { draft.curve.quadratic = value; })} /></Row>
      <Row title="Linear coefficient" description="The L term in the XP curve."><NumberField value={settings.curve.linear} min={0} max={100000} step={.01} onChange={(value) => set((draft) => { draft.curve.linear = value; })} /></Row>
      <Row title="Round requirements" description="Round level thresholds to this interval."><NumberField value={settings.curve.rounding} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.rounding = value; })} /></Row>
      <Row title="Maximum level" description="Hard level cap for this server."><NumberField value={settings.curve.maxLevel} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.maxLevel = value; })} /></Row>
    </Section>
    <Section label="level-up" title="Level up / Announcements">
      <Row title="Announcements" description="Send a message when members level up."><Toggle checked={settings.levelUp.enabled} onChange={(value) => set((draft) => { draft.levelUp.enabled = value; })} /></Row>
      <Row title="Message" description="Supports {user}, {level}, and {xp}."><textarea rows={3} value={settings.levelUp.message} onChange={(event) => set((draft) => { draft.levelUp.message = event.target.value; })} /></Row>
      <Row title="Destination" description="Use current, dm, or a Discord channel ID."><input value={settings.levelUp.channelId} onChange={(event) => set((draft) => { draft.levelUp.channelId = event.target.value as GuildSettings["levelUp"]["channelId"]; })} /></Row>
      <Row title="Reward levels only" description="Announce only when a configured role is reached."><Toggle checked={settings.levelUp.rewardsOnly} onChange={(value) => set((draft) => { draft.levelUp.rewardsOnly = value; })} /></Row>
      <Row title="Announcement interval" description="Announce every N levels below the cutoff."><NumberField value={settings.levelUp.every} min={1} max={1000} onChange={(value) => set((draft) => { draft.levelUp.every = value; })} /></Row>
      <Row title="Interval cutoff" description="After this level, announce every level; zero disables the cutoff."><NumberField value={settings.levelUp.until} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.until = value; })} /></Row>
      <Row title="Minimum announcement level" description="Suppress announcements below this level."><NumberField value={settings.levelUp.minimumLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.minimumLevel = value; })} /></Row>
      <Row title="Specific announcement levels" description="Comma-separated levels; empty allows every level."><input value={settings.levelUp.specificLevels.join(", ")} onChange={(event) => set((draft) => { draft.levelUp.specificLevels = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0); })} /></Row>
    </Section>
    <Section label="rank" title="Rank / Member card">
      <Row title="Image rank card" description="Return the monochrome image from /rank."><Toggle checked={settings.rankCard.enabled} onChange={(value) => set((draft) => { draft.rankCard.enabled = value; })} /></Row>
      <Row title="Private by default" description="Make rank responses ephemeral."><Toggle checked={settings.rankCard.ephemeral} onChange={(value) => set((draft) => { draft.rankCard.ephemeral = value; })} /></Row>
      <Row title="Show cooldown" description="Expose remaining earning cooldown."><Toggle checked={settings.rankCard.showCooldown} onChange={(value) => set((draft) => { draft.rankCard.showCooldown = value; })} /></Row>
      <Row title="Relative XP" description="Show progress within the current level."><Toggle checked={settings.rankCard.relativeXp} onChange={(value) => set((draft) => { draft.rankCard.relativeXp = value; })} /></Row>
    </Section>
    <Section label="leaderboard" title="Leaderboard / Visibility">
      <Row title="Enable leaderboard" description="Allow /top and the public leaderboard page."><Toggle checked={settings.leaderboard.enabled} onChange={(value) => set((draft) => { draft.leaderboard.enabled = value; })} /></Row>
      <Row title="Web visibility" description="Choose who may view the web leaderboard."><select value={settings.leaderboard.visibility} onChange={(event) => set((draft) => { draft.leaderboard.visibility = event.target.value as GuildSettings["leaderboard"]["visibility"]; draft.leaderboard.private = event.target.value !== "public"; })}><option value="public">Public</option><option value="members">Members only</option><option value="managers">Managers only</option></select></Row>
      <Row title="Private command" description="Make /top responses ephemeral."><Toggle checked={settings.leaderboard.ephemeral} onChange={(value) => set((draft) => { draft.leaderboard.ephemeral = value; })} /></Row>
      <Row title="Minimum level" description="Hide entries below this level."><NumberField value={settings.leaderboard.minLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.leaderboard.minLevel = value; })} /></Row>
      <Row title="Maximum entries" description="Zero keeps the full leaderboard."><NumberField value={settings.leaderboard.maxEntries} min={0} max={1000000} onChange={(value) => set((draft) => { draft.leaderboard.maxEntries = value; })} /></Row>
    </Section>
    <Section label="games" title="Games / Chat races">
      <Row title="Automatic rotation" description="Persistently schedule word and math races."><Toggle checked={rotation.enabled} onChange={(value) => set((draft) => { draft.games.rotation.enabled = value; })} /></Row>
      <Row title="Game channels" description="Comma-separated text channel IDs."><input value={rotation.channelIds.join(", ")} onChange={(event) => set((draft) => { draft.games.rotation.channelIds = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Rotation interval" description="Minutes between rounds in each channel."><NumberField value={rotation.intervalMinutes} min={1} max={10080} onChange={(value) => set((draft) => { draft.games.rotation.intervalMinutes = value; })} /></Row>
      <Row title="Rotation mode" description="Choose games randomly or alternate in order."><select value={rotation.mode} onChange={(event) => set((draft) => { draft.games.rotation.mode = event.target.value as "random" | "round-robin"; })}><option value="random">Random</option><option value="round-robin">Round robin</option></select></Row>
      <Row title="Enabled game types" description="Comma-separated: word, math."><input value={rotation.types.join(", ")} onChange={(event) => set((draft) => { draft.games.rotation.types = event.target.value.split(",").map((value) => value.trim()).filter((value): value is "word" | "math" => value === "word" || value === "math"); })} /></Row>
      <Row title="Word race" description="Enable styled type-the-word images."><Toggle checked={word.enabled} onChange={(value) => set((draft) => { draft.games.wordRace.enabled = value; })} /></Row>
      <Row title="Word answer window" description="Seconds available to claim a place."><NumberField value={word.answerSeconds} min={10} max={3600} onChange={(value) => set((draft) => { draft.games.wordRace.answerSeconds = value; })} /></Row>
      <Row title="Word place XP" description="One to three comma-separated rewards: first, second, third."><input value={word.placeXp.join(", ")} onChange={(event) => set((draft) => { draft.games.wordRace.placeXp = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0).slice(0, 3); })} /></Row>
      <Row title="Word hints" description="Progressive hints before expiration."><NumberField value={word.hints} min={0} max={5} onChange={(value) => set((draft) => { draft.games.wordRace.hints = value; })} /></Row>
      <Row title="Custom words" description="One word per line; empty uses built-in words."><textarea rows={6} value={word.customWords.join("\n")} onChange={(event) => set((draft) => { draft.games.wordRace.customWords = event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Math race" description="Enable generated equation images."><Toggle checked={math.enabled} onChange={(value) => set((draft) => { draft.games.mathRace.enabled = value; })} /></Row>
      <Row title="Math difficulty" description="Control expression complexity."><select value={math.difficulty} onChange={(event) => set((draft) => { draft.games.mathRace.difficulty = event.target.value as GuildSettings["games"]["mathRace"]["difficulty"]; })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option></select></Row>
      <Row title="Math answer window" description="Seconds available to claim a place."><NumberField value={math.answerSeconds} min={10} max={3600} onChange={(value) => set((draft) => { draft.games.mathRace.answerSeconds = value; })} /></Row>
      <Row title="Math place XP" description="One to three comma-separated rewards."><input value={math.placeXp.join(", ")} onChange={(event) => set((draft) => { draft.games.mathRace.placeXp = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0).slice(0, 3); })} /></Row>
    </Section>
    <Section label="roles" title="Rewards / Role thresholds">
      <Row title="Configured rewards" description="Use /rewardrole for Discord's validated role picker. Remove entries here by role ID."><textarea rows={5} value={settings.rewards.map((reward) => `${reward.roleId}:${reward.level}:${reward.keep}:${reward.noSync}`).join("\n")} onChange={(event) => set((draft) => { draft.rewards = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [roleId, level, keep, noSync] = line.split(":"); return roleId && level ? [{ roleId, level: Number(level), keep: keep === "true", noSync: noSync === "true" }] : []; }); })} /></Row>
      <Row title="Weekly XP" description="Track and display a separate weekly leaderboard."><Toggle checked={settings.community.weeklyXp} onChange={(value) => set((draft) => { draft.community.weeklyXp = value; })} /></Row>
      <Row title="Clear on leave" description="Delete a member's XP when they leave the server."><Toggle checked={settings.community.clearOnLeave} onChange={(value) => set((draft) => { draft.community.clearOnLeave = value; })} /></Row>
      <Row title="Join role ID" description="Role granted to new members; leave blank to disable."><input value={settings.community.joinRoleId ?? ""} onChange={(event) => set((draft) => { draft.community.joinRoleId = event.target.value || null; })} /></Row>
      <Row title="XP blacklist roles" description="Comma-separated role IDs that cannot earn message XP."><input value={settings.community.blacklistRoleIds.join(", ")} onChange={(event) => set((draft) => { draft.community.blacklistRoleIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="No reward roles" description="Members with these roles do not receive level reward roles."><input value={settings.community.noRewardRoleIds.join(", ")} onChange={(event) => set((draft) => { draft.community.noRewardRoleIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="Ignored command prefixes" description="Messages beginning with these prefixes do not earn XP."><input value={settings.community.ignoredPrefixes.join(", ")} onChange={(event) => set((draft) => { draft.community.ignoredPrefixes = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Reset automation" description="Delete leveling data on leave/kick, ban, both, or never."><select value={settings.community.resetOn} onChange={(event) => set((draft) => { draft.community.resetOn = event.target.value as GuildSettings["community"]["resetOn"]; })}><option value="never">Never</option><option value="leave">Leave or kick</option><option value="ban">Ban</option><option value="both">Both</option></select></Row>
      <Row title="Daily top role ID" description="At UTC day rollover, assign this role to the highest eligible member."><input value={settings.community.dailyTopRoleId ?? ""} onChange={(event) => set((draft) => { draft.community.dailyTopRoleId = event.target.value || null; })} /></Row>
      <Row title="Role multipliers" description="One role ID and multiplier per line, formatted roleId:value."><textarea rows={4} value={settings.multipliers.roles.map((item) => `${item.roleId}:${item.multiplier}`).join("\n")} onChange={(event) => set((draft) => { draft.multipliers.roles = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [roleId, multiplier] = line.split(":"); return roleId && multiplier ? [{ roleId, multiplier: Number(multiplier) }] : []; }); })} /></Row>
      <Row title="Channel multipliers" description="One channel ID and multiplier per line, formatted channelId:value."><textarea rows={4} value={settings.multipliers.channels.map((item) => `${item.channelId}:${item.multiplier}`).join("\n")} onChange={(event) => set((draft) => { draft.multipliers.channels = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [channelId, multiplier] = line.split(":"); return channelId && multiplier ? [{ channelId, multiplier: Number(multiplier) }] : []; }); })} /></Row>
      <Row title="Role multiplier mode" description="How multiple matching role multipliers combine."><select value={settings.multipliers.roleMode} onChange={(event) => set((draft) => { draft.multipliers.roleMode = event.target.value as GuildSettings["multipliers"]["roleMode"]; })}><option value="largest">Largest</option><option value="smallest">Smallest</option><option value="highest">Highest role</option><option value="add">Add</option><option value="combine">Multiply</option></select></Row>
      <Row title="Channel stacking mode" description="How channel and role results combine."><select value={settings.multipliers.stackMode} onChange={(event) => set((draft) => { draft.multipliers.stackMode = event.target.value as GuildSettings["multipliers"]["stackMode"]; })}><option value="multiply">Multiply</option><option value="add">Add</option><option value="largest">Largest</option><option value="channel">Channel priority</option><option value="role">Role priority</option></select></Row>
    </Section>
    <Section label="imports" title="Imports / Assisted migration">
      <div className="field-label">Use <code>/import mee6</code> for a public MEE6 leaderboard. For ProBot, Arcane, AmariBot, Lurkr, or Carl-bot, run <code>/import begin</code> in a private admin channel, invoke the source bot&apos;s public leaderboard, advance every page, then run <code>/import review</code> and <code>/import apply</code>.</div>
      <div className="status">Official JSON/CSV exports remain preferred. Ephemeral source messages cannot be captured.</div>
      <DataTools guildId={guildId} />
    </Section>
    <div className="savebar"><span className="status">{status}</span><button className="primary" type="button" onClick={save}><Save size={15} /> Save configuration</button></div>
  </>;
}
