import { NextResponse } from "next/server";
import { uploadBackground } from "@inochi/storage";
import { requireGuildManager, validMutationRequest } from "../../../../../lib/auth";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

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
    const key = await uploadBackground(`guilds/${guildId}`, new Uint8Array(await image.arrayBuffer()), image.type);
    return NextResponse.json({ key });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Background upload failed" }, { status: 503 });
  }
}
