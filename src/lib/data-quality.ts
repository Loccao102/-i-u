import type {
  CompletedPersonalPlan,
  Place
} from "./types";

export type DataQualityIssue = "opening_hours" | "cost";

export type DataRepairPrompt = {
  placeId: string;
  name: string;
  issues: DataQualityIssue[];
  planAppearances: number;
  recentAppearances: number;
  priority: number;
  recurring: boolean;
  reason: string;
};

export function dataQualityIssues(
  place: Pick<Place, "openUntil" | "averageForTwo" | "costSource">
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const opening = place.openUntil.trim().toLocaleLowerCase("vi-VN");

  if (
    !opening ||
    opening === "chưa rõ" ||
    opening === "chưa có dữ liệu" ||
    opening === "unknown"
  ) {
    issues.push("opening_hours");
  }

  if (
    place.averageForTwo === "Chưa có dữ liệu" ||
    place.costSource === "unknown" ||
    place.costSource === "provider_estimate"
  ) {
    issues.push("cost");
  }

  return issues;
}

export function deriveDataRepairPrompts(
  places: ReadonlyArray<Place>,
  savedIds: ReadonlySet<string>,
  completedPlans: ReadonlyArray<CompletedPersonalPlan>,
  nowMs = Date.now()
): DataRepairPrompt[] {
  const appearances = new Map<
    string,
    { total: number; recent: number }
  >();

  for (const completed of completedPlans.slice(0, 60)) {
    const completedAt = new Date(completed.completedAt).getTime();
    const recent =
      Number.isFinite(completedAt) &&
      nowMs - completedAt >= 0 &&
      nowMs - completedAt <= 90 * 24 * 60 * 60 * 1000;

    for (const stop of completed.plan.stops) {
      const current = appearances.get(stop.placeId) ?? {
        total: 0,
        recent: 0
      };
      current.total += 1;
      if (recent) current.recent += 1;
      appearances.set(stop.placeId, current);
    }
  }

  return places
    .filter((place) => savedIds.has(place.id))
    .flatMap((place) => {
      const issues = dataQualityIssues(place);
      if (issues.length === 0) return [];

      const usage = appearances.get(place.id) ?? {
        total: 0,
        recent: 0
      };
      const recurring = usage.total >= 2;
      const priority =
        issues.length * 4 +
        Math.min(4, usage.total) * 2 +
        Math.min(3, usage.recent) * 2 +
        (recurring ? 4 : 0);

      const reason = recurring
        ? "Đã xuất hiện trong " +
          usage.total +
          " plan nhưng dữ liệu vẫn chưa đủ chắc."
        : usage.total === 1
          ? "Đã từng nằm trong plan; bổ sung dữ liệu sẽ tăng độ tin cậy lần sau."
          : "Đã lưu nhưng còn dữ liệu quan trọng chưa xác minh.";

      return [{
        placeId: place.id,
        name: place.name,
        issues,
        planAppearances: usage.total,
        recentAppearances: usage.recent,
        priority,
        recurring,
        reason
      }];
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.recentAppearances - a.recentAppearances ||
        b.planAppearances - a.planAppearances ||
        a.name.localeCompare(b.name, "vi")
    );
}
