"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker
} from "maplibre-gl";
import {
  CloseIcon,
  HeartIcon,
  HistoryIcon,
  LocationIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  StarIcon
} from "./icons";
import { places as seedPlaces, scenarioLabels } from "@/lib/places";
import { loadPersonalSnapshot, savePersonalSnapshot } from "@/lib/personal-store";
import { filterPlaces } from "@/lib/search";
import type {
  PersonalRating,
  Place,
  RatingDraft,
  Scenario,
  UserLocation,
  VisitRecord
} from "@/lib/types";
import {
  suggestScenarios,
  validateNewPlace
} from "@/lib/validation";

const defaultCenter: [number, number] = [105.8342, 21.0278];

const scenarios: Array<Scenario | "all"> = [
  "all",
  "date",
  "friends",
  "food",
  "coffee",
  "fun",
  "chill"
];

const scenarioEmoji: Record<Scenario, string> = {
  date: "♥",
  friends: "●●",
  food: "◉",
  coffee: "☕",
  fun: "◇",
  chill: "☾"
};

type PersonalView = "discover" | "saved" | "history";

function distanceLabel(value: number) {
  if (value < 1) return Math.round(value * 1000) + " m";
  return value.toFixed(value < 10 ? 1 : 0) + " km";
}

function priceText(price: Place["priceLabel"]) {
  return price === "$" ? "Tiết kiệm" : price === "$$" ? "Vừa phải" : "Cao";
}

function readableScenario(value: Scenario | "all") {
  return value === "all" ? "Tất cả" : scenarioLabels[value];
}

function formatVisitedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Không rõ";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function revisitLabel(value: RatingDraft["revisit"]) {
  if (value === "yes") return "Muốn quay lại";
  if (value === "maybe") return "Có thể quay lại";
  return "Không muốn quay lại";
}

