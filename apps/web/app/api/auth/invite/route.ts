import { NextResponse } from "next/server";
import { buildDiscordInviteUrl } from "../../../../lib/discord";

export async function GET() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Discord OAuth is not configured" }, { status: 500 });
  return NextResponse.redirect(buildDiscordInviteUrl(clientId));
}
