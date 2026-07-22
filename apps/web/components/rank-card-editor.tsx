"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GuildSettings } from "@inochi/core";

type RankCardSettings = GuildSettings["rankCard"];

export function RankCardEditor({ guildId, value, onChange }: { guildId: string; value: RankCardSettings; onChange: (value: RankCardSettings) => void }) {
  const [preview, setPreview] = useState<string>();
  const [uploadStatus, setUploadStatus] = useState("");
  const previewRef = useRef<string | undefined>(undefined);
  const signature = JSON.stringify(value);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/guilds/${guildId}/rank-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: signature,
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const objectUrl = URL.createObjectURL(await response.blob());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = objectUrl;
      setPreview(objectUrl);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guildId, signature]);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadStatus("Uploading...");
    const body = new FormData();
    body.set("image", file);
    const response = await fetch(`/api/guilds/${guildId}/rank-background`, { method: "POST", body }).catch(() => null);
    const result = await response?.json().catch(() => null) as { key?: string; error?: string } | null;
    if (!response?.ok || !result?.key) return setUploadStatus(result?.error ?? "Upload failed");
    onChange({ ...value, backgroundKey: result.key });
    setUploadStatus("Background ready to save");
  };

  return <div className="rank-editor">
    <div className="rank-rendered-preview">{preview ? <img src={preview} alt="Generated rank-card preview" /> : <div className="status">Generating preview...</div>}</div>
    <div className="rank-editor-grid">
      <label><span>Accent and progress</span><div className="color-control"><input type="color" value={value.accentColor} onChange={(event) => onChange({ ...value, accentColor: event.target.value })} /><input key={value.accentColor} defaultValue={value.accentColor} pattern="#[0-9a-fA-F]{6}" onBlur={(event) => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange({ ...value, accentColor: event.target.value }); else event.target.value = value.accentColor; }} /></div></label>
      <label><span>Background image</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => void upload(event.target.files?.[0])} /><small>{uploadStatus || (value.backgroundKey ? "Custom background selected" : "PNG, JPEG, GIF, or WebP under 5 MB")}</small>{value.backgroundKey && <button className="text-button" type="button" onClick={() => onChange({ ...value, backgroundKey: null })}>Remove background</button>}</label>
      <label><span>Background darkness: {Math.round(value.backgroundOverlay * 100)}%</span><input type="range" min="0" max="0.95" step="0.01" value={value.backgroundOverlay} style={{ "--range-progress": `${value.backgroundOverlay / 0.95 * 100}%` } as CSSProperties} onChange={(event) => onChange({ ...value, backgroundOverlay: Number(event.target.value) })} /></label>
      <label><span>Avatar shape</span><select value={value.avatarShape} onChange={(event) => onChange({ ...value, avatarShape: event.target.value as RankCardSettings["avatarShape"] })}><option value="rounded">Rounded</option><option value="circle">Circle</option><option value="square">Square</option></select></label>
      <label><span>Card surface</span><select value={value.surface} onChange={(event) => onChange({ ...value, surface: event.target.value as RankCardSettings["surface"] })}><option value="technical">Technical grid</option><option value="clean">Clean</option></select></label>
      <label><span>Progress style</span><select value={value.progressStyle} onChange={(event) => onChange({ ...value, progressStyle: event.target.value as RankCardSettings["progressStyle"] })}><option value="glow">Glow</option><option value="solid">Solid</option></select></label>
    </div>
  </div>;
}
