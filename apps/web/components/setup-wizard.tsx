"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyLevelingPreset, levelingPresets } from "@inochi/core";
import type { GuildSettings, LevelingPresetName } from "@inochi/core";

const steps = ["Welcome", "Progression", "Communication", "Backups", "Activate"];

export function SetupWizard({ guildId, guildName, initial, revision }: { guildId: string; guildName: string; initial: GuildSettings; revision: number }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState("");
  const update = (recipe: (draft: GuildSettings) => void) => setSettings((current) => { const draft = structuredClone(current); recipe(draft); return draft; });
  const finish = async () => {
    setStatus("Saving and validating setup...");
    const finalSettings = { ...settings, enabled: true };
    const response = await fetch(`/api/guilds/${guildId}/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: finalSettings, expectedRevision: revision, completeSetup: true }) });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error ?? "Setup failed");
    router.push(`/dashboard/${guildId}`);
    router.refresh();
  };
  return <main className="setup-page"><div className="setup-shell"><div className="eyebrow mono">Inochi setup / {guildName}</div><div className="setup-progress">{steps.map((name, index) => <span className={index <= step ? "active" : ""} key={name}>{index + 1}<small>{name}</small></span>)}</div>
    {step === 0 && <section><h1>Start with a safe baseline.</h1><p>{initial.enabled ? "XP is already active for this server; your existing configuration remains live until you finish." : "XP remains paused until the final step."} This wizard configures the essentials; every advanced option remains available in the dashboard.</p></section>}
    {step === 1 && <section><h1>Choose progression speed.</h1><p>Select a complete, verified message-XP and curve preset.</p><div className="setup-options">{(Object.entries(levelingPresets) as [LevelingPresetName, (typeof levelingPresets)[LevelingPresetName]][]).map(([name, preset]) => <button type="button" key={name} onClick={() => setSettings((current) => applyLevelingPreset(current, name))}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div></section>}
    {step === 2 && <section><h1>Choose where operations appear.</h1><label>Private audit channel ID<input value={settings.logging.channelId ?? ""} placeholder="Discord channel ID" onChange={(event) => update((draft) => { draft.logging.channelId = event.target.value || null; })} /></label><label className="setup-check"><input type="checkbox" checked={settings.levelUp.enabled} onChange={(event) => update((draft) => { draft.levelUp.enabled = event.target.checked; })} /> Announce level ups in the earning channel</label></section>}
    {step === 3 && <section><h1>Protect progression data.</h1><label className="setup-check"><input type="checkbox" checked={settings.backups.enabled} disabled={!settings.logging.channelId} onChange={(event) => update((draft) => { draft.backups.enabled = event.target.checked; })} /> Enable full scheduled backups</label><label>Cadence<select value={settings.backups.cadence} onChange={(event) => update((draft) => { draft.backups.cadence = event.target.value as "daily" | "weekly"; })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><p>Backups are retained for {settings.backups.retentionDays} days and sent as compressed attachments when they fit Discord limits.</p></section>}
    {step === 4 && <section><h1>Activate {guildName}.</h1><p>Inochi will award {settings.gain.min}-{settings.gain.max} XP every {settings.gain.cooldownSeconds} seconds. Logs {settings.logging.channelId ? "will use the selected private channel" : "remain disabled until a channel is configured"}. Run <code>/diagnose</code> after activation.</p><div className="notice warning">Confirm that the backup/log channel is private. Full backups contain Discord member IDs and progression data.</div></section>}
    <div className="setup-actions"><button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>Back</button>{step < steps.length - 1 ? <button className="primary" type="button" onClick={() => setStep((value) => value + 1)}>Continue</button> : <button className="primary" type="button" onClick={() => void finish()}>Enable XP and finish</button>}</div><div className="status" role="status">{status}</div></div></main>;
}
