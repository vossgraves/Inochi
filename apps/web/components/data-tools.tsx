"use client";

import { useState } from "react";
import { OperationStatus, type OperationState } from "./operation-status";
import { AccessibleDialog } from "./accessible-dialog";

type ImportPreview = {
  file: File;
  source: string;
  token: string;
  counts: { found: number; unique: number; duplicates: number; truncated: number };
};

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
  return <div className="data-tools">
    <div className="field-label">File migration<small>Legacy ID/XP JSON, Lurkr JSON, or ID/XP CSV. Matching members are replaced; others remain.</small></div>
    <div className="data-tool-controls">
      <select value={source} disabled={importBusy} onChange={(event) => { setSource(event.target.value); setImportPreview(null); updateStatus("Choose an official export file.", "idle"); }}><option value="legacy-json">Legacy ID/XP JSON</option><option value="lurkr">Lurkr official JSON</option><option value="csv">CSV</option></select>
      <input type="file" disabled={importBusy} accept={source === "csv" ? ".csv,.txt" : ".json"} onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => void upload(event.target.files?.[0])} />
      <OperationStatus state={statusState}>{status}</OperationStatus>
      <a className="button" href={`/api/guilds/${guildId}/data`}>Download PostgreSQL export</a>
      <button type="button" onClick={createBackup}>Create full Inochi backup</button>
      <label className="field-label">Restore full backup<input type="file" accept=".json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></label>
      <button type="button" onClick={createApiKey}>Create read-only API key</button>
      <button type="button" onClick={() => void loadAudit()}>Load recent audit history</button>
      <button type="button" onClick={() => void loadKeys()}>Manage API keys</button>
      {apiKey && <input readOnly value={apiKey} onFocus={(event) => event.currentTarget.select()} />}
      {audit.length > 0 && <div className="audit-list">{audit.map((event) => <div key={event.id}><strong>{event.action}</strong><span><code>{event.actorId}</code> · {new Date(event.createdAt).toLocaleString()}</span></div>)}</div>}
      {keys.length > 0 && <div className="audit-list">{keys.map((key) => <div key={key.id}><strong>{key.name}</strong><span>Owner <code>{key.userId}</code> · expires {new Date(key.expiresAt).toLocaleDateString()}</span><button type="button" className="danger-button" onClick={() => void revokeKey(key.id)}>Revoke</button></div>)}</div>}
    </div>
    {importPreview && <AccessibleDialog titleId="import-title" descriptionId="import-description" busy={importBusy} onClose={() => setImportPreview(null)}><span className="eyebrow mono">Import preview</span><h3 id="import-title">Review member changes</h3><p id="import-description">No records have been applied yet. Matching members will have their XP replaced; all other members remain unchanged.</p><div className="import-counts"><div><span>Valid rows</span><strong>{importPreview.counts.found.toLocaleString()}</strong></div><div><span>Members to apply</span><strong>{importPreview.counts.unique.toLocaleString()}</strong></div><div><span>Duplicates ignored</span><strong>{importPreview.counts.duplicates.toLocaleString()}</strong></div><div><span>Over limit ignored</span><strong>{importPreview.counts.truncated.toLocaleString()}</strong></div></div><label>Type IMPORT to continue<input value={importConfirmation} onChange={(event) => setImportConfirmation(event.target.value)} autoComplete="off" disabled={importBusy} /></label><div className="modal-actions"><button type="button" disabled={importBusy} onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="danger-button" disabled={importBusy || importConfirmation !== "IMPORT"} onClick={() => void applyImport()}>Apply XP import</button></div></AccessibleDialog>}
    {restore && <AccessibleDialog titleId="restore-title" descriptionId="restore-description" busy={statusState === "pending"} onClose={() => setRestore(null)}><span className="eyebrow mono">Safety restore</span><h3 id="restore-title">Review the recovery plan</h3><p id="restore-description">Backup from <strong>{new Date(restore.createdAt).toLocaleString()}</strong> with <strong>{restore.members.toLocaleString()} members</strong>. A pre-restore snapshot will be created automatically.</p><label>Restore mode<select value={restoreMode} disabled={statusState === "pending"} onChange={(event) => setRestoreMode(event.target.value as typeof restoreMode)}><option value="merge">Merge members and settings</option><option value="settings">Settings only</option><option value="replace">Replace all leveling data</option></select></label><label>Type RESTORE to continue<input value={confirmation} disabled={statusState === "pending"} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><div className="modal-actions"><button type="button" disabled={statusState === "pending"} onClick={() => setRestore(null)}>Cancel</button><button type="button" className="danger-button" disabled={statusState === "pending" || confirmation !== "RESTORE"} onClick={confirmRestore}>Restore backup</button></div></AccessibleDialog>}
  </div>;
}
