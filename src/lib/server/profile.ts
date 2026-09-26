import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "dd_profile";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type AnonymousProfile = {
  ownerKey: string;
  token: string;
  isNew: boolean;
};

export function resolveAnonymousProfile(
  request: NextRequest
): AnonymousProfile {
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  const isValid = Boolean(existing && TOKEN_PATTERN.test(existing));
  const token = isValid ? existing! : randomBytes(32).toString("hex");

  return {
    token,
    ownerKey: createHash("sha256").update(token).digest("hex"),
    isNew: !isValid
  };
}

export function attachProfileCookie(
  response: NextResponse,
  profile: AnonymousProfile
) {
  if (!profile.isNew) return response;

  response.cookies.set(COOKIE_NAME, profile.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });

  return response;
}
