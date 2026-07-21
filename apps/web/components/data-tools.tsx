"use client";

import { useState } from "react";

export function DataTools({ guildId }: { guildId: string }) {
  const [source, setSource] = useState("legacy-polaris");
  const [status, setStatus] = useState("Choose an official export file.");
  const [apiKey, setApiKey] = useState("");
  const upload = async (file: File | undefined) => {
    if (!file) return;
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
    const selectedMode = window.prompt(`Backup from ${result.preview.createdAt} contains ${result.preview.members} members. Type REPLACE, MERGE, or SETTINGS.`)?.toLowerCase();
    if (!selectedMode || !["replace", "merge", "settings"].includes(selectedMode)) return setStatus("Restore cancelled");
    const confirmation = window.prompt(`Type RESTORE to confirm ${selectedMode.toUpperCase()} mode. A safety snapshot will be created first.`);
    if (confirmation !== "RESTORE") return setStatus("Restore cancelled");
    const restored = await fetch(`/api/guilds/${guildId}/backups/${result.snapshot.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: selectedMode, confirmation }) });
    const restoreResult = await restored.json();
    setStatus(restored.ok ? `Restored ${restoreResult.restored} members.` : restoreResult.error);
  };
  const createApiKey = async () => {
    const response = await fetch("/api/profile/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Inochi ${guildId}`, guildIds: [guildId], writeAccess: false }) });
    const result = await response.json();
    if (!response.ok) return setStatus(result.error);
    setApiKey(result.key);
    setStatus("Read-only API key created. It will only be shown here once.");
  };
  return <div className="field-row">
    <label className="field-label">File migration<small>Legacy Polaris JSON, Lurkr JSON, or ID/XP CSV. Matching members are replaced; others remain.</small></label>
    <div style={{ display: "grid", gap: ".5rem" }}>
      <select value={source} onChange={(event) => setSource(event.target.value)}><option value="legacy-polaris">Legacy Polaris JSON</option><option value="lurkr">Lurkr official JSON</option><option value="csv">CSV</option></select>
      <input type="file" accept={source === "csv" ? ".csv,.txt" : ".json"} onChange={(event) => upload(event.target.files?.[0])} />
      <span className="status">{status}</span>
      <a className="button" href={`/api/guilds/${guildId}/data`}>Download PostgreSQL export</a>
      <button type="button" onClick={createBackup}>Create full Inochi backup</button>
      <label className="field-label">Restore full backup<input type="file" accept=".json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></label>
      <button type="button" onClick={createApiKey}>Create read-only API key</button>
      {apiKey && <input readOnly value={apiKey} onFocus={(event) => event.currentTarget.select()} />}
    </div>
  </div>;
}
