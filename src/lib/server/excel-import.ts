import "server-only";

import ExcelJS from "exceljs";
import { parseCostAmount, priceLabelForCost } from "../cost-estimation";
import { placeFromPoiResult } from "../places";
import type { Place, PoiSearchResult } from "../types";
import { cleanPlainText } from "../validation";
import { importProviderPlace } from "./personal-repository";
import { searchPoi } from "./poi-provider";

const MAX_ROWS = 20;

export type ExcelPlaceRow = {
  row: number;
  name: string;
  area: string;
  mapsUrl: string;
  note: string;
  cost: string;
};

export type ExcelCandidate = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  mapsUrl: string;
  confidence: number;
  source: "geoapify" | "openstreetmap";
};

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

function candidateFromPoi(result: PoiSearchResult, name: string): ExcelCandidate {
  const coordinates = result.latitude + "," + result.longitude;
  return {
    id: result.providerId,
    name: result.name,
    address: result.address ?? result.displayName,
    latitude: result.latitude,
    longitude: result.longitude,
    // Google Maps is a reference link only. The result was found through
    // Geoapify/OpenStreetMap, not through paid Google Places verification.
    mapsUrl: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(coordinates),
    confidence: Math.round(relevantName(name, result.name) * 100),
    source: result.provider
  };
}

export function excelImportConfigured() {
  return Boolean(process.env.GEOAPIFY_API_KEY?.trim());
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
    ["LinkGoogleMaps", "Không bắt buộc, chỉ là đường dẫn tham khảo để tự kiểm tra; không dùng để lấy dữ liệu Google Places."],
    ["GhiChu", "Không bắt buộc; nội dung do bạn tự viết."],
    ["ChiPhi2Nguoi", "Không bắt buộc; VND cho hai người, ví dụ 250000 hoặc 250k."],
    ["Giới hạn", "Mỗi lần kiểm tra tối đa 20 địa điểm. File dưới 1MB."],
    ["Xác thực", "Địa điểm được đối chiếu Geoapify/OpenStreetMap. Hãy chọn kết quả trước khi lưu."],
    ["Quyền truy cập", "Địa điểm chỉ lưu trong profile cá nhân theo cookie trình duyệt."],
    ["Chi phí API", "Không cần Google Places key; Geoapify dùng hạn mức API hiện tại. Không thực hiện gọi Google Places trả phí."]
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

export async function searchExcelRow(row: ExcelPlaceRow): Promise<ExcelCandidate[]> {
  if (!excelImportConfigured()) throw new Error("GEOAPIFY_NOT_CONFIGURED");
  const textQuery = [row.name, row.area].filter(Boolean).join(", ");
  // Reuse the existing POI search backend and its 5-minute Geoapify cache.
  // This never uses paid Google Places, including for URLs pasted into Excel.
  const places = await searchPoi({ query: textQuery });
  return places
    .map(result => candidateFromPoi(result, row.name))
    .filter(item => item.confidence >= 15)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

export async function persistExcelRow(
  ownerKey: string, row: ExcelPlaceRow, selectedId: string
): Promise<{ duplicate: boolean; place: Place }> {
  // Never trust the Place ID submitted by the browser. Re-query the source
  // and confirm the selected candidate is in the current server-side results.
  const options = await searchExcelRow(row);
  const chosen = options.find(item => item.id === selectedId);
  if (!chosen) throw new Error("PLACE_NOT_IN_RESULTS");

  const original: PoiSearchResult = {
    provider: chosen.source,
    providerId: chosen.id,
    name: chosen.name,
    displayName: chosen.address || chosen.name,
    kind: "Địa điểm",
    latitude: chosen.latitude,
    longitude: chosen.longitude,
    scenarios: [],
    accent: "#487e63",
    address: chosen.address
  };
  const cost = parseCostAmount(row.cost);
  const place: Place = {
    ...placeFromPoiResult(original),
    id: crypto.randomUUID(),
    description: row.note,
    note: cleanPlainText(row.note, 300),
    averageForTwo: cost === null ? "Chưa có dữ liệu" : String(cost),
    priceLabel: cost === null ? "$" : priceLabelForCost(cost),
    costSource: cost === null ? "unknown" : "user",
    costConfidence: cost === null ? 0 : 100,
    communityNote: chosen.source === "geoapify"
      ? "Nhập Excel · Geoapify" : "Nhập Excel · OpenStreetMap"
  };
  return importProviderPlace(ownerKey, place);
}
