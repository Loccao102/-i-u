import "server-only";

import { NextResponse } from "next/server";
import {
  attachProfileCookie,
  type AnonymousProfile
} from "./profile";

export function profileJson(
  profile: AnonymousProfile,
  data: unknown,
  init?: ResponseInit
) {
  return attachProfileCookie(
    NextResponse.json(data, init),
    profile
  );
}

export function errorJson(
  profile: AnonymousProfile,
  error: unknown,
  fallback: string
) {
  const code =
    error instanceof Error ? error.message : "UNKNOWN_ERROR";

  const known: Record<string, { status: number; message: string }> = {
    CROSS_ORIGIN_MUTATION: {
      status: 403,
      message: "Yêu cầu khác origin đã bị chặn."
    },
    JSON_REQUIRED: {
      status: 415,
      message: "Yêu cầu phải dùng JSON."
    },
    INVALID_BODY: {
      status: 400,
      message: "Dữ liệu gửi lên không hợp lệ."
    },
    POI_PROVIDER_UNAVAILABLE: {
      status: 503,
      message: "Nguồn tìm kiếm địa điểm đang tạm thời không khả dụng."
    },
    POI_DISCOVERY_AREA_TOO_LARGE: {
      status: 400,
      message: "Khu vực đang quá rộng. Hãy zoom gần hơn rồi tìm lại."
    },
    WEATHER_PROVIDER_UNAVAILABLE: {
      status: 503,
      message: "Nguồn thời tiết đang tạm thời không khả dụng."
    },
    UNSUPPORTED_IMAGE_TYPE: {
      status: 415,
      message: "Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc AVIF."
    },
    IMAGE_TOO_LARGE: {
      status: 413,
      message: "Ảnh phải nhỏ hơn hoặc bằng 8 MB."
    }
  };

  const mapped = known[code];
  return profileJson(
    profile,
    { error: mapped?.message ?? fallback },
    { status: mapped?.status ?? 400 }
  );
}


export function internalErrorJson(
  profile: AnonymousProfile,
  error: unknown,
  fallback: string
) {
  const raw =
    error instanceof Error ? error.message : String(error ?? "UNKNOWN_ERROR");

  // Log the real server-side failure for Vercel/Supabase diagnostics,
  // but never return raw database/env details to the browser.
  console.error("[di-dau][server]", raw);

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = fallback;

  if (raw.startsWith("Missing required server env:")) {
    status = 503;
    code = "SERVER_CONFIG_MISSING";
    message =
      "Thiếu cấu hình Supabase trên môi trường deploy. Kiểm tra Environment Variables trên Vercel.";
  } else if (raw.startsWith("Invalid server env:")) {
    status = 503;
    code = "SERVER_CONFIG_INVALID";
    message =
      "Supabase server key hoặc URL trên Vercel không hợp lệ. Không dùng publishable/anon key cho biến server.";
  } else if (
    /google_place_id|place_user_photos|active_personal_plans|daily_discoveries/i.test(raw) &&
    /column|relation|schema|does not exist|cache/i.test(raw)
  ) {
    status = 503;
    code = "DATABASE_SCHEMA_MISMATCH";
    message =
      "Supabase schema của môi trường deploy chưa đồng bộ migration mới.";
  } else if (
    /supabase|permission denied|row-level security|list places|list saved|list ratings|list visits|list collections|list daily discoveries|get active plan/i.test(
      raw
    )
  ) {
    status = 503;
    code = "DATABASE_UNAVAILABLE";
    message = "Không thể đọc dữ liệu Supabase lúc này.";
  }

  return profileJson(
    profile,
    { error: message, code },
    { status }
  );
}
