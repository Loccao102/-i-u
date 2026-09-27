import "server-only";

import type { NextRequest } from "next/server";

export function assertSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    throw new Error("CROSS_ORIGIN_MUTATION");
  }
}

export function assertSameOriginMutation(request: NextRequest) {
  assertSameOriginRequest(request);

  const contentType = request.headers.get("content-type") ?? "";
  if (
    request.method !== "DELETE" &&
    !contentType.toLowerCase().startsWith("application/json")
  ) {
    throw new Error("JSON_REQUIRED");
  }
}

export async function readJsonObject(request: NextRequest) {
  assertSameOriginMutation(request);

  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("INVALID_BODY");
  }

  return body as Record<string, unknown>;
}
