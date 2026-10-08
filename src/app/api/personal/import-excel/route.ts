import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginRequest, readJsonObject } from "@/lib/server/request-security";
import { profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import {
  buildExcelTemplate,
  excelImportConfigured,
  persistExcelRow,
  readExcelPlaces,
  searchExcelRow,
  type ExcelPlaceRow
} from "@/lib/server/excel-import";

export const runtime = "nodejs";
export const maxDuration = 60;

function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "INVALID_XLSX_FILE": return "File Excel không hợp lệ hoặc đã bị hỏng.";
    case "INVALID_XLSX_TEMPLATE": return "Sai mẫu Excel. Hãy tải mẫu ĐiĐâu và giữ nguyên tên cột.";
    case "EMPTY_EXCEL_FILE": return "File chưa có địa điểm.";
    case "EXCEL_ROW_LIMIT": return "Mỗi lần chỉ nhập tối đa 20 địa điểm.";
    case "GOOGLE_PLACES_QUOTA": return "Google Places vượt hạn mức. Vui lòng thử lại sau.";
    case "GOOGLE_PLACES_NOT_CONFIGURED": return "Chưa có GOOGLE_PLACES_API_KEY trên Vercel. Cần bật Places API (New) và billing.";
    case "GOOGLE_PLACE_NOT_FOUND": return "Google Maps không tìm thấy địa điểm này.";
    case "GOOGLE_PLACES_UNAVAILABLE": return "Không truy cập được Google Places. Kiểm tra key, Places API (New), billing và giới hạn key.";
    case "INVALID_BODY": return "Dữ liệu xác nhận không hợp lệ.";
    case "CROSS_ORIGIN_MUTATION": return "Yêu cầu không cùng nguồn đã bị chặn.";
    default:
      if (code.startsWith("INVALID_EXCEL_ROW_")) return "Dòng " + code.slice(18) + " không hợp lệ.";
      return "Không thể xử lý Excel lúc này.";
  }
}

export async function GET() {
  const bytes = await buildExcelTemplate();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="DiDau-Mau-Import-GoogleMaps.xlsx"',
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  try {
    assertSameOriginRequest(request);
    if (!excelImportConfigured()) throw new Error("GOOGLE_PLACES_NOT_CONFIGURED");
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("INVALID_BODY");
    const size = Number(request.headers.get("content-length") ?? "0");
    if (size > 1024 * 1024) throw new Error("EXCEL_FILE_TOO_LARGE");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 1024 * 1024 ||
      !/\.xlsx$/i.test(file.name)) throw new Error("INVALID_XLSX_FILE");
    const rows = await readExcelPlaces(Buffer.from(await file.arrayBuffer()));
    const results: Array<{
      row: ExcelPlaceRow;
      candidates: Awaited<ReturnType<typeof searchExcelRow>>;
      error: string | null;
    }> = [];
    // Four in-flight lookups at most to limit provider quota and request duration.
    for (let start = 0; start < rows.length; start += 4) {
      const chunk = await Promise.all(rows.slice(start, start + 4).map(async (row) => {
        try {
          return { row, candidates: await searchExcelRow(row), error: null };
        } catch (error) {
          return {
            row, candidates: [],
            error: message(error)
          };
        }
      }));
      results.push(...chunk);
    }
    return profileJson(profile, { results, configured: true }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return profileJson(profile,
      { error: error instanceof Error && error.message === "EXCEL_FILE_TOO_LARGE"
        ? "File tối đa 1 MB."
        : message(error) },
      { status: error instanceof Error && error.message === "GOOGLE_PLACES_NOT_CONFIGURED" ? 503 : 400 }
    );
  }
}

type ConfirmedRow = { row: ExcelPlaceRow; selectedId: string };

function validatedConfirmed(value: unknown): ConfirmedRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error("INVALID_BODY");
  const result: ConfirmedRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_BODY");
    const v = entry as Partial<ConfirmedRow>;
    if (typeof v.selectedId !== "string" || !/^[a-zA-Z0-9_-]{8,180}$/.test(v.selectedId) ||
      !v.row || typeof v.row !== "object" ||
      !Number.isInteger(v.row.row) || v.row.row < 2 ||
      typeof v.row.name !== "string" || !v.row.name.trim() ||
      v.row.name.length > 100 || typeof v.row.note !== "string" ||
      v.row.note.length > 300 || typeof v.row.cost !== "string" ||
      v.row.cost.length > 100 || typeof v.row.area !== "string" ||
      v.row.area.length > 180 || typeof v.row.mapsUrl !== "string" ||
      v.row.mapsUrl.length > 500) throw new Error("INVALID_BODY");
    result.push({ selectedId: v.selectedId, row: v.row });
  }
  return result;
}

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  try {
    if (!excelImportConfigured()) throw new Error("GOOGLE_PLACES_NOT_CONFIGURED");
    const body = await readJsonObject(request);
    const rows = validatedConfirmed(body.items);
    const result: Array<{ row: number; status: "added" | "duplicate" | "error"; name: string; error?: string }> = [];
    for (const { row, selectedId } of rows) {
      try {
        const imported = await persistExcelRow(profile.ownerKey, row, selectedId);
        result.push({
          row: row.row, name: row.name,
          status: imported.duplicate ? "duplicate" : "added"
        });
      } catch (error) {
        result.push({ row: row.row, name: row.name, status: "error", error: message(error) });
      }
    }
    return profileJson(profile, { results: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return profileJson(profile, { error: message(error) }, { status: 400 });
  }
}
