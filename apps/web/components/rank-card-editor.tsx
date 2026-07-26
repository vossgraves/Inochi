"use client";

import { useEffect, useRef, useState } from "react";
import type { GuildSettings } from "@inochi/core";
import { OperationStatus, type OperationState } from "./operation-status";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type RankCardSettings = GuildSettings["rankCard"];

const fieldLabel = "font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase";

export function RankCardEditor({
  guildId,
  value,
  onChange,
}: {
  guildId: string;
  value: RankCardSettings;
  onChange: (value: RankCardSettings) => void;
}) {
  const [preview, setPreview] = useState<string>();
  const [previewState, setPreviewState] = useState<OperationState>("pending");
  const [uploadStatus, setUploadStatus] = useState("");
  const previewRef = useRef<string | undefined>(undefined);
  const signature = JSON.stringify(value);

  // Debounced live preview against the real renderer. Unchanged.
  useEffect(() => {
    const controller = new AbortController();
    setPreviewState("pending");
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/guilds/${guildId}/rank-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: signature,
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return setPreviewState("error");
      const objectUrl = URL.createObjectURL(await response.blob());
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = objectUrl;
      setPreview(objectUrl);
      setPreviewState("success");
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

  return (
    <div className="grid gap-5">
      <div
        className={cn(
          "relative grid min-h-40 place-items-center overflow-hidden border border-border bg-background",
          previewState === "pending" && "opacity-60",
        )}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Generated rank-card preview" className="block h-auto w-full" />
        )}
        {previewState === "pending" && (
          <div className="absolute inset-0 grid place-items-center">
            <OperationStatus state="pending">Rendering your rank card...</OperationStatus>
          </div>
        )}
        {previewState === "error" && (
          <OperationStatus state="error">Preview unavailable. Check the settings and try again.</OperationStatus>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-2 border border-border p-4">
          <span className={fieldLabel}>Accent and progress</span>
          <div className="grid grid-cols-[3rem_1fr] gap-2">
            <Input
              type="color"
              aria-label="Accent colour"
              value={value.accentColor}
              onChange={(event) => onChange({ ...value, accentColor: event.target.value })}
            />
            <Input
              key={value.accentColor}
              aria-label="Accent colour hex value"
              defaultValue={value.accentColor}
              pattern="#[0-9a-fA-F]{6}"
              className="font-mono"
              onBlur={(event) => {
                if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange({ ...value, accentColor: event.target.value });
                else event.target.value = value.accentColor;
              }}
            />
          </div>
        </div>

        <div className="grid content-start gap-2 border border-border p-4">
          <span className={fieldLabel}>Background image</span>
          <Input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <small aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
            {uploadStatus || (value.backgroundKey ? "Custom background selected" : "PNG, JPEG, GIF, or WebP under 5 MB")}
          </small>
          {value.backgroundKey && (
            <button
              type="button"
              className="justify-self-start text-xs text-primary-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onChange({ ...value, backgroundKey: null })}
            >
              Remove background
            </button>
          )}
        </div>

        <div className="grid content-start gap-3 border border-border p-4">
          <span className={fieldLabel}>
            Background darkness: <span className="tnum">{Math.round(value.backgroundOverlay * 100)}%</span>
          </span>
          <Slider
            aria-label="Background darkness"
            min={0}
            max={0.95}
            step={0.01}
            value={[value.backgroundOverlay]}
            onValueChange={([next]) => onChange({ ...value, backgroundOverlay: next ?? 0 })}
          />
        </div>

        <div className="grid content-start gap-2 border border-border p-4">
          <span className={fieldLabel}>Avatar shape</span>
          <Select
            value={value.avatarShape}
            onValueChange={(next) => onChange({ ...value, avatarShape: next as RankCardSettings["avatarShape"] })}
          >
            <SelectTrigger aria-label="Avatar shape"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rounded">Rounded</SelectItem>
              <SelectItem value="circle">Circle</SelectItem>
              <SelectItem value="square">Square</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid content-start gap-2 border border-border p-4">
          <span className={fieldLabel}>Card surface</span>
          <Select
            value={value.surface}
            onValueChange={(next) => onChange({ ...value, surface: next as RankCardSettings["surface"] })}
          >
            <SelectTrigger aria-label="Card surface"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="technical">Technical grid</SelectItem>
              <SelectItem value="clean">Clean</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid content-start gap-2 border border-border p-4">
          <span className={fieldLabel}>Progress style</span>
          <Select
            value={value.progressStyle}
            onValueChange={(next) => onChange({ ...value, progressStyle: next as RankCardSettings["progressStyle"] })}
          >
            <SelectTrigger aria-label="Progress style"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="glow">Glow</SelectItem>
              <SelectItem value="solid">Solid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
