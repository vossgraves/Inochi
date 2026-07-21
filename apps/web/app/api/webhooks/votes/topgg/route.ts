import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db, registerVote } from "@inochi/database";

function authorized(value: string | null) {
  const secret = process.env.TOPGG_WEBHOOK_SECRET;
  if (!secret || !value) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16_384) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as { user?: unknown; type?: string; isWeekend?: boolean } | null;
  const userId = String(body?.user ?? "");
  if (!/^\d{16,20}$/.test(userId)) return NextResponse.json({ error: "Invalid user" }, { status: 400 });
  await registerVote(db, { userId, durationHours: 168, test: body?.type === "test" });
  return NextResponse.json({ accepted: true });
}
