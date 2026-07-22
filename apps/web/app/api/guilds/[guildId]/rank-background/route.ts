import { NextResponse } from "next/server";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { imageSize } from "image-size";
import { uploadBackground } from "@inochi/storage";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ guildId: string }> }) {
  if (!validMutationRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { guildId } = await context.params;
  const access = await requireGuildManager(guildId);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const image = (await request.formData()).get("image");
  if (!(image instanceof File) || !allowedTypes.has(image.type) || image.size > 5_000_000) {
    return NextResponse.json({ error: "Upload a PNG, JPEG, GIF, or WebP image under 5 MB" }, { status: 400 });
  }
  try {
    const bytes = Buffer.from(await image.arrayBuffer());
    const dimensions = imageSize(bytes);
    if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 16_000_000) return NextResponse.json({ error: "Image dimensions are too large" }, { status: 400 });
    const source = await loadImage(`data:${image.type};base64,${bytes.toString("base64")}`);
    const scale = Math.min(1, 1920 / source.width, 1080 / source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(source, 0, 0, width, height);
    const key = await uploadBackground(`guilds/${guildId}`, canvas.toBuffer("image/png"), "image/png");
    return NextResponse.json({ key });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Background upload failed" }, { status: 503 });
  }
}