export function MapExplorer() {
  const [customPlaces, setCustomPlaces] = useState<Place[]>([]);
  const [saved, setSaved] = useState(() => new Set<string>());
  const [ratings, setRatings] = useState<Record<string, PersonalRating>>({});
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [dataStatus, setDataStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [view, setView] = useState<PersonalView>("discover");
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<Scenario | "all">("all");
  const [selectedId, setSelectedId] = useState(seedPlaces[0]!.id);

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [mapReady, setMapReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ratingStars, setRatingStars] = useState(5);
  const [ratingRevisit, setRatingRevisit] =
    useState<RatingDraft["revisit"]>("yes");
  const [ratingContexts, setRatingContexts] = useState<Scenario[]>(["date"]);
  const [ratingNote, setRatingNote] = useState("");

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const ratingDialogRef = useRef<HTMLDialogElement | null>(null);

  const allPlaces = useMemo(() => {
    return [...customPlaces, ...seedPlaces].map((place) => {
      const personal = ratings[place.id];
      if (!personal) return place;

      return {
        ...place,
        personalRating: personal.stars,
        scenarios: Array.from(
          new Set([...place.scenarios, ...personal.contexts])
        ),
        note: personal.note || place.note
      };
    });
  }, [customPlaces, ratings]);

  const recentVisitByPlace = useMemo(() => {
    const result = new Map<string, VisitRecord>();
    const ordered = [...visits].sort((a, b) =>
      b.visitedAt.localeCompare(a.visitedAt)
    );

    for (const visit of ordered) {
      if (!result.has(visit.placeId)) result.set(visit.placeId, visit);
    }
    return result;
  }, [visits]);

  const visiblePlaces = useMemo(() => {
    const filtered = filterPlaces(
      allPlaces,
      query,
      scenario,
      userLocation
    );

    if (view === "saved") {
      return filtered.filter((place) => saved.has(place.id));
    }

    if (view === "history") {
      return filtered
        .filter((place) => recentVisitByPlace.has(place.id))
        .sort((a, b) => {
          const aVisit = recentVisitByPlace.get(a.id)?.visitedAt ?? "";
          const bVisit = recentVisitByPlace.get(b.id)?.visitedAt ?? "";
          return bVisit.localeCompare(aVisit);
        });
    }

    return filtered;
  }, [
    allPlaces,
    query,
    scenario,
    userLocation,
    view,
    saved,
    recentVisitByPlace
  ]);

  const selected =
    allPlaces.find((place) => place.id === selectedId) ??
    visiblePlaces[0] ??
    allPlaces[0]!;

  const selectedPersonalRating = ratings[selected.id] ?? null;
  const selectedVisit = recentVisitByPlace.get(selected.id) ?? null;

  useEffect(() => {
    let active = true;

    void loadPersonalSnapshot()
      .then((snapshot) => {
        if (!active) return;
        setCustomPlaces(snapshot.customPlaces);
        setSaved(new Set(snapshot.savedIds));
        setRatings(snapshot.ratings);
        setVisits(snapshot.visits);
        setDataStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setDataStatus("error");
        setNotice(
          "Không mở được bộ nhớ cục bộ. Bạn vẫn có thể dùng app trong phiên này."
        );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (dataStatus !== "ready") return;

    const timer = window.setTimeout(() => {
      void savePersonalSnapshot({
        version: 1,
        customPlaces,
        savedIds: [...saved],
        ratings,
        visits
      }).catch(() => {
        setNotice(
          "Không lưu được thay đổi trên thiết bị. Dữ liệu phiên hiện tại vẫn còn."
        );
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [customPlaces, saved, ratings, visits, dataStatus]);

  useEffect(() => {
    let active = true;

    void import("maplibre-gl").then((maplibre) => {
      if (!active || !mapNodeRef.current || mapRef.current) return;

      const map = new maplibre.Map({
        container: mapNodeRef.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
          "https://demotiles.maplibre.org/style.json",
        center: defaultCenter,
        zoom: 11.8,
        attributionControl: false
      });

      map.addControl(
        new maplibre.NavigationControl({
          showCompass: false,
          visualizePitch: false
        }),
        "bottom-right"
      );

      map.on("load", () => {
        if (active) setMapReady(true);
      });

      mapRef.current = map;
    });

    return () => {
      active = false;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    void import("maplibre-gl").then((maplibre) => {
      if (!mapRef.current) return;

      for (const place of visiblePlaces) {
        const element = document.createElement("button");
        element.type = "button";
        element.className =
          "map-marker" +
          (place.id === selectedId ? " map-marker--active" : "");
        element.setAttribute("aria-label", "Mở " + place.name);
        element.textContent = place.match + "%";
        element.style.setProperty("--marker-accent", place.accent);
        element.addEventListener("click", () => setSelectedId(place.id));

        const marker = new maplibre.Marker({
          element,
          anchor: "bottom"
        })
          .setLngLat([place.longitude, place.latitude])
          .addTo(mapRef.current);

        markerRefs.current.push(marker);
      }

      if (userLocation) {
        const userDot = document.createElement("div");
        userDot.className = "map-user-dot";
        userDot.setAttribute("aria-label", "Vị trí hiện tại");

        const userMarker = new maplibre.Marker({
          element: userDot
        })
          .setLngLat([userLocation.longitude, userLocation.latitude])
          .addTo(mapRef.current);

        markerRefs.current.push(userMarker);
      }
    });
  }, [mapReady, visiblePlaces, selectedId, userLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !selected) return;
    mapRef.current.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: 13,
      duration: 650,
      essential: true
    });
  }, [mapReady, selected]);

  useEffect(() => {
    if (
      visiblePlaces.length > 0 &&
      !visiblePlaces.some((place) => place.id === selectedId)
    ) {
      setSelectedId(visiblePlaces[0]!.id);
    }
  }, [visiblePlaces, selectedId]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setNotice("Trình duyệt này không hỗ trợ vị trí.");
      return;
    }

    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        setUserLocation(next);
        setLocationStatus("ready");
        mapRef.current?.flyTo({
          center: [next.longitude, next.latitude],
          zoom: 13,
          duration: 700
        });
        setNotice(
          "Vị trí chỉ dùng để tính khoảng cách trong phiên này và không được lưu."
        );
      },
      () => {
        setLocationStatus("denied");
        setNotice(
          "Không lấy được vị trí. Bạn vẫn có thể dùng bản đồ bình thường."
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  }

  function toggleSaved(placeId: string) {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  function switchView(next: PersonalView) {
    setView(next);
    setQuery("");
    setScenario("all");
  }

  function openRating() {
    const current = ratings[selected.id];
    setRatingStars(current?.stars ?? 5);
    setRatingRevisit(current?.revisit ?? "yes");
    setRatingContexts(
      current?.contexts.length ? current.contexts : selected.scenarios.slice(0, 2)
    );
    setRatingNote(current?.note ?? "");
    ratingDialogRef.current?.showModal();
  }

  function submitNewPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const center = mapRef.current?.getCenter();

    const validated = validateNewPlace({
      name: String(data.get("name") ?? ""),
      note: String(data.get("note") ?? ""),
      latitude: String(center?.lat ?? defaultCenter[1]),
      longitude: String(center?.lng ?? defaultCenter[0])
    });

    if (!validated.ok) {
      setNotice(validated.error);
      return;
    }

    const detectedScenarios = suggestScenarios(validated.value.note);
    const id = crypto.randomUUID();

    const newPlace: Place = {
      id,
      name: validated.value.name,
      kind: "Địa điểm của bạn",
      description:
        validated.value.note ||
        "Chưa có mô tả. Đi thử rồi thêm trải nghiệm của bạn.",
      latitude: validated.value.latitude,
      longitude: validated.value.longitude,
      distanceKm: 1,
      priceLabel: "$$",
      averageForTwo: "Chưa có dữ liệu",
      publicRating: 0,
      match: 80,
      communityNote: "Địa điểm cá nhân",
      openUntil: "Chưa rõ",
      bestTime: "Chưa có dữ liệu",
      noise: "Vừa",
      crowd: "Vừa",
      tags: detectedScenarios.map((item) => scenarioLabels[item]),
      scenarios: detectedScenarios,
      note: validated.value.note || "Chưa có ghi chú.",
      accent: "#ff6b5e"
    };

    setCustomPlaces((current) => [newPlace, ...current]);
    setSelectedId(id);
    setView("discover");
    addDialogRef.current?.close();
    event.currentTarget.reset();
    setNotice("Đã lưu địa điểm trên thiết bị này.");
  }

  function submitRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanedNote = ratingNote
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);

    const now = new Date().toISOString();

    const personalRating: PersonalRating = {
      placeId: selected.id,
      stars: ratingStars,
      revisit: ratingRevisit,
      contexts: ratingContexts,
      note: cleanedNote,
      visitedAt: now,
      updatedAt: now
    };

    const visit: VisitRecord = {
      id: crypto.randomUUID(),
      placeId: selected.id,
      visitedAt: now,
      ratingStars
    };

    setRatings((current) => ({
      ...current,
      [selected.id]: personalRating
    }));
    setVisits((current) => [visit, ...current].slice(0, 5000));

    ratingDialogRef.current?.close();
    setNotice("Đã lưu trải nghiệm của bạn trên thiết bị.");
  }

  function toggleRatingContext(context: Scenario) {
    setRatingContexts((current) =>
      current.includes(context)
        ? current.filter((item) => item !== context)
        : [...current, context]
    );
  }

  const heading =
    view === "saved"
      ? visiblePlaces.length + " địa điểm đã lưu"
      : view === "history"
        ? visiblePlaces.length + " nơi bạn đã đi"
        : visiblePlaces.length + " địa điểm phù hợp";

  const eyebrow =
    view === "saved"
      ? "Muốn quay lại sau"
      : view === "history"
        ? "Trải nghiệm của bạn"
        : "Gợi ý cho bạn";

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Điều hướng chính">
        <div className="rail-brand" aria-label="ĐiĐâu">
          <span className="rail-brand__mark"><PinIcon /></span>
          <strong>ĐiĐâu</strong>
        </div>

        <nav className="rail-nav">
          <button
            className={
              "rail-action" +
              (view === "discover" ? " rail-action--active" : "")
            }
            type="button"
            onClick={() => switchView("discover")}
          >
            <PinIcon />
            <span>Bản đồ</span>
          </button>

          <button
            className={
              "rail-action" +
              (view === "saved" ? " rail-action--active" : "")
            }
            type="button"
            onClick={() => switchView("saved")}
          >
            <HeartIcon />
            <span>Đã lưu</span>
          </button>

          <button
            className={
              "rail-action" +
              (view === "history" ? " rail-action--active" : "")
            }
            type="button"
            onClick={() => switchView("history")}
          >
            <HistoryIcon />
            <span>Lịch sử</span>
          </button>
        </nav>

        <button
          className="rail-add"
          type="button"
          onClick={() => addDialogRef.current?.showModal()}
        >
          <PlusIcon />
          <span>Thêm</span>
        </button>
      </aside>

      <header className="topbar">
        <div className="topbar-search">
          <SearchIcon />
          <input
            aria-label="Tìm địa điểm"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 120))}
            placeholder="Date yên tĩnh, cafe gần tôi, ăn tối…"
          />
          {query ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => setQuery("")}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        <div className="topbar-actions">
          <span
            className={
              "personal-mode-badge" +
              (dataStatus === "error"
                ? " personal-mode-badge--error"
                : "")
            }
          >
            <span className="privacy-dot" />
            {dataStatus === "loading"
              ? "Đang mở dữ liệu cá nhân…"
              : dataStatus === "error"
                ? "Chỉ dùng trong phiên"
                : "Cá nhân · lưu trên thiết bị"}
          </span>

          <button
            className={
              "location-button" +
              (locationStatus === "ready" ? " location-button--ready" : "")
            }
            type="button"
            onClick={requestLocation}
            disabled={locationStatus === "loading"}
          >
            <LocationIcon />
            <span>
              {locationStatus === "loading"
                ? "Đang lấy vị trí…"
                : locationStatus === "ready"
                  ? "Gần tôi"
                  : "Vị trí của tôi"}
            </span>
          </button>
        </div>
      </header>

      <section className="results-pane" aria-label="Kết quả tìm kiếm">
        <div className="scenario-row" aria-label="Hoàn cảnh">
          {scenarios.map((item) => (
            <button
              type="button"
              key={item}
              className={
                "scenario-chip" +
                (scenario === item ? " scenario-chip--active" : "")
              }
              onClick={() => setScenario(item)}
            >
              {item !== "all" ? <span>{scenarioEmoji[item]}</span> : null}
              {readableScenario(item)}
            </button>
          ))}
        </div>

        <div className="results-heading">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{heading}</h1>
          </div>
          <span className="sort-label">
            {view === "history" ? "Gần đây nhất" : "Phù hợp nhất"}
          </span>
        </div>

        <div className="place-list">
          {visiblePlaces.length === 0 ? (
            <div className="empty-state">
              <strong>
                {view === "saved"
                  ? "Bạn chưa lưu chỗ nào ở bộ lọc này."
                  : view === "history"
                    ? "Chưa có trải nghiệm nào."
                    : "Chưa có chỗ nào khớp."}
              </strong>
              <span>
                {view === "history"
                  ? "Đánh giá một địa điểm sau khi đi để bắt đầu lịch sử cá nhân."
                  : "Thử bớt từ khóa hoặc đổi hoàn cảnh."}
              </span>
            </div>
          ) : (
            visiblePlaces.map((place) => {
              const personal = ratings[place.id];
              const visit = recentVisitByPlace.get(place.id);

              return (
                <button
                  type="button"
                  key={place.id}
                  className={
                    "place-card" +
                    (selected.id === place.id
                      ? " place-card--active"
                      : "")
                  }
                  onClick={() => setSelectedId(place.id)}
                >
                  <span
                    className="place-thumb"
                    style={
                      {
                        "--place-accent": place.accent
                      } as CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {place.kind.includes("Activity")
                      ? "◇"
                      : place.kind.includes("Restaurant")
                        ? "◉"
                        : "☕"}
                  </span>

                  <span className="place-card__content">
                    <span className="place-card__top">
                      <strong>{place.name}</strong>
                      <small>{place.match}%</small>
                    </span>

                    <span className="place-card__meta">
                      <b>
                        ★{" "}
                        {personal
                          ? personal.stars.toFixed(1) + " của bạn"
                          : place.publicRating > 0
                            ? place.publicRating.toFixed(1)
                            : "Mới"}
                      </b>
                      <span>·</span>
                      <span>{distanceLabel(place.distanceKm)}</span>
                      <span>·</span>
                      <span>{place.priceLabel}</span>
                    </span>

                    <span className="tag-line">
                      {view === "history" && visit ? (
                        <i>Đã đi {formatVisitedAt(visit.visitedAt)}</i>
                      ) : null}
                      {place.tags.slice(0, 2).map((tag) => (
                        <i key={tag}>{tag}</i>
                      ))}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          className="wide-secondary"
          type="button"
          onClick={() => addDialogRef.current?.showModal()}
        >
          <PlusIcon />
          Thêm một địa điểm bạn biết
        </button>
      </section>

      <section className="map-pane" aria-label="Bản đồ">
        <div ref={mapNodeRef} className="map-canvas" />

        <div className="map-floating-top">
          <span>
            {view === "history"
              ? "Lịch sử cá nhân"
              : view === "saved"
                ? "Những nơi bạn đã lưu"
                : scenario === "all"
                  ? "Ưu tiên trải nghiệm của bạn"
                  : "Đang tìm cho: " + readableScenario(scenario)}
          </span>
          <button
            type="button"
            onClick={() => {
              const center = mapRef.current?.getCenter();
              if (center) {
                setNotice(
                  "Tâm bản đồ: " +
                    center.lat.toFixed(3) +
                    ", " +
                    center.lng.toFixed(3)
                );
              }
            }}
          >
            Khu vực này
          </button>
        </div>

        <div className="privacy-pill">
          <span className="privacy-dot" />
          {userLocation
            ? "Vị trí hiện tại không được lưu"
            : "Chưa dùng vị trí chính xác"}
        </div>
      </section>

      <aside className="detail-pane" aria-label="Chi tiết địa điểm">
        <div
          className="detail-hero"
          style={
            {
              "--place-accent": selected.accent
            } as CSSProperties
          }
        >
          <span className="detail-hero__icon" aria-hidden="true">
            {selected.kind.includes("Activity")
              ? "◇"
              : selected.kind.includes("Restaurant")
                ? "◉"
                : "☕"}
          </span>
          <div className="detail-hero__match">
            <strong>{selected.match}%</strong>
            <span>phù hợp</span>
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-title-row">
            <div>
              <span className="eyebrow">{selected.kind}</span>
              <h2>{selected.name}</h2>
            </div>

            <button
              className={
                "save-button" +
                (saved.has(selected.id)
                  ? " save-button--active"
                  : "")
              }
              type="button"
              onClick={() => toggleSaved(selected.id)}
              aria-label={
                saved.has(selected.id) ? "Bỏ lưu" : "Lưu địa điểm"
              }
            >
              <HeartIcon />
            </button>
          </div>

          <div className="detail-score-line">
            <span>
              <b>
                ★{" "}
                {selectedPersonalRating
                  ? selectedPersonalRating.stars.toFixed(1)
                  : selected.publicRating > 0
                    ? selected.publicRating.toFixed(1)
                    : "Mới"}
              </b>{" "}
              {selectedPersonalRating ? "của bạn" : "tham khảo"}
            </span>
            <span>·</span>
            <span>{distanceLabel(selected.distanceKm)}</span>
            <span>·</span>
            <span>{selected.priceLabel}</span>
            <span>·</span>
            <span>đến {selected.openUntil}</span>
          </div>

          <div className="tag-line tag-line--large">
            {selected.tags.map((tag) => <i key={tag}>{tag}</i>)}
          </div>

          <div className="primary-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const url =
                  "https://www.google.com/maps/dir/?api=1&destination=" +
                  encodeURIComponent(
                    selected.latitude + "," + selected.longitude
                  );
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              <LocationIcon />
              Chỉ đường
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={openRating}
            >
              <StarIcon />
              {selectedPersonalRating ? "Sửa đánh giá" : "Đã đi"}
            </button>
          </div>

          <section className="detail-section">
            <span className="eyebrow">Hợp với</span>
            <div className="context-grid">
              {selected.scenarios.slice(0, 4).map((item) => (
                <div key={item}>
                  <span>{scenarioEmoji[item]}</span>
                  <strong>{scenarioLabels[item]}</strong>
                  <b>
                    {selectedPersonalRating?.contexts.includes(item)
                      ? "Bạn chọn"
                      : "Phù hợp"}
                  </b>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <span className="eyebrow">Trải nghiệm của bạn</span>

            {selectedPersonalRating ? (
              <div className="personal-summary">
                <div>
                  <strong>★ {selectedPersonalRating.stars.toFixed(1)}</strong>
                  <span>
                    {revisitLabel(selectedPersonalRating.revisit)}
                  </span>
                </div>
                <div>
                  <strong>
                    {selectedVisit
                      ? formatVisitedAt(selectedVisit.visitedAt)
                      : formatVisitedAt(selectedPersonalRating.visitedAt)}
                  </strong>
                  <span>Lần gần nhất</span>
                </div>
                {selectedPersonalRating.note ? (
                  <blockquote>
                    “{selectedPersonalRating.note}”
                  </blockquote>
                ) : null}
              </div>
            ) : (
              <div className="personal-empty">
                <strong>Chưa có đánh giá cá nhân.</strong>
                <span>
                  Sau khi đi, một rating ngắn sẽ làm gợi ý sau này chính xác hơn.
                </span>
                <button type="button" onClick={openRating}>
                  Thêm trải nghiệm
                </button>
              </div>
            )}
          </section>

          <section className="detail-section">
            <span className="eyebrow">Cần biết</span>
            <dl className="fact-grid">
              <div>
                <dt>Giá tham khảo</dt>
                <dd>{selected.averageForTwo}</dd>
              </div>
              <div>
                <dt>Khoảng giá</dt>
                <dd>{priceText(selected.priceLabel)}</dd>
              </div>
              <div>
                <dt>Không gian</dt>
                <dd>{selected.noise}</dd>
              </div>
              <div>
                <dt>Đông đúc</dt>
                <dd>{selected.crowd}</dd>
              </div>
              <div>
                <dt>Đi đẹp nhất</dt>
                <dd>{selected.bestTime}</dd>
              </div>
              <div>
                <dt>Khoảng cách</dt>
                <dd>{distanceLabel(selected.distanceKm)}</dd>
              </div>
            </dl>

            <blockquote>“{selected.note}”</blockquote>
          </section>
        </div>
      </aside>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Đóng"
            className="icon-button"
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <dialog className="app-dialog" ref={addDialogRef}>
        <form className="dialog-card" onSubmit={submitNewPlace}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Địa điểm cá nhân</span>
              <h2>Thêm một chỗ</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => addDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Pin được đặt tại <strong>tâm bản đồ hiện tại</strong>. Chỉ cần
            tên và điều bạn biết; app tự gợi ý hoàn cảnh.
          </p>

          <label className="field">
            <span>Tên địa điểm</span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
              placeholder="Ví dụ: Hidden Garden"
            />
          </label>

          <label className="field">
            <span>Bạn biết gì về chỗ này?</span>
            <textarea
              name="note"
              maxLength={300}
              rows={4}
              placeholder="Cafe khá yên, đi tối đẹp, hợp date…"
            />
          </label>

          <div className="security-note">
            Dữ liệu này được lưu bằng IndexedDB trên chính thiết bị của bạn.
            Vị trí hiện tại của bạn không được lưu cùng dữ liệu.
          </div>

          <button
            className="primary-button primary-button--wide"
            type="submit"
          >
            <PlusIcon />
            Lưu địa điểm
          </button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={ratingDialogRef}>
        <form className="dialog-card" onSubmit={submitRating}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Trải nghiệm cá nhân</span>
              <h2>{selected.name}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => ratingDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <div
            className="rating-stars"
            aria-label={"Đánh giá " + ratingStars + " sao"}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={
                  ratingStars >= star
                    ? "rating-star rating-star--active"
                    : "rating-star"
                }
                onClick={() => setRatingStars(star)}
                aria-label={star + " sao"}
              >
                <StarIcon />
              </button>
            ))}
          </div>

          <fieldset className="dialog-fieldset">
            <legend>Hợp với</legend>
            <div className="scenario-row scenario-row--wrap">
              {(
                scenarios.filter(
                  (item): item is Scenario => item !== "all"
                )
              ).map((item) => (
                <button
                  type="button"
                  key={item}
                  className={
                    "scenario-chip" +
                    (ratingContexts.includes(item)
                      ? " scenario-chip--active"
                      : "")
                  }
                  onClick={() => toggleRatingContext(item)}
                >
                  {scenarioLabels[item]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="dialog-fieldset">
            <legend>Có quay lại không?</legend>
            <div className="segmented">
              {(
                [
                  ["yes", "Có"],
                  ["maybe", "Có thể"],
                  ["no", "Không"]
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={
                    ratingRevisit === value ? "is-active" : ""
                  }
                  onClick={() => setRatingRevisit(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>
              Một điều nên nhớ? <small>Tùy chọn</small>
            </span>
            <textarea
              value={ratingNote}
              onChange={(event) =>
                setRatingNote(event.target.value.slice(0, 240))
              }
              rows={3}
              placeholder="Đi tối đẹp hơn, cuối tuần hơi đông…"
            />
          </label>

          <div className="security-note">
            Rating và lịch sử được lưu cục bộ trên thiết bị. Chưa có tài
            khoản hoặc đồng bộ cloud ở giai đoạn này.
          </div>

          <button
            className="primary-button primary-button--wide"
            type="submit"
          >
            Lưu trải nghiệm
          </button>
        </form>
      </dialog>
    </main>
  );
}
