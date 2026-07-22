"use client";

import { Children, cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { analyzeCurve, applyLevelingPreset, detectLevelingPreset, levelingPresets } from "@inochi/core";
import type { LevelingPresetName } from "@inochi/core";
import type { GuildSettings } from "@inochi/core";
import { RotateCcw, Save } from "lucide-react";
import { DataTools } from "./data-tools";
import { CurvePreview } from "./curve-preview";
import { RankCardEditor } from "./rank-card-editor";

interface Props { guildId: string; initial: GuildSettings; initialRevision: number }

function NumberField({ value, onChange, min, max, step = 1 }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />;
}

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const child = Children.only(children);
  const control = isValidElement(child) ? cloneElement(child as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": descriptionId }) : child;
  return <div className="field-row"><label className="field-label" htmlFor={id}>{title}<small id={descriptionId}>{description}</small></label><div className="field-control">{control}</div></div>;
}

function Section({ label, title, description, children }: { label: string; title: string; description: string; children: ReactNode }) {
  return <section className="settings-section" id={label}><header className="section-head"><div><span className="mono">{label}</span><h2>{title}</h2><p>{description}</p></div></header><div className="section-body">{children}</div></section>;
}

export function SettingsForm({ guildId, initial, initialRevision }: Props) {
  const [settings, setSettings] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState("No unsaved changes");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (recipe: (draft: GuildSettings) => void) => {
    setSettings((current) => { const draft = structuredClone(current); recipe(draft); return draft; });
    setStatus("Unsaved changes");
    setDirty(true);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus("Saving...");
    try {
      const response = await fetch(`/api/guilds/${guildId}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings, expectedRevision: revision }) });
      const result = await response.json();
      if (!response.ok) setStatus(`Save failed: ${result.error ?? "Unknown error"}`);
      else { setSettings(result.settings); setBaseline(result.settings); setRevision(result.revision); setDirty(false); setStatus("Saved just now"); }
    } catch { setStatus("Save failed: network unavailable"); }
    finally { setSaving(false); }
  };
  const reset = () => { setSettings(structuredClone(baseline)); setDirty(false); setStatus("Changes reset"); };
  const rotation = settings.games.rotation;
  const word = settings.games.wordRace;
  const math = settings.games.mathRace;
  const curveDiagnostics = analyzeCurve(settings);
  const activePreset = detectLevelingPreset(settings);
  const averageGain = Math.round((settings.gain.min + settings.gain.max) / 2 * settings.multipliers.global);
  const applyPreset = (name: LevelingPresetName) => {
    setSettings((current) => applyLevelingPreset(current, name));
    setStatus(`${levelingPresets[name].label} preset ready to review`);
    setDirty(true);
  };
  return <>
    <Section label="xp" title="XP earning" description="Control where ordinary activity becomes progression and how often members can earn.">
      <div className="preset-panel"><div><span className="kicker mono">Complete presets</span><p>Apply message XP, cooldown, multiplier, and exact level thresholds together. Nothing changes until you save.</p></div><div className="preset-grid">{(Object.entries(levelingPresets) as [LevelingPresetName, (typeof levelingPresets)[LevelingPresetName]][]).map(([name, preset]) => <button type="button" className={activePreset === name ? "selected" : ""} key={name} onClick={() => applyPreset(name)}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div>{activePreset === "custom" && <span className="status">Custom XP configuration</span>}</div>
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
    <Section label="curve" title="Level curve" description="Shape every threshold with a live preview driven by the exact same math as the bot.">
      <CurvePreview settings={settings} />
      <div className="metric-strip"><div><span>Average award</span><strong>{averageGain.toLocaleString()} XP</strong></div><div><span>Level cap</span><strong>{settings.curve.maxLevel}</strong></div><div><span>Curve state</span><strong>{curveDiagnostics.strictlyIncreasing ? "Healthy" : "Needs review"}</strong></div></div>
      <Row title="Constant coefficient" description="The fixed c₀ term used by imported bot formulas."><NumberField value={settings.curve.constant} min={-1000000} max={1000000} step={.01} onChange={(value) => set((draft) => { draft.curve.constant = value; })} /></Row>
      <Row title="Cubic coefficient" description="The L³ term in the XP curve."><NumberField value={settings.curve.cubic} min={-100} max={100} step={.01} onChange={(value) => set((draft) => { draft.curve.cubic = value; })} /></Row>
      <Row title="Quadratic coefficient" description="The L² term in the XP curve."><NumberField value={settings.curve.quadratic} min={-10000} max={10000} step={.01} onChange={(value) => set((draft) => { draft.curve.quadratic = value; })} /></Row>
      <Row title="Linear coefficient" description="The L term in the XP curve."><NumberField value={settings.curve.linear} min={-100000} max={100000} step={.01} onChange={(value) => set((draft) => { draft.curve.linear = value; })} /></Row>
      <Row title="Round requirements" description="Round level thresholds to this interval."><NumberField value={settings.curve.rounding} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.rounding = value; })} /></Row>
      <Row title="Maximum level" description="Hard level cap for this server."><NumberField value={settings.curve.maxLevel} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.maxLevel = value; })} /></Row>
    </Section>
    <Section label="level-up" title="Announcements" description="Celebrate milestones without turning every channel into a notification stream.">
      <Row title="Announcements" description="Send a message when members level up."><Toggle checked={settings.levelUp.enabled} onChange={(value) => set((draft) => { draft.levelUp.enabled = value; })} /></Row>
      <Row title="Message" description="Supports {user}, {level}, and {xp}."><textarea rows={3} value={settings.levelUp.message} onChange={(event) => set((draft) => { draft.levelUp.message = event.target.value; })} /></Row>
      <Row title="Destination" description="Use current, dm, or a Discord channel ID."><input value={settings.levelUp.channelId} onChange={(event) => set((draft) => { draft.levelUp.channelId = event.target.value as GuildSettings["levelUp"]["channelId"]; })} /></Row>
      <Row title="Reward levels only" description="Announce only when a configured role is reached."><Toggle checked={settings.levelUp.rewardsOnly} onChange={(value) => set((draft) => { draft.levelUp.rewardsOnly = value; })} /></Row>
      <Row title="Announcement interval" description="Announce every N levels below the cutoff."><NumberField value={settings.levelUp.every} min={1} max={1000} onChange={(value) => set((draft) => { draft.levelUp.every = value; })} /></Row>
      <Row title="Interval cutoff" description="After this level, announce every level; zero disables the cutoff."><NumberField value={settings.levelUp.until} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.until = value; })} /></Row>
      <Row title="Minimum announcement level" description="Suppress announcements below this level."><NumberField value={settings.levelUp.minimumLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.minimumLevel = value; })} /></Row>
      <Row title="Specific announcement levels" description="Comma-separated levels; empty allows every level."><input value={settings.levelUp.specificLevels.join(", ")} onChange={(event) => set((draft) => { draft.levelUp.specificLevels = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0); })} /></Row>
    </Section>
    <Section label="rank" title="Rank card" description="Choose how member progress appears when someone runs /rank.">
      <RankCardEditor guildId={guildId} value={settings.rankCard} onChange={(value) => set((draft) => { draft.rankCard = value; })} />
      <Row title="Image rank card" description="Return the monochrome image from /rank."><Toggle checked={settings.rankCard.enabled} onChange={(value) => set((draft) => { draft.rankCard.enabled = value; })} /></Row>
      <Row title="Private by default" description="Make rank responses ephemeral."><Toggle checked={settings.rankCard.ephemeral} onChange={(value) => set((draft) => { draft.rankCard.ephemeral = value; })} /></Row>
      <Row title="Show cooldown" description="Expose remaining earning cooldown."><Toggle checked={settings.rankCard.showCooldown} onChange={(value) => set((draft) => { draft.rankCard.showCooldown = value; })} /></Row>
      <Row title="Relative XP" description="Show progress within the current level."><Toggle checked={settings.rankCard.relativeXp} onChange={(value) => set((draft) => { draft.rankCard.relativeXp = value; })} /></Row>
    </Section>
    <Section label="leaderboard" title="Leaderboard" description="Set command privacy, web visibility, and the population included in rankings.">
      <Row title="Enable leaderboard" description="Allow /top and the public leaderboard page."><Toggle checked={settings.leaderboard.enabled} onChange={(value) => set((draft) => { draft.leaderboard.enabled = value; })} /></Row>
      <Row title="Web visibility" description="Choose who may view the web leaderboard."><select value={settings.leaderboard.visibility} onChange={(event) => set((draft) => { draft.leaderboard.visibility = event.target.value as GuildSettings["leaderboard"]["visibility"]; draft.leaderboard.private = event.target.value !== "public"; })}><option value="public">Public</option><option value="members">Members only</option><option value="managers">Managers only</option></select></Row>
      <Row title="Private command" description="Make /top responses ephemeral."><Toggle checked={settings.leaderboard.ephemeral} onChange={(value) => set((draft) => { draft.leaderboard.ephemeral = value; })} /></Row>
      <Row title="Minimum level" description="Hide entries below this level."><NumberField value={settings.leaderboard.minLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.leaderboard.minLevel = value; })} /></Row>
      <Row title="Maximum entries" description="Zero keeps the full leaderboard."><NumberField value={settings.leaderboard.maxEntries} min={0} max={1000000} onChange={(value) => set((draft) => { draft.leaderboard.maxEntries = value; })} /></Row>
    </Section>
    <Section label="games" title="Chat games" description="Schedule persistent word and math races with independent winner rewards.">
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
    <Section label="roles" title="Roles, multipliers, and community" description="Connect progression to Discord roles and tune exceptions for your community.">
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
    <Section label="logging" title="Logs and automated backups" description="Send operational events and scheduled full backups to one private Discord channel.">
      <Row title="Audit channel ID" description="Use a private text channel where Inochi can send embeds and attachments."><input value={settings.logging.channelId ?? ""} pattern="\d{16,20}" onChange={(event) => set((draft) => { draft.logging.channelId = event.target.value || null; })} /></Row>
      <Row title="Command usage" description="Log command names, actors, and channels without raw options or message content."><Toggle checked={settings.logging.commandUsage} onChange={(value) => set((draft) => { draft.logging.commandUsage = value; })} /></Row>
      <Row title="Level ups" description="Log level transitions, XP totals, and source channels."><Toggle checked={settings.logging.levelUps} onChange={(value) => set((draft) => { draft.logging.levelUps = value; })} /></Row>
      <Row title="Administrative actions" description="Log manager commands and configuration operations."><Toggle checked={settings.logging.adminActions} onChange={(value) => set((draft) => { draft.logging.adminActions = value; })} /></Row>
      <Row title="Errors" description="Send sanitized command failure notifications."><Toggle checked={settings.logging.errors} onChange={(value) => set((draft) => { draft.logging.errors = value; })} /></Row>
      <Row title="Backup delivery" description="Send scheduled backup status and attachments to the audit channel."><Toggle checked={settings.logging.backups} onChange={(value) => set((draft) => { draft.logging.backups = value; })} /></Row>
      <Row title="Scheduled backups" description="Create full settings/member snapshots on the selected cadence."><Toggle checked={settings.backups.enabled} onChange={(value) => set((draft) => { draft.backups.enabled = value; })} /></Row>
      <Row title="Backup cadence" description="Daily or weekly full compressed snapshots."><select value={settings.backups.cadence} onChange={(event) => set((draft) => { draft.backups.cadence = event.target.value as "daily" | "weekly"; })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Row>
      <Row title="Backup hour UTC" description="Hour from 0 to 23 when the scheduler should run."><NumberField value={settings.backups.hourUtc} min={0} max={23} onChange={(value) => set((draft) => { draft.backups.hourUtc = value; })} /></Row>
      {settings.backups.cadence === "weekly" && <Row title="Backup weekday" description="0 is Sunday and 6 is Saturday."><NumberField value={settings.backups.weekday} min={0} max={6} onChange={(value) => set((draft) => { draft.backups.weekday = value; })} /></Row>}
      <Row title="Retention" description="Days to retain scheduled snapshots in PostgreSQL."><NumberField value={settings.backups.retentionDays} min={1} max={90} onChange={(value) => set((draft) => { draft.backups.retentionDays = value; })} /></Row>
    </Section>
    <Section label="imports" title="Data, imports, and backups" description="Move existing progression in, take complete snapshots, and create scoped API access.">
      <div className="field-label">Use <code>/import mee6</code> for a public MEE6 leaderboard. For ProBot, Arcane, AmariBot, Lurkr, or Carl-bot, run <code>/import begin</code> in a private admin channel, invoke the source bot&apos;s public leaderboard, advance every page, then run <code>/import review</code> and <code>/import apply</code>.</div>
      <div className="status">Official JSON/CSV exports remain preferred. Ephemeral source messages cannot be captured.</div>
      <DataTools guildId={guildId} />
    </Section>
    <div className="savebar"><span className="status" role="status" aria-live="polite">{status}</span><div><button type="button" onClick={reset} disabled={!dirty || saving}><RotateCcw size={15} /> Reset</button><button className="primary" type="button" onClick={save} disabled={!dirty || saving}><Save size={15} /> {saving ? "Saving..." : "Save configuration"}</button></div></div>
  </>;
}
