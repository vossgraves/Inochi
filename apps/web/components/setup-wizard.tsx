"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyLevelingPreset, detectLevelingPreset, levelingPresets, MAX_COINFLIP_WAGER } from "@inochi/core";
import type { GuildSettings, LevelingPresetName } from "@inochi/core";

const steps = ["Welcome", "Progression", "Commands & games", "Communication", "Backups", "Activate"];

export function SetupWizard({ guildId, guildName, initial, revision }: { guildId: string; guildName: string; initial: GuildSettings; revision: number }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(initial);
  const detectedPreset = detectLevelingPreset(initial);
  const [selectedPreset, setSelectedPreset] = useState<LevelingPresetName | null>(detectedPreset === "custom" ? null : detectedPreset);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (recipe: (draft: GuildSettings) => void) => setSettings((current) => { const draft = structuredClone(current); recipe(draft); return draft; });
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setStatus("Saving and validating setup...");
    try {
      const finalSettings = { ...settings, enabled: true };
      const response = await fetch(`/api/guilds/${guildId}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: finalSettings, expectedRevision: revision, completeSetup: true }) });
      const result = await response.json();
      if (!response.ok) return setStatus(result.error ?? "Setup failed");
      router.push(`/dashboard/${guildId}`);
      router.refresh();
    } catch {
      setStatus("Setup could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };
  return <main className="setup-page"><div className="setup-shell"><div className="eyebrow mono">Inochi setup / {guildName}</div><div className="setup-progress" aria-label="Setup progress">{steps.map((name, index) => <span className={index <= step ? "active" : ""} aria-current={index === step ? "step" : undefined} key={name}>{index + 1}<small>{name}</small></span>)}</div>
    {step === 0 && <section><h1>Start with a safe baseline.</h1><p>{initial.enabled ? "XP is already active for this server; your existing configuration remains live until you finish." : "XP remains paused until the final step."} This wizard configures the essentials; every advanced option remains available in the dashboard.</p></section>}
    {step === 1 && <section><h1>Choose progression speed.</h1><p>Select a complete, verified message-XP and curve preset. Your supplied custom settings remain unchanged until you select an option.</p><div className="setup-options">{(Object.entries(levelingPresets) as [LevelingPresetName, (typeof levelingPresets)[LevelingPresetName]][]).map(([name, preset]) => <button type="button" className={selectedPreset === name ? "selected" : ""} aria-pressed={selectedPreset === name} key={name} onClick={() => { setSelectedPreset(name); setSettings((current) => applyLevelingPreset(current, name)); }}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div></section>}
    {step === 2 && <section><h1>Open commands and games.</h1><p>Choose the message-command path and the games available at launch. Word and math races are started by managers, then answered by members with normal chat messages.</p><label className="setup-check"><input type="checkbox" checked={settings.commands.prefixEnabled} onChange={(event) => update((draft) => { draft.commands.prefixEnabled = event.target.checked; })} /> Enable prefix commands</label><label>Command prefix<input value={settings.commands.prefix} placeholder="i!" maxLength={6} disabled={!settings.commands.prefixEnabled} onChange={(event) => update((draft) => { draft.commands.prefix = event.target.value; })} /></label><div className="setup-game-grid"><label className="setup-check"><input type="checkbox" checked={settings.games.wordRace.enabled} onChange={(event) => update((draft) => { draft.games.wordRace.enabled = event.target.checked; })} /> Word race</label><label className="setup-check"><input type="checkbox" checked={settings.games.mathRace.enabled} onChange={(event) => update((draft) => { draft.games.mathRace.enabled = event.target.checked; })} /> Math race</label><label className="setup-check"><input type="checkbox" checked={settings.games.coinflip.enabled} onChange={(event) => update((draft) => { draft.games.coinflip.enabled = event.target.checked; })} /> Coinflip challenges</label></div><div className="setup-inline-fields"><label>Minimum coinflip wager<input type="number" min={1} max={MAX_COINFLIP_WAGER} value={settings.games.coinflip.minWager} onChange={(event) => update((draft) => { draft.games.coinflip.minWager = Number(event.target.value); })} /></label><label>Maximum coinflip wager<input type="number" min={settings.games.coinflip.minWager} max={MAX_COINFLIP_WAGER} value={settings.games.coinflip.maxWager} onChange={(event) => update((draft) => { draft.games.coinflip.maxWager = Number(event.target.value); })} /></label></div></section>}
    {step === 3 && <section><h1>Choose where operations appear.</h1><label>Private audit channel ID<input value={settings.logging.channelId ?? ""} placeholder="Discord channel ID" onChange={(event) => update((draft) => { draft.logging.channelId = event.target.value || null; })} /></label><label className="setup-check"><input type="checkbox" checked={settings.levelUp.enabled} onChange={(event) => update((draft) => { draft.levelUp.enabled = event.target.checked; })} /> Announce level ups in the earning channel</label></section>}
    {step === 4 && <section><h1>Protect progression data.</h1><label className="setup-check"><input type="checkbox" checked={settings.backups.enabled} disabled={!settings.logging.channelId} onChange={(event) => update((draft) => { draft.backups.enabled = event.target.checked; })} /> Enable full scheduled backups</label><label>Cadence<select value={settings.backups.cadence} onChange={(event) => update((draft) => { draft.backups.cadence = event.target.value as "daily" | "weekly"; })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><p>Backups are retained for {settings.backups.retentionDays} days and sent as compressed attachments when they fit Discord limits.</p></section>}
    {step === 5 && <section><h1>Activate {guildName}.</h1><p>Inochi will award {settings.gain.min}-{settings.gain.max} XP every {settings.gain.cooldownSeconds} seconds. Prefix commands are {settings.commands.prefixEnabled ? `enabled with ${settings.commands.prefix}` : "disabled"}. Games enabled: {[settings.games.wordRace.enabled && "word", settings.games.mathRace.enabled && "math", settings.games.coinflip.enabled && `coinflip (${settings.games.coinflip.minWager}-${settings.games.coinflip.maxWager} XP)`].filter(Boolean).join(", ") || "none"}. Logs {settings.logging.channelId ? "will use the selected private channel" : "remain disabled until a channel is configured"}. Run <code>/diagnose</code> after activation.</p><div className="notice warning">Confirm that the backup/log channel is private. Full backups contain Discord member IDs and progression data.</div></section>}
    <div className="setup-actions"><button type="button" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>Back</button>{step < steps.length - 1 ? <button className="primary" type="button" disabled={saving} onClick={() => setStep((value) => value + 1)}>Continue</button> : <button className="primary" type="button" disabled={saving} onClick={() => void finish()}>{saving ? "Saving..." : "Enable XP and finish"}</button>}</div><div className="status" role="status">{status}</div></div></main>;
}
