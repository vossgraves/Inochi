import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession } from "../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const expectedState = store.get("inochi_oauth_state")?.value;
  store.delete("inochi_oauth_state");
  if (!code || !state || state !== expectedState) return NextResponse.redirect(new URL("/?error=oauth_state", request.url));
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!, client_secret: process.env.DISCORD_CLIENT_SECRET!,
    grant_type: "authorization_code", code, redirect_uri: process.env.DISCORD_REDIRECT_URI!,
  });
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/?error=oauth_token", request.url));
  const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in: number };
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!userResponse.ok) return NextResponse.redirect(new URL("/?error=oauth_user", request.url));
  const user = await userResponse.json() as { id: string; username: string; global_name: string | null; avatar: string | null };
  await createSession({ userId: user.id, username: user.global_name ?? user.username, avatar: user.avatar, accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in });
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
