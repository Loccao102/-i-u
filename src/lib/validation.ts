import type { Scenario } from "./types";

export type NewPlaceInput = {
  name: string;
  note: string;
  latitude: string;
  longitude: string;
};

export function cleanPlainText(value: string, maxLength: number) {
  return value
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function validateNewPlace(input: NewPlaceInput) {
  const name = cleanPlainText(input.name, 80);
  const note = cleanPlainText(input.note, 300);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);

  if (name.length < 2) {
    return { ok: false as const, error: "Tên địa điểm quá ngắn." };
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false as const, error: "Vĩ độ không hợp lệ." };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false as const, error: "Kinh độ không hợp lệ." };
  }

  return {
    ok: true as const,
    value: { name, note, latitude, longitude }
  };
}

export function suggestScenarios(note: string): Scenario[] {
  const normalized = note.toLocaleLowerCase("vi-VN");
  const result = new Set<Scenario>();

  if (/date|hẹn|lãng mạn|view|riêng/.test(normalized)) result.add("date");
  if (/bạn|nhóm|đông người/.test(normalized)) result.add("friends");
  if (/ăn|đồ ăn|dinner|food/.test(normalized)) result.add("food");
  if (/cafe|coffee|cà phê/.test(normalized)) result.add("coffee");
  if (/chơi|game|bowling|activity/.test(normalized)) result.add("fun");
  if (/chill|yên|nói chuyện|thư giãn/.test(normalized)) result.add("chill");

  return result.size > 0 ? [...result] : ["chill"];
}
