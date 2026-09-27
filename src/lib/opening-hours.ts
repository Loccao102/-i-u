export type OpeningState = "open" | "closed" | "unknown";

export type OpeningStatus = {
  state: OpeningState;
  label: string;
  detail: string | null;
};

const dayIndex: Record<string, number> = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6
};

function parseClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59 ||
    (hour === 24 && minute !== 0)
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function expandDays(value: string) {
  const days = new Set<number>();
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const part of parts) {
    const range = /^([A-Z][a-z])-([A-Z][a-z])$/.exec(part);
    if (range) {
      const start = dayIndex[range[1]!];
      const end = dayIndex[range[2]!];
      if (start === undefined || end === undefined) return null;

      let cursor = start;
      days.add(cursor);
      while (cursor !== end) {
        cursor = (cursor + 1) % 7;
        days.add(cursor);
        if (days.size > 7) break;
      }
      continue;
    }

    const day = dayIndex[part];
    if (day === undefined) return null;
    days.add(day);
  }

  return days;
}

function clauseDays(raw: string) {
  const match = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(.+)$/.exec(
    raw.trim()
  );

  if (!match) {
    return {
      days: new Set([0, 1, 2, 3, 4, 5, 6]),
      rest: raw.trim()
    };
  }

  const days = expandDays(match[1]!);
  if (!days) return null;

  return {
    days,
    rest: match[2]!.trim()
  };
}

function isRangeOpen(
  days: ReadonlySet<number>,
  start: number,
  end: number,
  nowDay: number,
  nowMinute: number
) {
  if (start === end) return false;

  if (end > start) {
    return days.has(nowDay) && nowMinute >= start && nowMinute < end;
  }

  const previousDay = (nowDay + 6) % 7;
  return (
    (days.has(nowDay) && nowMinute >= start) ||
    (days.has(previousDay) && nowMinute < end)
  );
}

function formatMinute(value: number) {
  const normalized = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

export function openingStatus(
  raw: string | null | undefined,
  now = new Date()
): OpeningStatus {
  const value = raw?.trim();
  if (!value || value === "Chưa rõ") {
    return {
      state: "unknown",
      label: "Giờ mở cửa chưa rõ",
      detail: null
    };
  }

  if (/^24\/7$/i.test(value)) {
    return {
      state: "open",
      label: "Mở 24/7",
      detail: "Theo OpenStreetMap"
    };
  }

  const nowDay = now.getDay();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  let parsedAny = false;
  let relevantOff = false;

  for (const rawClause of value.split(";")) {
    const clause = clauseDays(rawClause);
    if (!clause) continue;

    if (/^off$/i.test(clause.rest)) {
      parsedAny = true;
      if (clause.days.has(nowDay)) relevantOff = true;
      continue;
    }

    const ranges = clause.rest
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const range of ranges) {
      const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(range);
      if (!match) continue;

      const start = parseClock(match[1]!);
      const end = parseClock(match[2]!);
      if (start === null || end === null) continue;

      parsedAny = true;
      if (isRangeOpen(clause.days, start, end, nowDay, nowMinute)) {
        return {
          state: "open",
          label: "Đang mở",
          detail: "Đến " + formatMinute(end)
        };
      }
    }
  }

  if (parsedAny) {
    return {
      state: "closed",
      label: relevantOff ? "Hôm nay đóng cửa" : "Đang đóng",
      detail: value
    };
  }

  return {
    state: "unknown",
    label: "Có giờ mở cửa",
    detail: value
  };
}
