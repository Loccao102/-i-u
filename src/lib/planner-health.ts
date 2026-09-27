import type {
  PlannerHealthInsight,
  PlannerMetricsSummary
} from "./types";

export function derivePlannerHealth(
  metrics: PlannerMetricsSummary
): PlannerHealthInsight {
  const attempts =
    metrics.generated + metrics.generationFailed;
  const hasEnoughGenerationData =
    metrics.initialGenerated >= 6 &&
    metrics.activeDays >= 3;
  const hasEnoughStartData =
    metrics.started >= 4 &&
    metrics.activeDays >= 3;

  if (!hasEnoughGenerationData) {
    return {
      state: "collecting",
      confidence: "low",
      title: "Đang tích lũy tín hiệu planner",
      detail:
        "Cần ít nhất 6 lần tạo kế hoạch đầu tiên trên 3 ngày hoạt động trước khi kết luận có friction.",
      action:
        "Tiếp tục quan sát; chưa tự chỉnh ranking, budget hay bán kính từ sample nhỏ."
    };
  }

  if (
    metrics.startRate !== null &&
    metrics.startRate < 40
  ) {
    return {
      state: "pre_start_friction",
      confidence:
        metrics.initialGenerated >= 12 ? "high" : "medium",
      title: "Có friction trước khi bắt đầu plan",
      detail:
        metrics.startRate +
        "% plan đầu tiên được bắt đầu. Reroll đang ở " +
        (metrics.rerollRate ?? 0) +
        "% so với số phiên tạo ban đầu.",
      action:
        "Ưu tiên xem chất lượng phương án, độ lặp và dữ liệu mở cửa trước; chưa nên tự động nới budget/bán kính."
    };
  }

  if (
    hasEnoughStartData &&
    metrics.completionRate !== null &&
    metrics.completionRate < 55
  ) {
    return {
      state: "completion_friction",
      confidence:
        metrics.started >= 8 ? "high" : "medium",
      title: "Có friction sau khi bắt đầu",
      detail:
        metrics.completionRate +
        "% plan đã bắt đầu đi tới cuối; cancel rate hiện là " +
        (metrics.cancelRate ?? 0) +
        "%.",
      action:
        "Nên kiểm tra route quá dài, chặng cuối kém chất lượng hoặc khung thời lượng trước khi thay đổi ranking."
    };
  }

  if (
    hasEnoughStartData &&
    metrics.replayRate !== null &&
    metrics.replayRate >= 30 &&
    (metrics.completionRate ?? 0) >= 60
  ) {
    return {
      state: "replay_value",
      confidence:
        metrics.started >= 8 ? "high" : "medium",
      title: "Replay đang tạo giá trị thật",
      detail:
        metrics.replayRate +
        "% plan đã bắt đầu đến từ replay và completion vẫn đạt " +
        (metrics.completionRate ?? 0) +
        "%.",
      action:
        "Tiếp tục ưu tiên replay UX và lý do thay chặng; chưa cần tăng trọng số replay trong ranking."
    };
  }

  const generationSuccess =
    metrics.generationSuccessRate ??
    (attempts > 0
      ? Math.round((metrics.generated / attempts) * 100)
      : null);

  return {
    state: "healthy",
    confidence:
      metrics.initialGenerated >= 12 && metrics.started >= 6
        ? "high"
        : "medium",
    title: "Planner chưa có friction rõ ràng",
    detail:
      "Start " +
      (metrics.startRate ?? 0) +
      "% · completion " +
      (metrics.completionRate ?? 0) +
      "% · generation success " +
      (generationSuccess ?? 0) +
      "%.",
    action:
      "Giữ nguyên heuristic hiện tại và tiếp tục thu thập tín hiệu trước khi auto-tune."
  };
}
