import { NextRequest, NextResponse } from "next/server";
import {
  createProfileTransferCode,
  redeemProfileTransferCode
} from "@/lib/server/profile-transfer";
import {
  attachProfileToken,
  resolveAnonymousProfile
} from "@/lib/server/profile";
import { errorJson, profileJson } from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    await readJsonObject(request);
    const transfer = await createProfileTransferCode({
      ownerKey: profile.ownerKey,
      profileToken: profile.token
    });
    return profileJson(profile, transfer);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tạo mã chuyển profile."
    );
  }
}

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const code = typeof body.code === "string" ? body.code : "";
    const token = await redeemProfileTransferCode(code);

    const response = NextResponse.json({ transferred: true });
    return attachProfileToken(response, token);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Mã chuyển profile không hợp lệ hoặc đã hết hạn."
    );
  }
}
