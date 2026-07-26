"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { analyzeCurve, applyLevelingPreset, detectLevelingPreset, guildSettingsSchema, levelingPresets } from "@inochi/core";
import type { LevelingPresetName } from "@inochi/core";
import { MAX_COINFLIP_WAGER, type GuildSettings } from "@inochi/core";
import { Gift, RotateCcw, Save } from "lucide-react";
import { DataTools } from "./data-tools";
import { CurvePreview } from "./curve-preview";
import { RankCardEditor } from "./rank-card-editor";
import { OperationStatus, type OperationState } from "./operation-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props { guildId: string; initial: GuildSettings; initialRevision: number }

function NumberField({ value, onChange, min, max, step = 1 }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
  return <Input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <Switch checked={checked} onCheckedChange={onChange} />;
}

/*
  Row and Section keep the useId + aria-describedby wiring that connects each
  control to its own description. Do not replace the cloneElement here with a
  wrapper that drops the injected id: the label association depends on it.
*/
function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const child = Children.only(children);
  const control = isValidElement(child) ? cloneElement(child as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": descriptionId }) : child;
  return (
    <div className="grid gap-3 border-b border-border py-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center sm:gap-8">
      <label className="text-sm font-medium" htmlFor={id}>
        {title}
        <small id={descriptionId} className="mt-1.5 block text-xs leading-relaxed font-normal text-muted-foreground">
          {description}
        </small>
      </label>
      <div className="min-w-0 sm:justify-self-end sm:w-full">{control}</div>
    </div>
  );
}

function Section({ label, title, description, children, badge }: { label: string; title: string; description: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <section id={label} className="reveal mt-6 scroll-mt-24 border border-border">
      <header className="border-b border-border px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">{label}</span>
          {badge}
        </div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <div className="px-5">{children}</div>
    </section>
  );
}

