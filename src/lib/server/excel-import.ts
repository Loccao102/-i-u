import "server-only";

import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { parseCostAmount, priceLabelForCost } from "../cost-estimation";
import type { Place } from "../types";
import { cleanPlainText, suggestScenarios } from "../validation";
import { upsertPlace } from "./personal-repository";
import { getSupabaseAdmin } from "./supabase";

const MAX_ROWS = 20;

export type ExcelPlaceRow = {
  row: number;
  name: string;
  area: string;
  mapsUrl: string;
  note: string;
  cost: string;
};

export type GoogleExcelCandidate = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  mapsUrl: string;
  confidence: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  primaryType?: string;
};

function googleKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_PLACES_NOT_CONFIGURED");
  return key;
}

function safeCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number")
    return cleanPlainText(String(value), 500);
  if (typeof value === "object" && "text" in value)
    return cleanPlainText(String(value.text ?? ""), 500);
  // Formulas and formula results are not executed/trusted.
  return "";
}

function normal(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function relevantName(source: string, name: string) {
  const left = new Set(normal(source).split(" ").filter(Boolean));
  const right = new Set(normal(name).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap += 1;
  return overlap / Math.max(left.size, right.size);
}

function exactPlaceId(mapsUrl: string) {
  if (!mapsUrl || mapsUrl.length > 500) return null;
  try {
    const parsed = new URL(mapsUrl);
    if (!/(^|\.)google\.(com|com\.vn)$/.test(parsed.hostname) &&
        parsed.hostname !== "maps.app.goo.gl") return null;
    const queryId = parsed.searchParams.get("query_place_id") ||
      parsed.searchParams.get("place_id");
    if (queryId && /^[a-zA-Z0-9_-]{8,180}$/.test(queryId)) return queryId;
    const match = /!1s(ChIJ[a-zA-Z0-9_-]{8,180})/.exec(mapsUrl);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function candidate(raw: GooglePlace, sourceName: string): GoogleExcelCandidate | null {
  if (!raw.id || !/^[a-zA-Z0-9_-]{8,180}$/.test(raw.id)) return null;
  const name = cleanPlainText(raw.displayName?.text || "", 100);
  const latitude = raw.location?.latitude;
  const longitude = raw.location?.longitude;
  if (!name || typeof latitude !== "number" || typeof longitude !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return {
    id: raw.id,
    name,
    address: cleanPlainText(raw.formattedAddress || "", 250),
    latitude,
    longitude,
    mapsUrl: raw.googleMapsUri || "https://www.google.com/maps/search/?api=1&query_place_id=" + encodeURIComponent(raw.id),
    confidence: Math.round(relevantName(sourceName, name) * 100)
  };
}

async function googleFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Goog-Api-Key": googleKey(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.primaryType",
      ...(init?.headers ?? {})
    },
    signal: AbortSignal.timeout(9000),
    cache: "no-store"
  });
  if (!response.ok) {
    console.error("[di-dau] Google Places request failed", response.status);
    throw new Error(response.status === 429 ? "GOOGLE_PLACES_QUOTA" : "GOOGLE_PLACES_UNAVAILABLE");
  }
  return response.json() as Promise<{ places?: GooglePlace[] }>;
}

async function googleDetails(placeId: string): Promise<GooglePlace> {
  if (!/^[a-zA-Z0-9_-]{8,180}$/.test(placeId)) throw new Error("INVALID_GOOGLE_PLACE_ID");
  const response = await fetch(
    "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId),
    {
      headers: {
        "X-Goog-Api-Key": googleKey(),
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,googleMapsUri,primaryType"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(9000)
    }
  );
  if (!response.ok) throw new Error("GOOGLE_PLACE_NOT_FOUND");
  return response.json() as Promise<GooglePlace>;
}

export function excelImportConfigured() {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
}

export async function buildExcelTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("DiaDiem", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  sheet.columns = [
    { header: "TenDiaDiem", key: "name", width: 34 },
    { header: "KhuVucDiaChi", key: "area", width: 43 },
    { header: "LinkGoogleMaps", key: "url", width: 58 },
    { header: "GhiChu", key: "note", width: 44 },
    { header: "ChiPhi2Nguoi", key: "cost", width: 20 }
  ];
  sheet.addRow({
    name: "Hồ Gươm",
    area: "Hoàn Kiếm, Hà Nội",
    url: "",
    note: "Ví dụ minh họa — hãy xóa hoặc thay dòng này",
    cost: ""
  });
  sheet.addRow({
    name: "Văn Miếu - Quốc Tử Giám",
    area: "Đống Đa, Hà Nội",
    url: "",
    note: "Ví dụ: hẹn hò, dạo bộ",
    cost: "200000"
  });
  const head = sheet.getRow(1);
  head.height = 27;
  head.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 11 };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF295345" } };
  for (let i = 2; i <= 3; i++) {
    const row = sheet.getRow(i);
    row.height = 24;
    row.eachCell(cell => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 ? "FFF5FAF6" : "FFFFFFFF" } };
    });
  }
  sheet.autoFilter = "A1:E1";
  const instructions = workbook.addWorksheet("HuongDan");
  instructions.getColumn(1).width = 26;
  instructions.getColumn(2).width = 85;
  [
    ["ĐiĐâu – Import từ Excel", "Dòng mẫu trong DiaDiem chỉ để tham khảo, xóa trước khi dùng."],
    ["TenDiaDiem", "Bắt buộc. Điền tên trên Google Maps, ví dụ: Văn Miếu - Quốc Tử Giám."],
    ["KhuVucDiaChi", "Rất nên có để tránh nhầm quán trùng tên, ví dụ: Đống Đa, Hà Nội."],
    ["LinkGoogleMaps", "Không bắt buộc; chỉ hỗ trợ link Google Maps chuẩn. Link rút gọn có thể cần xác nhận bằng tên/địa chỉ."],
    ["GhiChu", "Không bắt buộc; nội dung do bạn tự viết."],
    ["ChiPhi2Nguoi", "Không bắt buộc; VND cho hai người, ví dụ 250000 hoặc 250k."],
    ["Giới hạn", "Mỗi lần kiểm tra tối đa 20 địa điểm. File dưới 1MB."],
    ["Xác thực", "ĐiĐâu tìm bằng Google Places. Bạn xem và chọn kết quả trước khi lưu."],
    ["Quyền truy cập", "Địa điểm chỉ lưu trong profile cá nhân theo cookie trình duyệt."],
    ["Chi phí API", "Google Places API cần key và bật billing trong Google Cloud."]
  ].forEach(row => instructions.addRow(row));
  instructions.getRow(1).font = { bold: true, color: { argb: "FF275442" }, size: 12 };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function readExcelPlaces(bytes: Buffer): Promise<ExcelPlaceRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new Error("INVALID_XLSX_FILE");
  }
  const sheet = workbook.getWorksheet("DiaDiem") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("INVALID_XLSX_TEMPLATE");
  const expected = ["tendiadiem", "khuvudiachi", "linkgooglemaps", "ghichu", "chiphi2nguoi"];
  const actual = expected.map((_, i) => normal(safeCell(sheet.getRow(1).getCell(i + 1).value)).replace(/\s/g, ""));
  if (expected.some((key, i) => key !== actual[i])) throw new Error("INVALID_XLSX_TEMPLATE");
  const result: ExcelPlaceRow[] = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const parts = [1,2,3,4,5].map(i => safeCell(row.getCell(i).value));
    if (parts.every(part => !part)) continue;
    if (!parts[0] || parts[0].length < 2 || parts[0].length > 100 || parts[1].length > 180 ||
        parts[2].length > 500 || parts[3].length > 300 || parts[4].length > 100) {
      throw new Error("INVALID_EXCEL_ROW_" + number);
    }
    result.push({
      row: number, name: parts[0], area: parts[1], mapsUrl: parts[2],
      note: parts[3], cost: parts[4]
    });
    if (result.length > MAX_ROWS) throw new Error("EXCEL_ROW_LIMIT");
  }
  if (!result.length) throw new Error("EMPTY_EXCEL_FILE");
  return result;
}

