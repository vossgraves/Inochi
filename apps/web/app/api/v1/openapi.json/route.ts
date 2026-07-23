import { openApiDocument } from "@inochi/api-contract/openapi";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(openApiDocument, { headers: { "cache-control": "public, max-age=300" } });
}
