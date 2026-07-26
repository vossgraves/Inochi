"use client";

import { useState } from "react";
import { OperationStatus, type OperationState } from "./operation-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ImportPreview = {
  file: File;
  source: string;
  token: string;
  counts: { found: number; unique: number; duplicates: number; truncated: number };
};

const fieldLabel = "font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase";

export function DataTools({ guildId }: { guildId: string }) {
  const [source, setSource] = useState("legacy-json");
  const [status, setStatus] = useState("Choose an official export file.");
  const [statusState, setStatusState] = useState<OperationState>("idle");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importConfirmation, setImportConfirmation] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [restore, setRestore] = useState<{ snapshotId: string; createdAt: string; members: number } | null>(null);
  const [restoreMode, setRestoreMode] = useState<"settings" | "merge" | "replace">("merge");
  const [confirmation, setConfirmation] = useState("");
  const [audit, setAudit] = useState<{ id: string; actorId: string; action: string; createdAt: string }[]>([]);
  const [keys, setKeys] = useState<{ id: string; name: string; userId: string; expiresAt: string; lastUsedAt: string | null }[]>([]);
  const updateStatus = (text: string, state: OperationState) => { setStatus(text); setStatusState(state); };
  const fileData = async (file: File, selectedSource: string) => {
    const text = await file.text();
    if (selectedSource === "csv") return text;
    try { return JSON.parse(text) as unknown; } catch { throw new Error("Invalid JSON file"); }
  };
  const responseJson = async (response: Response) => response.json().catch(() => ({ error: "The server returned an invalid response." })) as { error?: string; token?: string; preview?: ImportPreview["counts"]; imported?: number };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10_000_000) return updateStatus("File is larger than 10 MB.", "error");
    setImportPreview(null);
    setImportBusy(true);
    updateStatus("Validating import preview...", "pending");
    try {
      const data = await fileData(file, source);
      const response = await fetch(`/api/guilds/${guildId}/data`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", source, data }) });
      const result = await responseJson(response);
      if (!response.ok || !result.token || !result.preview) return updateStatus(result.error ?? "Could not preview import.", "error");
      setImportPreview({ file, source, token: result.token, counts: result.preview });
      setImportConfirmation("");
      updateStatus("Preview ready. Review counts before applying.", "success");
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : "Could not read import file.", "error");
    } finally {
      setImportBusy(false);
    }
  };
  const applyImport = async () => {
    if (!importPreview || importConfirmation !== "IMPORT") return;
    setImportBusy(true);
    updateStatus("Applying import...", "pending");
    try {
      const data = await fileData(importPreview.file, importPreview.source);
      const response = await fetch(`/api/guilds/${guildId}/data`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", source: importPreview.source, data, token: importPreview.token, confirmation: importConfirmation }) });
      const result = await responseJson(response);
      if (!response.ok) return updateStatus(result.error ?? "Could not apply import.", "error");
      updateStatus(`Imported ${Number(result.imported).toLocaleString()} members.`, "success");
      setImportPreview(null);
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : "Could not apply import.", "error");
    } finally {
      setImportBusy(false);
    }
  };
  const createBackup = async () => {
    updateStatus("Creating full backup...", "pending");
    try {
      const response = await fetch(`/api/guilds/${guildId}/backups`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) return updateStatus(result.error ?? "Could not create backup.", "error");
      const link = document.createElement("a");
      link.href = `/api/guilds/${guildId}/backups/${result.snapshot.id}`;
      link.download = "";
      link.click();
      updateStatus("Backup secured. Download started.", "success");
    } catch { updateStatus("Could not create backup: network unavailable.", "error"); }
  };
  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    let payload: unknown;
    try { payload = JSON.parse(await file.text()); } catch { return updateStatus("Invalid backup JSON", "error"); }
    updateStatus("Validating backup...", "pending");
    const created = await fetch(`/api/guilds/${guildId}/backups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
    const result = await created.json();
    if (!created.ok) return updateStatus(result.error ?? "Backup validation failed", "error");
    setRestore({ snapshotId: result.snapshot.id, createdAt: result.preview.createdAt, members: result.preview.members });
    setConfirmation("");
    updateStatus("Backup validated. Review the restore plan.", "success");
  };
  const confirmRestore = async () => {
    if (!restore || confirmation !== "RESTORE") return;
    updateStatus("Restoring backup...", "pending");
    const restored = await fetch(`/api/guilds/${guildId}/backups/${restore.snapshotId}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: restoreMode, confirmation }) });
    const restoreResult = await restored.json();
    updateStatus(restored.ok ? `Restore complete for ${restoreResult.restored} members.` : restoreResult.error, restored.ok ? "success" : "error");
    if (restored.ok) setRestore(null);
  };
  const createApiKey = async () => {
    const response = await fetch("/api/profile/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Inochi ${guildId}`, guildIds: [guildId], writeAccess: false }) });
    const result = await response.json();
    if (!response.ok) return updateStatus(result.error, "error");
    setApiKey(result.key);
    updateStatus("Read-only API key created. It will only be shown here once.", "success");
  };
  const loadAudit = async () => {
    const response = await fetch(`/api/guilds/${guildId}/audit`);
    const result = await response.json();
    if (!response.ok) return updateStatus(result.error ?? "Could not load audit history", "error");
    setAudit(result.events);
    updateStatus("Recent audit history loaded.", "success");
  };
  const loadKeys = async () => {
    const response = await fetch(`/api/profile/keys?guildId=${guildId}`);
    const result = await response.json();
    if (!response.ok) return updateStatus(result.error ?? "Could not load API keys", "error");
    setKeys(result.keys);
    updateStatus("API key inventory loaded.", "success");
  };
  const revokeKey = async (id: string) => {
    const response = await fetch("/api/profile/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) return updateStatus("Could not revoke API key", "error");
    setKeys((current) => current.filter((key) => key.id !== id));
    updateStatus("API key revoked.", "success");
  };

  const restoreBusy = statusState === "pending";

  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:gap-8">
      <div>
        <span className="text-sm font-medium">File migration</span>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Legacy ID/XP JSON, Lurkr JSON, or ID/XP CSV. Matching members are replaced; others remain.
        </p>
      </div>

      <div className="grid gap-3">
        <Select
          value={source}
          disabled={importBusy}
          onValueChange={(value) => { setSource(value); setImportPreview(null); updateStatus("Choose an official export file.", "idle"); }}
        >
          <SelectTrigger aria-label="Import source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="legacy-json">Legacy ID/XP JSON</SelectItem>
            <SelectItem value="lurkr">Lurkr official JSON</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="file"
          aria-label="Import file"
          disabled={importBusy}
          accept={source === "csv" ? ".csv,.txt" : ".json"}
          onClick={(event) => { event.currentTarget.value = ""; }}
          onChange={(event) => void upload(event.target.files?.[0])}
        />

        <OperationStatus state={statusState}>{status}</OperationStatus>

        <Button asChild variant="outline" size="sm">
          <a href={`/api/guilds/${guildId}/data`}>Download PostgreSQL export</a>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={createBackup}>Create full Inochi backup</Button>

        <div className="grid gap-2">
          <span className={fieldLabel}>Restore full backup</span>
          <Input type="file" aria-label="Backup file" accept=".json" onChange={(event) => restoreBackup(event.target.files?.[0])} />
        </div>

        <Button type="button" variant="outline" size="sm" onClick={createApiKey}>Create read-only API key</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadAudit()}>Load recent audit history</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadKeys()}>Manage API keys</Button>

        {apiKey && (
          <Input readOnly value={apiKey} aria-label="New API key" className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        )}

        {audit.length > 0 && (
          <ul className="max-h-80 overflow-auto border border-border">
            {audit.map((event) => (
              <li key={event.id} className="border-b border-border px-3 py-2.5 last:border-b-0">
                <strong className="block text-sm font-medium">{event.action}</strong>
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  {event.actorId} / {new Date(event.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}

        {keys.length > 0 && (
          <ul className="max-h-80 overflow-auto border border-border">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-medium">{key.name}</strong>
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    Owner {key.userId} / expires {new Date(key.expiresAt).toLocaleDateString()}
                  </span>
                </span>
                <Button type="button" variant="destructive" size="sm" onClick={() => void revokeKey(key.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Radix handles the focus trap, scroll lock, Escape and aria wiring that
        the hand-rolled AccessibleDialog did manually. Both of these are
        destructive confirmations, so the typed keyword gate is unchanged.
      */}
      <Dialog open={Boolean(importPreview)} onOpenChange={(next) => { if (!next && !importBusy) setImportPreview(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review member changes</DialogTitle>
            <DialogDescription>
              No records have been applied yet. Matching members will have their XP replaced; all
              other members remain unchanged.
            </DialogDescription>
          </DialogHeader>
          {importPreview && (
            <>
              <dl className="grid grid-cols-2 border border-border">
                {[
                  ["Valid rows", importPreview.counts.found],
                  ["Members to apply", importPreview.counts.unique],
                  ["Duplicates ignored", importPreview.counts.duplicates],
                  ["Over limit ignored", importPreview.counts.truncated],
                ].map(([label, count], index) => (
                  <div key={label} className={`px-4 py-3 ${index % 2 === 0 ? "border-r border-border" : ""} ${index < 2 ? "border-b border-border" : ""}`}>
                    <dt className={fieldLabel}>{label}</dt>
                    <dd className="mt-1 font-mono text-base tnum">{Number(count).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <div className="grid gap-2">
                <label className={fieldLabel} htmlFor="import-confirmation">Type IMPORT to continue</label>
                <Input
                  id="import-confirmation"
                  value={importConfirmation}
                  onChange={(event) => setImportConfirmation(event.target.value)}
                  autoComplete="off"
                  disabled={importBusy}
                  className="font-mono"
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={importBusy} onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={importBusy || importConfirmation !== "IMPORT"} onClick={() => void applyImport()}>Apply XP import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(restore)} onOpenChange={(next) => { if (!next && !restoreBusy) setRestore(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review the recovery plan</DialogTitle>
            <DialogDescription>
              {restore && (
                <>
                  Backup from <strong>{new Date(restore.createdAt).toLocaleString()}</strong> with{" "}
                  <strong>{restore.members.toLocaleString()} members</strong>. A pre-restore snapshot
                  will be created automatically.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className={fieldLabel} htmlFor="restore-mode">Restore mode</label>
            <Select value={restoreMode} disabled={restoreBusy} onValueChange={(value) => setRestoreMode(value as typeof restoreMode)}>
              <SelectTrigger id="restore-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">Merge members and settings</SelectItem>
                <SelectItem value="settings">Settings only</SelectItem>
                <SelectItem value="replace">Replace all leveling data</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <label className={fieldLabel} htmlFor="restore-confirmation">Type RESTORE to continue</label>
            <Input
              id="restore-confirmation"
              value={confirmation}
              disabled={restoreBusy}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={restoreBusy} onClick={() => setRestore(null)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={restoreBusy || confirmation !== "RESTORE"} onClick={confirmRestore}>Restore backup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