export function SettingsForm({ guildId, initial, initialRevision }: Props) {
  const [settings, setSettings] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [status, setStatus] = useState("No unsaved changes");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const set = (recipe: (draft: GuildSettings) => void) => {
    setSettings((current) => { const draft = structuredClone(current); recipe(draft); return draft; });
    setStatus("Unsaved changes");
    setDirty(true);
  };
  const save = async () => {
    if (saving) return;
    const validation = guildSettingsSchema.safeParse(settings);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      setStatus(issue ? `Save failed: ${issue.path.join(" > ") || "settings"} - ${issue.message}` : "Save failed: invalid settings");
      return;
    }
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
  const coinflip = settings.games.coinflip;
  const curveDiagnostics = analyzeCurve(settings);
  const activePreset = detectLevelingPreset(settings);
  const averageGain = Math.round((settings.gain.min + settings.gain.max) / 2 * settings.multipliers.global);
  const operationState: OperationState = saving ? "pending" : status.startsWith("Save failed") ? "error" : dirty ? "warning" : status.startsWith("Saved") || status === "Changes reset" ? "success" : "idle";
  const applyPreset = (name: LevelingPresetName) => {
    setSettings((current) => applyLevelingPreset(current, name));
    setStatus(`${levelingPresets[name].label} preset ready to review`);
    setDirty(true);
  };
  return <>
    <Section label="xp" title="XP earning" description="Control where ordinary activity becomes progression and how often members can earn.">
      <div className="grid gap-4 border-b border-border py-5">
        <div>
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">Complete presets</span>
          <p className="mt-1.5 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">Apply message XP, cooldown, multiplier, and exact level thresholds together. Nothing changes until you save.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.entries(levelingPresets) as [LevelingPresetName, (typeof levelingPresets)[LevelingPresetName]][]).map(([name, preset]) => (
            <button
              type="button"
              key={name}
              onClick={() => applyPreset(name)}
              aria-pressed={activePreset === name}
              className={cn(
                "grid gap-1 border px-3 py-3 text-left transition-colors duration-160 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activePreset === name
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-border-strong hover:bg-accent",
              )}
            >
              <strong className="text-sm font-medium">{preset.label}</strong>
              <span className="truncate text-xs opacity-75">{preset.description}</span>
            </button>
          ))}
        </div>
        {activePreset === "custom" && <span className="font-mono text-xs text-muted-foreground">Custom XP configuration</span>}
      </div>
      <Row title="Enable XP" description="Award XP for eligible server messages."><Toggle checked={settings.enabled} onChange={(value) => set((draft) => { draft.enabled = value; })} /></Row>
      <Row title="Minimum XP" description="Smallest base award per cooldown."><NumberField value={settings.gain.min} min={0} max={5000} onChange={(value) => set((draft) => { draft.gain.min = value; })} /></Row>
      <Row title="Maximum XP" description="Largest base award per cooldown."><NumberField value={settings.gain.max} min={0} max={5000} onChange={(value) => set((draft) => { draft.gain.max = value; })} /></Row>
      <Row title="Cooldown" description="Seconds before a member can earn message XP again."><NumberField value={settings.gain.cooldownSeconds} min={0} max={31536000} step={.25} onChange={(value) => set((draft) => { draft.gain.cooldownSeconds = value; })} /></Row>
      <Row title="Global multiplier" description="Applied to all ordinary chat XP before vote boosts."><NumberField value={settings.multipliers.global} min={0} max={100} step={.05} onChange={(value) => set((draft) => { draft.multipliers.global = value; })} /></Row>
      <Row title="top.gg vote boost" description="Give recent voters an additional chat XP multiplier."><Toggle checked={settings.multipliers.vote.enabled} onChange={(value) => set((draft) => { draft.multipliers.vote.enabled = value; })} /></Row>
      <Row title="Vote multiplier" description="Multiplier granted after a verified top.gg vote."><NumberField value={settings.multipliers.vote.multiplier} min={1} max={10} step={.05} onChange={(value) => set((draft) => { draft.multipliers.vote.multiplier = value; })} /></Row>
      <Row title="Vote duration" description="Hours the boost remains active."><NumberField value={settings.multipliers.vote.durationHours} min={1} max={168} onChange={(value) => set((draft) => { draft.multipliers.vote.durationHours = value; })} /></Row>
      <Row title="Channel policy mode" description="Deny listed locations or allow XP only in listed locations.">
        <Select value={settings.channelPolicy.mode} onValueChange={(value) => set((draft) => { draft.channelPolicy.mode = value as "allowlist" | "denylist"; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="denylist">Denylist</SelectItem><SelectItem value="allowlist">Allowlist</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Policy locations" description="Category, channel, forum, or thread IDs. Parent rules inherit into threads."><Textarea rows={4} value={settings.channelPolicy.channelIds.join("\n")} onChange={(event) => set((draft) => { draft.channelPolicy.channelIds = event.target.value.split(/\s|,/).map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="XP in threads" description="Threads must also pass their parent channel/category policy."><Toggle checked={settings.channelPolicy.threadsEnabled} onChange={(value) => set((draft) => { draft.channelPolicy.threadsEnabled = value; })} /></Row>
    </Section>

    <Section label="curve" title="Level curve" description="Shape every threshold with a live preview driven by the exact same math as the bot.">
      <div className="py-5"><CurvePreview settings={settings} /></div>
      <div className="grid border border-border sm:grid-cols-3">
        <div className="border-b border-border px-4 py-3 sm:border-r sm:border-b-0">
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">Average award</span>
          <strong className="mt-1 block font-mono text-sm tnum">{averageGain.toLocaleString()} XP</strong>
        </div>
        <div className="border-b border-border px-4 py-3 sm:border-r sm:border-b-0">
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">Level cap</span>
          <strong className="mt-1 block font-mono text-sm tnum">{settings.curve.maxLevel}</strong>
        </div>
        <div className="px-4 py-3">
          <span className="font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase">Curve state</span>
          <strong className={cn("mt-1 block font-mono text-sm", curveDiagnostics.strictlyIncreasing ? "text-success" : "text-warning")}>{curveDiagnostics.strictlyIncreasing ? "Healthy" : "Needs review"}</strong>
        </div>
      </div>
      <div className="pt-5"><Row title="Maximum level" description="Hard level cap for this server."><NumberField value={settings.curve.maxLevel} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.maxLevel = value; })} /></Row></div>
      <details className="border-t border-border">
        <summary className="cursor-pointer py-4 text-sm font-medium text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Advanced formula</summary>
        <p className="pb-2 text-xs leading-relaxed text-muted-foreground">Edit raw polynomial terms only when matching an imported or custom leveling curve.</p>
        <Row title="Constant coefficient" description="The fixed c0 term used by imported bot formulas."><NumberField value={settings.curve.constant} min={-1000000} max={1000000} step={.01} onChange={(value) => set((draft) => { draft.curve.constant = value; })} /></Row>
        <Row title="Cubic coefficient" description="The L cubed term in the XP curve."><NumberField value={settings.curve.cubic} min={-100} max={100} step={.01} onChange={(value) => set((draft) => { draft.curve.cubic = value; })} /></Row>
        <Row title="Quadratic coefficient" description="The L squared term in the XP curve."><NumberField value={settings.curve.quadratic} min={-10000} max={10000} step={.01} onChange={(value) => set((draft) => { draft.curve.quadratic = value; })} /></Row>
        <Row title="Linear coefficient" description="The L term in the XP curve."><NumberField value={settings.curve.linear} min={-100000} max={100000} step={.01} onChange={(value) => set((draft) => { draft.curve.linear = value; })} /></Row>
        <Row title="Round requirements" description="Round level thresholds to this interval."><NumberField value={settings.curve.rounding} min={1} max={1000} onChange={(value) => set((draft) => { draft.curve.rounding = value; })} /></Row>
      </details>
    </Section>

    <Section label="level-up" title="Announcements" description="Celebrate milestones without turning every channel into a notification stream.">
      <Row title="Announcements" description="Send a message when members level up."><Toggle checked={settings.levelUp.enabled} onChange={(value) => set((draft) => { draft.levelUp.enabled = value; })} /></Row>
      <Row title="Message" description="Supports {user}, {level}, and {xp}."><Textarea rows={3} value={settings.levelUp.message} onChange={(event) => set((draft) => { draft.levelUp.message = event.target.value; })} /></Row>
      <Row title="Destination" description="Use current, dm, or a Discord channel ID."><Input value={settings.levelUp.channelId} onChange={(event) => set((draft) => { draft.levelUp.channelId = event.target.value as GuildSettings["levelUp"]["channelId"]; })} /></Row>
      <Row title="Reward levels only" description="Announce only when a configured role is reached."><Toggle checked={settings.levelUp.rewardsOnly} onChange={(value) => set((draft) => { draft.levelUp.rewardsOnly = value; })} /></Row>
      <Row title="Announcement interval" description="Announce every N levels below the cutoff."><NumberField value={settings.levelUp.every} min={1} max={1000} onChange={(value) => set((draft) => { draft.levelUp.every = value; })} /></Row>
      <Row title="Interval cutoff" description="After this level, announce every level; zero disables the cutoff."><NumberField value={settings.levelUp.until} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.until = value; })} /></Row>
      <Row title="Minimum announcement level" description="Suppress announcements below this level."><NumberField value={settings.levelUp.minimumLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.levelUp.minimumLevel = value; })} /></Row>
      <Row title="Specific announcement levels" description="Comma-separated levels; empty allows every level."><Input value={settings.levelUp.specificLevels.join(", ")} onChange={(event) => set((draft) => { draft.levelUp.specificLevels = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0); })} /></Row>
    </Section>

    <Section label="rank" title="Rank card" description="Choose how member progress appears when someone runs /rank.">
      <div className="py-5"><RankCardEditor guildId={guildId} value={settings.rankCard} onChange={(value) => set((draft) => { draft.rankCard = value; })} /></div>
      <Row title="Image rank card" description="Return the rendered image from /rank."><Toggle checked={settings.rankCard.enabled} onChange={(value) => set((draft) => { draft.rankCard.enabled = value; })} /></Row>
      <Row title="Private by default" description="Make rank responses ephemeral."><Toggle checked={settings.rankCard.ephemeral} onChange={(value) => set((draft) => { draft.rankCard.ephemeral = value; })} /></Row>
      <Row title="Relative XP" description="Show progress within the current level."><Toggle checked={settings.rankCard.relativeXp} onChange={(value) => set((draft) => { draft.rankCard.relativeXp = value; })} /></Row>
    </Section>

    <Section label="leaderboard" title="Leaderboard" description="Set web visibility, persistent display, and the population included in rankings.">
      <Row title="Enable leaderboard" description="Allow /top and the public leaderboard page."><Toggle checked={settings.leaderboard.enabled} onChange={(value) => set((draft) => { draft.leaderboard.enabled = value; })} /></Row>
      <Row title="Web visibility" description="Choose who may view the web leaderboard.">
        <Select value={settings.leaderboard.visibility} onValueChange={(value) => set((draft) => { draft.leaderboard.visibility = value as GuildSettings["leaderboard"]["visibility"]; draft.leaderboard.private = value !== "public"; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="members">Members only</SelectItem><SelectItem value="managers">Managers only</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Persistent leaderboard" description="Keep one public leaderboard message updated in a Discord channel."><Toggle checked={settings.leaderboard.persistent.enabled} onChange={(value) => set((draft) => { draft.leaderboard.persistent.enabled = value; })} /></Row>
      <Row title="Persistent channel ID" description="Channel where the bot creates and maintains the leaderboard message."><Input value={settings.leaderboard.persistent.channelId ?? ""} pattern="\d{16,20}" onChange={(event) => set((draft) => { draft.leaderboard.persistent.channelId = event.target.value || null; })} /></Row>
      <Row title="Persistent rows" description="Number of ranked members shown in the Discord message."><NumberField value={settings.leaderboard.persistent.rows} min={5} max={25} onChange={(value) => set((draft) => { draft.leaderboard.persistent.rows = value; })} /></Row>
      <Row title="Minimum level" description="Hide entries below this level."><NumberField value={settings.leaderboard.minLevel} min={0} max={1000} onChange={(value) => set((draft) => { draft.leaderboard.minLevel = value; })} /></Row>
      <Row title="Maximum entries" description="Zero keeps the full leaderboard."><NumberField value={settings.leaderboard.maxEntries} min={0} max={1000000} onChange={(value) => set((draft) => { draft.leaderboard.maxEntries = value; })} /></Row>
    </Section>

    <Section label="commands" title="Commands" description="Configure message commands independently from messages ignored for XP.">
      <Row title="Prefix commands" description="Allow members to use message commands as an alternative to slash commands."><Toggle checked={settings.commands.prefixEnabled} onChange={(value) => set((draft) => { draft.commands.prefixEnabled = value; })} /></Row>
      <Row title="Command prefix" description="The server prefix for message commands, such as i!rank."><Input value={settings.commands.prefix} placeholder="i!" maxLength={6} disabled={!settings.commands.prefixEnabled} onChange={(event) => set((draft) => { draft.commands.prefix = event.target.value; })} /></Row>
      <Row title="Command messages earn XP" description="Count otherwise eligible command messages toward normal message XP."><Toggle checked={settings.community.countCommands} onChange={(value) => set((draft) => { draft.community.countCommands = value; })} /></Row>
    </Section>

    <Section label="games" title="Chat games" description="Managers start word and math races; members answer them with normal chat messages.">
      <p className="border-b border-border py-4 text-xs leading-relaxed text-muted-foreground">Word and math starts are manager-only. Answers are ordinary messages, not commands.</p>
      <Row title="Automatic rotation" description="Persistently schedule word and math races."><Toggle checked={rotation.enabled} onChange={(value) => set((draft) => { draft.games.rotation.enabled = value; })} /></Row>
      <Row title="Game channels" description="Comma-separated text channel IDs."><Input value={rotation.channelIds.join(", ")} onChange={(event) => set((draft) => { draft.games.rotation.channelIds = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Rotation interval" description="Minutes between rounds in each channel."><NumberField value={rotation.intervalMinutes} min={1} max={10080} onChange={(value) => set((draft) => { draft.games.rotation.intervalMinutes = value; })} /></Row>
      <Row title="Rotation mode" description="Choose games randomly or alternate in order.">
        <Select value={rotation.mode} onValueChange={(value) => set((draft) => { draft.games.rotation.mode = value as "random" | "round-robin"; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="random">Random</SelectItem><SelectItem value="round-robin">Round robin</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Enabled game types" description="Comma-separated: word, math."><Input value={rotation.types.join(", ")} onChange={(event) => set((draft) => { draft.games.rotation.types = event.target.value.split(",").map((value) => value.trim()).filter((value): value is "word" | "math" => value === "word" || value === "math"); })} /></Row>
      <Row title="Word race" description="Enable manager-started type-the-word images answered with normal messages."><Toggle checked={word.enabled} onChange={(value) => set((draft) => { draft.games.wordRace.enabled = value; })} /></Row>
      <Row title="Word answer window" description="Seconds available to answer in chat; the default is 120."><NumberField value={word.answerSeconds} min={10} max={3600} onChange={(value) => set((draft) => { draft.games.wordRace.answerSeconds = value; })} /></Row>
      <Row title="Word place XP" description="One to three comma-separated rewards: first, second, third."><Input value={word.placeXp.join(", ")} onChange={(event) => set((draft) => { draft.games.wordRace.placeXp = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0).slice(0, 3); })} /></Row>
      <Row title="Word hints" description="Progressive hints before expiration."><NumberField value={word.hints} min={0} max={5} onChange={(value) => set((draft) => { draft.games.wordRace.hints = value; })} /></Row>
      <Row title="Custom words" description="One word per line; empty uses built-in words."><Textarea rows={6} value={word.customWords.join("\n")} onChange={(event) => set((draft) => { draft.games.wordRace.customWords = event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Math race" description="Enable manager-started equations answered with normal messages."><Toggle checked={math.enabled} onChange={(value) => set((draft) => { draft.games.mathRace.enabled = value; })} /></Row>
      <Row title="Math difficulty" description="Control expression complexity.">
        <Select value={math.difficulty} onValueChange={(value) => set((draft) => { draft.games.mathRace.difficulty = value as GuildSettings["games"]["mathRace"]["difficulty"]; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="easy">Easy</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="hard">Hard</SelectItem><SelectItem value="mixed">Mixed</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Math answer window" description="Seconds available to answer in chat; the default is 120."><NumberField value={math.answerSeconds} min={10} max={3600} onChange={(value) => set((draft) => { draft.games.mathRace.answerSeconds = value; })} /></Row>
      <Row title="Math place XP" description="One to three comma-separated rewards."><Input value={math.placeXp.join(", ")} onChange={(event) => set((draft) => { draft.games.mathRace.placeXp = event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0).slice(0, 3); })} /></Row>
      <Row title="Coinflip challenges" description="Let members wager XP against another member through a timed challenge."><Toggle checked={coinflip.enabled} onChange={(value) => set((draft) => { draft.games.coinflip.enabled = value; })} /></Row>
      <Row title="Minimum wager" description="Lowest XP wager accepted for a coinflip."><NumberField value={coinflip.minWager} min={1} max={MAX_COINFLIP_WAGER} onChange={(value) => set((draft) => { draft.games.coinflip.minWager = value; })} /></Row>
      <Row title="Maximum wager" description="Highest XP wager accepted; it must be at least the minimum."><NumberField value={coinflip.maxWager} min={coinflip.minWager} max={MAX_COINFLIP_WAGER} onChange={(value) => set((draft) => { draft.games.coinflip.maxWager = value; })} /></Row>
      <Row title="Challenge timeout" description="Seconds the challenged member has to accept or decline."><NumberField value={coinflip.challengeSeconds} min={30} max={600} onChange={(value) => set((draft) => { draft.games.coinflip.challengeSeconds = value; })} /></Row>
    </Section>

    {/*
      Giveaways: the surface exists so the nav slot, anchor and state tokens are
      settled. Nothing here is wired to storage yet, and there is no giveaway
      key in guildSettingsSchema, so there is nothing to save.
    */}
    <Section
      label="giveaways"
      title="Giveaways"
      description="Draw prizes from the same progression data the rest of Inochi runs on, so time spent in the server can count for something."
      badge={<Badge variant="scheduled">In development</Badge>}
    >
      <div className="flex flex-col items-start gap-4 py-8 sm:flex-row sm:items-center">
        <Gift className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          Level-weighted entries, minimum level requirements, scheduled draws, and re-rolls are being
          built. This section will fill in without moving anything else on the page.
        </p>
      </div>
    </Section>

    <Section label="roles" title="Roles, multipliers, and community" description="Connect progression to Discord roles and tune exceptions for your community.">
      <Row title="Configured rewards" description="Use /rewardrole for Discord's validated role picker. Remove entries here by role ID."><Textarea rows={5} value={settings.rewards.map((reward) => `${reward.roleId}:${reward.level}:${reward.keep}:${reward.noSync}`).join("\n")} onChange={(event) => set((draft) => { draft.rewards = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [roleId, level, keep, noSync] = line.split(":"); return roleId && level ? [{ roleId, level: Number(level), keep: keep === "true", noSync: noSync === "true" }] : []; }); })} /></Row>
      <Row title="Weekly XP" description="Track and display a separate weekly leaderboard."><Toggle checked={settings.community.weeklyXp} onChange={(value) => set((draft) => { draft.community.weeklyXp = value; })} /></Row>
      <Row title="Clear on leave" description="Delete a member's XP when they leave the server."><Toggle checked={settings.community.clearOnLeave} onChange={(value) => set((draft) => { draft.community.clearOnLeave = value; })} /></Row>
      <Row title="Join role ID" description="Role granted to new members; leave blank to disable."><Input value={settings.community.joinRoleId ?? ""} onChange={(event) => set((draft) => { draft.community.joinRoleId = event.target.value || null; })} /></Row>
      <Row title="XP blacklist roles" description="Comma-separated role IDs that cannot earn message XP."><Input value={settings.community.blacklistRoleIds.join(", ")} onChange={(event) => set((draft) => { draft.community.blacklistRoleIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="No reward roles" description="Members with these roles do not receive level reward roles."><Input value={settings.community.noRewardRoleIds.join(", ")} onChange={(event) => set((draft) => { draft.community.noRewardRoleIds = event.target.value.split(",").map((id) => id.trim()).filter(Boolean); })} /></Row>
      <Row title="Other ignored prefixes" description="Separately from the configured command prefix, messages beginning with these values do not earn XP."><Input value={settings.community.ignoredPrefixes.join(", ")} onChange={(event) => set((draft) => { draft.community.ignoredPrefixes = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); })} /></Row>
      <Row title="Reset automation" description="Delete leveling data on leave/kick, ban, both, or never.">
        <Select value={settings.community.resetOn} onValueChange={(value) => set((draft) => { draft.community.resetOn = value as GuildSettings["community"]["resetOn"]; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="never">Never</SelectItem><SelectItem value="leave">Leave or kick</SelectItem><SelectItem value="ban">Ban</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Daily top role ID" description="At UTC day rollover, assign this role to the highest eligible member."><Input value={settings.community.dailyTopRoleId ?? ""} onChange={(event) => set((draft) => { draft.community.dailyTopRoleId = event.target.value || null; })} /></Row>
      <Row title="Role multipliers" description="One role ID and multiplier per line, formatted roleId:value."><Textarea rows={4} value={settings.multipliers.roles.map((item) => `${item.roleId}:${item.multiplier}`).join("\n")} onChange={(event) => set((draft) => { draft.multipliers.roles = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [roleId, multiplier] = line.split(":"); return roleId && multiplier ? [{ roleId, multiplier: Number(multiplier) }] : []; }); })} /></Row>
      <Row title="Channel multipliers" description="One channel ID and multiplier per line, formatted channelId:value."><Textarea rows={4} value={settings.multipliers.channels.map((item) => `${item.channelId}:${item.multiplier}`).join("\n")} onChange={(event) => set((draft) => { draft.multipliers.channels = event.target.value.split(/\r?\n/).filter(Boolean).flatMap((line) => { const [channelId, multiplier] = line.split(":"); return channelId && multiplier ? [{ channelId, multiplier: Number(multiplier) }] : []; }); })} /></Row>
      <Row title="Role multiplier mode" description="How multiple matching role multipliers combine.">
        <Select value={settings.multipliers.roleMode} onValueChange={(value) => set((draft) => { draft.multipliers.roleMode = value as GuildSettings["multipliers"]["roleMode"]; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="largest">Largest</SelectItem><SelectItem value="smallest">Smallest</SelectItem><SelectItem value="highest">Highest role</SelectItem><SelectItem value="add">Add</SelectItem><SelectItem value="combine">Multiply</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Channel stacking mode" description="How channel and role results combine.">
        <Select value={settings.multipliers.stackMode} onValueChange={(value) => set((draft) => { draft.multipliers.stackMode = value as GuildSettings["multipliers"]["stackMode"]; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="multiply">Multiply</SelectItem><SelectItem value="add">Add</SelectItem><SelectItem value="largest">Largest</SelectItem><SelectItem value="channel">Channel priority</SelectItem><SelectItem value="role">Role priority</SelectItem></SelectContent>
        </Select>
      </Row>
    </Section>

    <Section label="logging" title="Logs and automated backups" description="Send operational events and scheduled full backups to one private Discord channel.">
      <Row title="Audit channel ID" description="Use a private text channel where Inochi can send embeds and attachments."><Input value={settings.logging.channelId ?? ""} pattern="\d{16,20}" onChange={(event) => set((draft) => { draft.logging.channelId = event.target.value || null; })} /></Row>
      <Row title="Command usage" description="Log command names, actors, and channels without raw options or message content."><Toggle checked={settings.logging.commandUsage} onChange={(value) => set((draft) => { draft.logging.commandUsage = value; })} /></Row>
      <Row title="Level ups" description="Log level transitions, XP totals, and source channels."><Toggle checked={settings.logging.levelUps} onChange={(value) => set((draft) => { draft.logging.levelUps = value; })} /></Row>
      <Row title="Administrative actions" description="Log manager commands and configuration operations."><Toggle checked={settings.logging.adminActions} onChange={(value) => set((draft) => { draft.logging.adminActions = value; })} /></Row>
      <Row title="Errors" description="Send sanitized command failure notifications."><Toggle checked={settings.logging.errors} onChange={(value) => set((draft) => { draft.logging.errors = value; })} /></Row>
      <Row title="Backup delivery" description="Send scheduled backup status and attachments to the audit channel."><Toggle checked={settings.logging.backups} onChange={(value) => set((draft) => { draft.logging.backups = value; })} /></Row>
      <Row title="Scheduled backups" description="Create full settings/member snapshots on the selected cadence."><Toggle checked={settings.backups.enabled} onChange={(value) => set((draft) => { draft.backups.enabled = value; })} /></Row>
      <Row title="Backup cadence" description="Daily or weekly full compressed snapshots.">
        <Select value={settings.backups.cadence} onValueChange={(value) => set((draft) => { draft.backups.cadence = value as "daily" | "weekly"; })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent>
        </Select>
      </Row>
      <Row title="Backup hour UTC" description="Hour from 0 to 23 when the scheduler should run."><NumberField value={settings.backups.hourUtc} min={0} max={23} onChange={(value) => set((draft) => { draft.backups.hourUtc = value; })} /></Row>
      {settings.backups.cadence === "weekly" && <Row title="Backup weekday" description="0 is Sunday and 6 is Saturday."><NumberField value={settings.backups.weekday} min={0} max={6} onChange={(value) => set((draft) => { draft.backups.weekday = value; })} /></Row>}
      <Row title="Retention" description="Days to retain scheduled snapshots in PostgreSQL."><NumberField value={settings.backups.retentionDays} min={1} max={90} onChange={(value) => set((draft) => { draft.backups.retentionDays = value; })} /></Row>
    </Section>

    <Section label="imports" title="Data, imports, and backups" description="Move existing progression in, take complete snapshots, and create scoped API access.">
      <div className="border-b border-border py-5">
        <p className="text-sm leading-relaxed">Run <code className="font-mono text-primary-text">/import</code>, choose the source in the private control panel, and select <strong>Start</strong>. For message-based sources, invoke the source bot&apos;s public leaderboard in that channel and advance every page before selecting <strong>Review</strong> and <strong>Apply</strong>.</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Official JSON/CSV exports remain preferred. Ephemeral source messages cannot be captured.</p>
      </div>
      <div className="py-5"><DataTools guildId={guildId} /></div>
    </Section>

    <div className="sticky bottom-4 z-10 mt-6 flex flex-col gap-3 border border-border-strong bg-popover/95 p-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
      <OperationStatus state={operationState} compact>{status}</OperationStatus>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset} disabled={!dirty || saving}><RotateCcw /> Reset</Button>
        <Button type="button" variant="primary" size="sm" onClick={save} disabled={!dirty || saving}><Save /> {saving ? "Saving..." : "Save configuration"}</Button>
      </div>
    </div>
  </>;
}
