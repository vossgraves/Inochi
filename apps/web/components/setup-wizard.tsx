"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyLevelingPreset, detectLevelingPreset, levelingPresets, MAX_COINFLIP_WAGER } from "@inochi/core";
import type { GuildSettings, LevelingPresetName } from "@inochi/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const steps = ["Welcome", "Progression", "Commands & games", "Communication", "Backups", "Activate"];

const fieldLabel = "font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase";
const heading = "text-3xl font-bold tracking-tight sm:text-4xl";
const body = "mt-4 max-w-[62ch] leading-relaxed text-muted-foreground";

function CheckRow({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-border py-4 text-sm last:border-b-0">
      <span className={disabled ? "text-muted-foreground" : undefined}>{children}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

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

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-[52rem] border border-border p-6 sm:p-10">
        <span className="font-mono text-[0.7rem] tracking-[0.2em] text-muted-foreground uppercase">
          Inochi setup / {guildName}
        </span>

        {/* Progress rail: a hairline per step, filled in vermilion once reached. */}
        <ol className="mt-8 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Setup progress">
          {steps.map((name, index) => (
            <li
              key={name}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "border-t-2 pt-2.5 font-mono text-[0.6rem] tracking-wider uppercase",
                index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground",
              )}
            >
              <span className="tnum">{String(index + 1).padStart(2, "0")}</span>
              <small className="mt-0.5 block leading-tight break-words">{name}</small>
            </li>
          ))}
        </ol>

        <div className="mt-10 min-h-[18rem]">
          {step === 0 && (
            <section>
              <h1 className={heading}>Start with a safe baseline.</h1>
              <p className={body}>
                {initial.enabled
                  ? "XP is already active for this server; your existing configuration remains live until you finish."
                  : "XP remains paused until the final step."}{" "}
                This wizard configures the essentials; every advanced option remains available in the
                dashboard.
              </p>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className={heading}>Choose progression speed.</h1>
              <p className={body}>
                Select a complete, verified message-XP and curve preset. Your supplied custom settings
                remain unchanged until you select an option.
              </p>
              <div className="mt-8 grid gap-2 sm:grid-cols-2">
                {(Object.entries(levelingPresets) as [LevelingPresetName, (typeof levelingPresets)[LevelingPresetName]][]).map(([name, preset]) => (
                  <button
                    type="button"
                    key={name}
                    aria-pressed={selectedPreset === name}
                    onClick={() => { setSelectedPreset(name); setSettings((current) => applyLevelingPreset(current, name)); }}
                    className={cn(
                      "grid gap-1 border px-4 py-3 text-left transition-colors duration-160 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      selectedPreset === name
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-border-strong hover:bg-accent",
                    )}
                  >
                    <strong className="text-sm font-medium">{preset.label}</strong>
                    <span className="text-xs leading-relaxed opacity-75">{preset.description}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className={heading}>Open commands and games.</h1>
              <p className={body}>
                Choose the message-command path and the games available at launch. Word and math races
                are started by managers, then answered by members with normal chat messages.
              </p>
              <div className="mt-8">
                <CheckRow checked={settings.commands.prefixEnabled} onChange={(value) => update((draft) => { draft.commands.prefixEnabled = value; })}>
                  Enable prefix commands
                </CheckRow>
                <div className="grid gap-2 border-b border-border py-4">
                  <label className={fieldLabel} htmlFor="setup-prefix">Command prefix</label>
                  <Input
                    id="setup-prefix"
                    value={settings.commands.prefix}
                    placeholder="i!"
                    maxLength={6}
                    disabled={!settings.commands.prefixEnabled}
                    onChange={(event) => update((draft) => { draft.commands.prefix = event.target.value; })}
                  />
                </div>
                <CheckRow checked={settings.games.wordRace.enabled} onChange={(value) => update((draft) => { draft.games.wordRace.enabled = value; })}>Word race</CheckRow>
                <CheckRow checked={settings.games.mathRace.enabled} onChange={(value) => update((draft) => { draft.games.mathRace.enabled = value; })}>Math race</CheckRow>
                <CheckRow checked={settings.games.coinflip.enabled} onChange={(value) => update((draft) => { draft.games.coinflip.enabled = value; })}>Coinflip challenges</CheckRow>
                <div className="grid gap-4 pt-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <label className={fieldLabel} htmlFor="setup-min-wager">Minimum coinflip wager</label>
                    <Input id="setup-min-wager" type="number" min={1} max={MAX_COINFLIP_WAGER} value={settings.games.coinflip.minWager} onChange={(event) => update((draft) => { draft.games.coinflip.minWager = Number(event.target.value); })} />
                  </div>
                  <div className="grid gap-2">
                    <label className={fieldLabel} htmlFor="setup-max-wager">Maximum coinflip wager</label>
                    <Input id="setup-max-wager" type="number" min={settings.games.coinflip.minWager} max={MAX_COINFLIP_WAGER} value={settings.games.coinflip.maxWager} onChange={(event) => update((draft) => { draft.games.coinflip.maxWager = Number(event.target.value); })} />
                  </div>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className={heading}>Choose where operations appear.</h1>
              <div className="mt-8">
                <div className="grid gap-2 border-b border-border py-4">
                  <label className={fieldLabel} htmlFor="setup-audit">Private audit channel ID</label>
                  <Input id="setup-audit" value={settings.logging.channelId ?? ""} placeholder="Discord channel ID" onChange={(event) => update((draft) => { draft.logging.channelId = event.target.value || null; })} />
                </div>
                <CheckRow checked={settings.levelUp.enabled} onChange={(value) => update((draft) => { draft.levelUp.enabled = value; })}>
                  Announce level ups in the earning channel
                </CheckRow>
              </div>
            </section>
          )}

          {step === 4 && (
            <section>
              <h1 className={heading}>Protect progression data.</h1>
              <div className="mt-8">
                <CheckRow
                  checked={settings.backups.enabled}
                  disabled={!settings.logging.channelId}
                  onChange={(value) => update((draft) => { draft.backups.enabled = value; })}
                >
                  Enable full scheduled backups
                </CheckRow>
                <div className="grid gap-2 border-b border-border py-4">
                  <label className={fieldLabel} htmlFor="setup-cadence">Cadence</label>
                  <Select value={settings.backups.cadence} onValueChange={(value) => update((draft) => { draft.backups.cadence = value as "daily" | "weekly"; })}>
                    <SelectTrigger id="setup-cadence"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="pt-4 text-sm leading-relaxed text-muted-foreground">
                  Backups are retained for {settings.backups.retentionDays} days and sent as compressed
                  attachments when they fit Discord limits.
                </p>
              </div>
            </section>
          )}

          {step === 5 && (
            <section>
              <h1 className={heading}>Activate {guildName}.</h1>
              <p className={body}>
                Inochi will award {settings.gain.min}-{settings.gain.max} XP every{" "}
                {settings.gain.cooldownSeconds} seconds. Prefix commands are{" "}
                {settings.commands.prefixEnabled ? `enabled with ${settings.commands.prefix}` : "disabled"}.
                Games enabled:{" "}
                {[
                  settings.games.wordRace.enabled && "word",
                  settings.games.mathRace.enabled && "math",
                  settings.games.coinflip.enabled && `coinflip (${settings.games.coinflip.minWager}-${settings.games.coinflip.maxWager} XP)`,
                ].filter(Boolean).join(", ") || "none"}
                . Logs{" "}
                {settings.logging.channelId ? "will use the selected private channel" : "remain disabled until a channel is configured"}.
                Run <code className="font-mono text-primary-text">/diagnose</code> after activation.
              </p>
              <p className="mt-6 border border-warning/40 px-4 py-3 text-sm leading-relaxed text-warning">
                Confirm that the backup/log channel is private. Full backups contain Discord member IDs
                and progression data.
              </p>
            </section>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
          <Button type="button" variant="outline" disabled={step === 0 || saving} onClick={() => setStep((value) => value - 1)}>
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" variant="primary" disabled={saving} onClick={() => setStep((value) => value + 1)}>
              Continue
            </Button>
          ) : (
            <Button type="button" variant="primary" disabled={saving} onClick={() => void finish()}>
              {saving ? "Saving..." : "Enable XP and finish"}
            </Button>
          )}
        </div>
        <p className="mt-4 font-mono text-xs text-muted-foreground" role="status">{status}</p>
      </div>
    </main>
  );
}
