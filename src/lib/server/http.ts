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
