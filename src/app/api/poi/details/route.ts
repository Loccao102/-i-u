import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import {
  getGeoapifyPlaceDetails,
  isGeoapifyDetailsConfigured
} from "@/lib/server/geoapify-place-details";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { cleanPlainText } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const providerId = cleanPlainText(
      request.nextUrl.searchParams.get("providerId") ?? "",
      220
    );

    if (!providerId.startsWith("geoapify:")) {
      return profileJson(
        profile,
        {
          details: null,
          configured: isGeoapifyDetailsConfigured()
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const details = await getGeoapifyPlaceDetails(providerId);

    return profileJson(
      profile,
      {
        details,
        configured: isGeoapifyDetailsConfigured()
      },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tải chi tiết địa điểm lúc này."
    );
  }
}
