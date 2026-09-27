import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { scenarioLabels } from "@/lib/places";
import { getPublicItineraryShare } from "@/lib/server/itinerary-share";
import type { ActivePlanSnapshot } from "@/lib/types";

function moneyLabel(value: number) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return (
      millions.toLocaleString("vi-VN", {
        maximumFractionDigits: millions % 1 === 0 ? 0 : 1
      }) + " triệu"
    );
  }
  return Math.round(value / 1000) + "k";
}

function routingLabel(mode: ActivePlanSnapshot["routeMode"]) {
  if (mode === "walk") return "Đi bộ";
  if (mode === "drive") return "Ô tô";
  return "Xe máy";
}

function googleMapsRoute(plan: ActivePlanSnapshot) {
  const stops = plan.stops;
  if (stops.length === 0) return null;

  if (stops.length === 1) {
    const stop = stops[0]!;
    const params = new URLSearchParams({
      api: "1",
      query: stop.latitude + "," + stop.longitude
    });
    return "https://www.google.com/maps/search/?" + params.toString();
  }

  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const params = new URLSearchParams({
    api: "1",
    origin: first.latitude + "," + first.longitude,
    destination: last.latitude + "," + last.longitude,
    travelmode: plan.routeMode === "walk" ? "walking" : "driving"
  });

  if (stops.length > 2) {
    params.set(
      "waypoints",
      stops
        .slice(1, -1)
        .map((stop) => stop.latitude + "," + stop.longitude)
        .join("|")
    );
  }

  return "https://www.google.com/maps/dir/?" + params.toString();
}

type SharePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params
}: SharePageProps): Promise<Metadata> {
  const { slug } = await params;
  const share = await getPublicItineraryShare(slug);

  if (!share) {
    return {
      title: "Itinerary không còn khả dụng — ĐiĐâu",
      robots: { index: false, follow: false }
    };
  }

  const label = share.plan.scenario
    ? scenarioLabels[share.plan.scenario]
    : "Itinerary";

  return {
    title: label + " · " + share.plan.stops.length + " chặng — ĐiĐâu",
    description: share.plan.summary,
    robots: { index: false, follow: false }
  };
}

export default async function SharedItineraryPage({
  params
}: SharePageProps) {
  const { slug } = await params;
  const share = await getPublicItineraryShare(slug);

  if (!share) notFound();

  const routeUrl = googleMapsRoute(share.plan);
  const scenario = share.plan.scenario
    ? scenarioLabels[share.plan.scenario]
    : "Plan cá nhân";

  return (
    <main className="shared-itinerary-page">
      <header className="shared-itinerary-hero">
        <a className="shared-itinerary-brand" href="/">
          ĐiĐâu
        </a>
        <span className="eyebrow">Itinerary được chia sẻ</span>
        <h1>{scenario}</h1>
        <p>{share.plan.summary}</p>

        <div className="shared-itinerary-stats">
          <div>
            <span>Chi phí / 2 người</span>
            <strong>
              ~{moneyLabel(share.plan.totalEstimatedCostForTwo)}
            </strong>
          </div>
          <div>
            <span>Thời lượng</span>
            <strong>{share.plan.totalDurationMinutes} phút</strong>
          </div>
          <div>
            <span>Di chuyển</span>
            <strong>{routingLabel(share.plan.routeMode)}</strong>
          </div>
          <div>
            <span>Độ dài route</span>
            <strong>{share.plan.routeKm.toFixed(1)} km</strong>
          </div>
        </div>

        {routeUrl ? (
          <a
            className="shared-itinerary-route-button"
            href={routeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Mở toàn tuyến trên Google Maps ↗
          </a>
        ) : null}
      </header>

      <section className="shared-itinerary-timeline">
        <div className="shared-itinerary-section-head">
          <span className="eyebrow">Timeline</span>
          <strong>{share.plan.stops.length} chặng</strong>
        </div>

        {share.plan.stops.map((stop, index) => {
          const mapParams = new URLSearchParams({
            api: "1",
            query: stop.latitude + "," + stop.longitude
          });

          return (
            <article className="shared-itinerary-stop" key={stop.placeId}>
              <div className="shared-itinerary-stop__index">
                {index + 1}
              </div>
              <div className="shared-itinerary-stop__body">
                <div className="shared-itinerary-stop__top">
                  <div>
                    <span>{stop.stageLabel}</span>
                    <h2>{stop.name}</h2>
                  </div>
                  <strong>
                    {stop.startTime}–{stop.endTime}
                  </strong>
                </div>

                <p>{stop.reason || "Một chặng trong itinerary."}</p>

                <div className="shared-itinerary-stop__meta">
                  <span>~{moneyLabel(stop.estimatedCostForTwo)}</span>
                  {index > 0 ? (
                    <>
                      <span>· {stop.travelKmFromPrevious.toFixed(1)} km</span>
                      <span>
                        · ~{stop.travelMinutesFromPrevious} phút di chuyển
                      </span>
                    </>
                  ) : null}
                </div>

                <a
                  href={
                    "https://www.google.com/maps/search/?" +
                    mapParams.toString()
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Mở địa điểm ↗
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="shared-itinerary-footer">
        <p>
          Đây là snapshot read-only. Giá, giờ mở cửa và thời gian di chuyển
          có thể thay đổi; hãy kiểm tra lại trước khi đi.
        </p>
        <a href="/">Tạo itinerary của riêng bạn với ĐiĐâu →</a>
      </footer>
    </main>
  );
}
