"use client";

import { useState } from "react";

export function DataTools({ guildId }: { guildId: string }) {
  const [source, setSource] = useState("legacy-polaris");
  const [status, setStatus] = useState("Choose an official export file.");
  const [apiKey, setApiKey] = useState("");
  const [restore, setRestore] = useState<{ snapshotId: string; createdAt: string; members: number } | null>(null);
  const [restoreMode, setRestoreMode] = useState<"settings" | "merge" | "replace">("merge");
  const [confirmation, setConfirmation] = useState("");
  const [audit, setAudit] = useState<{ id: string; actorId: string; action: string; createdAt: string }[]>([]);
  const [keys, setKeys] = useState<{ id: string; name: string; userId: string; expiresAt: string; lastUsedAt: string | null }[]>([]);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10_000_000) return setStatus("File is larger than 10 MB.");
    setStatus("Reading file...");
    const text = await file.text();
    let data: unknown = text;
    if (source !== "csv") {
      try { data = JSON.parse(text); } catch { setStatus("Invalid JSON file"); return; }
    }
    const response = await fetch(`/api/guilds/${guildId}/data`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, data }) });
    const result = await response.json();
    setStatus(response.ok ? `Imported ${result.imported} members.` : result.error);
  };
  const createBackup = async () => {
    setStatus("Creating full backup...");
    const response = await fetch(`/api/guilds/${guildId}/backups`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error);
    setStatus("Backup created. Download starting...");
    window.location.href = `/api/guilds/${guildId}/backups/${result.snapshot.id}`;
  };
  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    let payload: unknown;
    try { payload = JSON.parse(await file.text()); } catch { return setStatus("Invalid backup JSON"); }
    setStatus("Validating backup...");
    const created = await fetch(`/api/guilds/${guildId}/backups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
    const result = await created.json();
    if (!created.ok) return setStatus(result.error ?? "Backup validation failed");
    setRestore({ snapshotId: result.snapshot.id, createdAt: result.preview.createdAt, members: result.preview.members });
    setConfirmation("");
    setStatus("Backup validated. Review the restore plan.");
  };
  const confirmRestore = async () => {
    if (!restore || confirmation !== "RESTORE") return;
    setStatus("Restoring backup...");
    const restored = await fetch(`/api/guilds/${guildId}/backups/${restore.snapshotId}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: restoreMode, confirmation }) });
    const restoreResult = await restored.json();
    setStatus(restored.ok ? `Restored ${restoreResult.restored} members.` : restoreResult.error);
    if (restored.ok) setRestore(null);
  };
  const createApiKey = async () => {
    const response = await fetch("/api/profile/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Inochi ${guildId}`, guildIds: [guildId], writeAccess: false }) });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error);
    setApiKey(result.key);
    setStatus("Read-only API key created. It will only be shown here once.");
  };
  const loadAudit = async () => {
    const response = await fetch(`/api/guilds/${guildId}/audit`);
    const result = await response.json();
    if (!response.ok) return setStatus(result.error ?? "Could not load audit history");
    setAudit(result.events);
  };
  const loadKeys = async () => {
    const response = await fetch(`/api/profile/keys?guildId=${guildId}`);
    const result = await response.json();
    if (!response.ok) return setStatus(result.error ?? "Could not load API keys");
    setKeys(result.keys);
  };
  const revokeKey = async (id: string) => {
    const response = await fetch("/api/profile/keys", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) return setStatus("Could not revoke API key");
    setKeys((current) => current.filter((key) => key.id !== id));
  };
  return <div className="data-tools">
    <div className="field-label">File migration<small>Legacy Polaris JSON, Lurkr JSON, or ID/XP CSV. Matching members are replaced; others remain.</small></div>
    <div className="data-tool-controls">
      <select value={source} onChange={(event) => setSource(event.target.value)}><option value="legacy-polaris">Legacy Polaris JSON</option><option value="lurkr">Lurkr official JSON</option><option value="csv">CSV</option></select>
      <input type="file" accept={source === "csv" ? ".csv,.txt" : ".json"} onChange={(event) => upload(event.target.files?.[0])} />
      <span className="status">{status}</span>
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
    {restore && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><span className="eyebrow mono">Safety restore</span><h3 id="restore-title">Review the recovery plan</h3><p>Backup from <strong>{new Date(restore.createdAt).toLocaleString()}</strong> with <strong>{restore.members.toLocaleString()} members</strong>. A pre-restore snapshot will be created automatically.</p><label>Restore mode<select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value as typeof restoreMode)}><option value="merge">Merge members and settings</option><option value="settings">Settings only</option><option value="replace">Replace all leveling data</option></select></label><label>Type RESTORE to continue<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><div className="modal-actions"><button type="button" onClick={() => setRestore(null)}>Cancel</button><button type="button" className="danger-button" disabled={confirmation !== "RESTORE"} onClick={confirmRestore}>Restore backup</button></div></div></div>}
  </div>;
}
