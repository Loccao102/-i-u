import type {
  EveningPlan,
  PlanQualityReport
} from "./types";

export function analyzePlanQuality(
  plan: EveningPlan
): PlanQualityReport {
  const stopCount = Math.max(1, plan.stops.length);
  const routingCoverage = plan.roadRoutedLegs / stopCount;
  const openingCoverage =
    (stopCount - plan.unknownOpeningHoursCount) / stopCount;
  const estimatedCostStops = plan.stops.filter(
    (stop) => stop.place.costSource === "provider_estimate"
  ).length;

  let score = 100;
  const issues: string[] = [];
  const strengths: string[] = [];

  if (!plan.complete) {
    const penalty = Math.min(30, plan.missingStages.length * 15);
    score -= penalty;
    issues.push(
      "Thiếu " + plan.missingStages.length + " chặng so với cấu trúc mong muốn"
    );
  } else {
    strengths.push("Đủ các chặng theo mood/thời lượng");
  }

  if (!plan.withinBudget) {
    score -= 20;
    issues.push("Phương án đang vượt budget");
  } else {
    strengths.push("Nằm trong budget");
  }

  if (!plan.withinDuration) {
    score -= 20;
    issues.push("Thời lượng vượt khung đã chọn");
  } else {
    strengths.push("Nằm trong khung thời lượng");
  }

  const unroutedRatio = 1 - routingCoverage;
  if (unroutedRatio > 0) {
    score -= Math.round(unroutedRatio * 15);
    issues.push(
      Math.round(routingCoverage * 100) +
        "% chặng có road routing, phần còn lại dùng heuristic"
    );
  } else {
    strengths.push("Toàn bộ chặng có road routing");
  }

  if (plan.unknownOpeningHoursCount > 0) {
    score -= Math.min(24, plan.unknownOpeningHoursCount * 8);
    issues.push(
      plan.unknownOpeningHoursCount +
        " chặng chưa xác minh đủ giờ mở cửa"
    );
  } else {
    strengths.push("Giờ mở cửa đã kiểm tra cho mọi chặng");
  }

  if (estimatedCostStops > 0) {
    score -= Math.min(9, estimatedCostStops * 3);
    issues.push(
      estimatedCostStops +
        " chặng vẫn dùng giá ước tính theo category"
    );
  } else {
    strengths.push("Không phụ thuộc giá provider estimate");
  }

  score = Math.max(20, Math.min(100, Math.round(score)));

  const level =
    score >= 85 ? "high" : score >= 65 ? "medium" : "low";
  const label =
    level === "high"
      ? "Độ tin cậy cao"
      : level === "medium"
        ? "Khá ổn, còn fallback"
        : "Nên kiểm tra trước khi đi";

  return {
    score,
    level,
    label,
    routingCoverage,
    openingCoverage,
    estimatedCostStops,
    issues: issues.slice(0, 4),
    strengths: strengths.slice(0, 4)
  };
}