export async function searchExcelRow(row: ExcelPlaceRow) {
  const placeId = exactPlaceId(row.mapsUrl);
  let raw: GooglePlace[] = [];
  if (placeId) raw = [await googleDetails(placeId)];
  else {
    const response = await googleFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textQuery: [row.name, row.area].filter(Boolean).join(", "),
        languageCode: "vi",
        maxResultCount: 3
      })
    });
    raw = response.places ?? [];
  }
  return raw.map(place => candidate(place, row.name)).filter((x): x is GoogleExcelCandidate => x !== null);
}

export async function persistExcelRow(
  ownerKey: string, row: ExcelPlaceRow, selectedId: string
): Promise<{ duplicate: boolean; place: Place }> {
  const details = await googleDetails(selectedId);
  const resolved = candidate(details, row.name);
  if (!resolved) throw new Error("GOOGLE_PLACE_NOT_FOUND");
  const supabase = getSupabaseAdmin();
  const { data: existing, error } = await supabase
    .from("personal_places")
    .select("id")
    .eq("owner_key", ownerKey)
    .eq("google_place_id", resolved.id)
    .limit(1);
  if (error) throw new Error("DATABASE_LOOKUP_FAILED");
  if (existing?.length) {
    return { duplicate: true, place: { id: existing[0].id } as Place };
  }

  const cost = parseCostAmount(row.cost);
  const scenarios = suggestScenarios(row.note + " " + resolved.name);
  const place: Place = {
    id: randomUUID(),
    name: resolved.name,
    kind: "Địa điểm từ Google Maps",
    description: "",
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    distanceKm: 0,
    priceLabel: cost === null ? "$" : priceLabelForCost(cost),
    averageForTwo: cost === null ? "Chưa có dữ liệu" : String(cost),
    costSource: cost === null ? "unknown" : "user",
    costConfidence: cost === null ? 0 : 100,
    publicRating: 0,
    match: 75,
    communityNote: "Nhập Excel · Google Maps",
    openUntil: "Chưa rõ",
    bestTime: "Chưa có dữ liệu",
    noise: "Vừa", crowd: "Vừa",
    tags: scenarios, scenarios,
    note: cleanPlainText(row.note, 300),
    accent: "#487e63",
    source: "personal",
    googlePlaceId: resolved.id,
    address: resolved.address
  };
  await upsertPlace(ownerKey, place);
  return { duplicate: false, place };
}
