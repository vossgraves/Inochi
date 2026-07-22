import { db, sql } from "@inochi/database";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const required = ["DATABASE_URL", "APP_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI", "SESSION_SECRET"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length || (process.env.SESSION_SECRET?.length ?? 0) < 32) {
    return NextResponse.json({ status: "unhealthy", reason: "configuration" }, { status: 503 });
  }

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unhealthy", reason: "database" }, { status: 503 });
  }
}
