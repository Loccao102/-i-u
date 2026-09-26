"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker
} from "maplibre-gl";
import {
  CloseIcon,
  HeartIcon,
  LocationIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  UsersIcon
} from "./icons";
import { places as seedPlaces, scenarioLabels } from "@/lib/places";
import { filterPlaces } from "@/lib/search";
import type {
  Place,
  RatingDraft,
  Scenario,
  UserLocation
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

export function MapExplorer() {
  const [allPlaces, setAllPlaces] = useState<Place[]>(seedPlaces);
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<Scenario | "all">("all");
  const [selectedId, setSelectedId] = useState(seedPlaces[0]!.id);
  const [saved, setSaved] = useState(() => new Set<string>(["lake-house"]));
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

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const ratingDialogRef = useRef<HTMLDialogElement | null>(null);

  const visiblePlaces = useMemo(
    () => filterPlaces(allPlaces, query, scenario, userLocation),
    [allPlaces, query, scenario, userLocation]
  );

  const selected =
    allPlaces.find((place) => place.id === selectedId) ??
    visiblePlaces[0] ??
    allPlaces[0]!;

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
          "map-marker" + (place.id === selectedId ? " map-marker--active" : "");
        element.setAttribute("aria-label", "Mở " + place.name);
        element.textContent = place.match + "%";
        element.style.setProperty("--marker-accent", place.accent);
        element.addEventListener("click", () => {
          setSelectedId(place.id);
        });

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
    if (visiblePlaces.length > 0 && !visiblePlaces.some((p) => p.id === selectedId)) {
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
        setNotice("Vị trí chỉ được giữ trong bộ nhớ của phiên này.");
      },
      () => {
        setLocationStatus("denied");
        setNotice("Không lấy được vị trí. Bạn vẫn có thể dùng bản đồ bình thường.");
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

  function openAddDialog() {
    addDialogRef.current?.showModal();
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
      kind: "Địa điểm do nhóm thêm",
      description:
        validated.value.note || "Chưa có mô tả. Hãy đi thử và để lại đánh giá.",
      latitude: validated.value.latitude,
      longitude: validated.value.longitude,
      distanceKm: userLocation ? 0 : 1,
      priceLabel: "$$",
      averageForTwo: "Chưa có dữ liệu",
      rating: 0,
      groupRating: 0,
      match: 80,
      revisit: "Chưa có đánh giá",
      openUntil: "Chưa rõ",
      bestTime: "Chưa có dữ liệu",
      noise: "Vừa",
      crowd: "Vừa",
      tags: detectedScenarios.map((item) => scenarioLabels[item]),
      scenarios: detectedScenarios,
      note: validated.value.note || "Chưa có tip từ nhóm.",
      accent: "#ff6b5e"
    };

    setAllPlaces((current) => [newPlace, ...current]);
    setSelectedId(id);
    addDialogRef.current?.close();
    event.currentTarget.reset();
    setNotice(
      "Đã thêm vào phiên hiện tại. Chưa lưu lên server cho tới khi có auth an toàn."
    );
  }

  function submitRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const note = String(data.get("ratingNote") ?? "")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 240);

    setAllPlaces((current) =>
      current.map((place) =>
        place.id !== selected.id
          ? place
          : {
              ...place,
              groupRating: ratingStars,
              rating: place.rating || ratingStars,
              scenarios: Array.from(
                new Set([...place.scenarios, ...ratingContexts])
              ),
              note: note || place.note,
              revisit:
                ratingRevisit === "yes"
                  ? "Bạn sẽ quay lại"
                  : ratingRevisit === "maybe"
                    ? "Bạn còn cân nhắc"
                    : "Bạn không muốn quay lại"
            }
      )
    );

    ratingDialogRef.current?.close();
    setNotice("Đánh giá đã được cập nhật trong phiên demo.");
  }

  function toggleRatingContext(context: Scenario) {
    setRatingContexts((current) =>
      current.includes(context)
        ? current.filter((item) => item !== context)
        : [...current, context]
    );
  }

  const groupRatingLabel =
    selected.groupRating > 0 ? selected.groupRating.toFixed(1) : "Mới";

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Điều hướng chính">
        <div className="rail-brand" aria-label="ĐiĐâu">
          <span className="rail-brand__mark"><PinIcon /></span>
          <strong>ĐiĐâu</strong>
        </div>

        <nav className="rail-nav">
          <button className="rail-action rail-action--active" type="button">
            <PinIcon />
            <span>Bản đồ</span>
          </button>
          <button className="rail-action" type="button" onClick={() => setNotice("Khám phá sẽ dùng cùng ranking, không thêm feed rối.")}>
            <SearchIcon />
            <span>Khám phá</span>
          </button>
          <button className="rail-action" type="button" onClick={() => setNotice(saved.size + " địa điểm đã lưu trong phiên này.")}>
            <HeartIcon />
            <span>Đã lưu</span>
          </button>
          <button className="rail-action" type="button" onClick={() => setNotice("Group Decision là slice tiếp theo sau auth + persistence.")}>
            <UsersIcon />
            <span>Nhóm</span>
          </button>
        </nav>

        <button className="rail-add" type="button" onClick={openAddDialog}>
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
            placeholder="Tìm địa điểm, hoặc hỏi: date yên tĩnh tối nay…"
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
          <div className="group-avatars" aria-label="Nhóm Weekend có 5 người">
            <span>L</span><span>M</span><span>K</span><b>+2</b>
          </div>
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
            <span className="eyebrow">Gợi ý cho bạn</span>
            <h1>{visiblePlaces.length} địa điểm phù hợp</h1>
          </div>
          <span className="sort-label">Phù hợp nhất</span>
        </div>

        <div className="place-list">
          {visiblePlaces.length === 0 ? (
            <div className="empty-state">
              <strong>Chưa có chỗ nào khớp.</strong>
              <span>Thử bớt từ khóa hoặc đổi hoàn cảnh.</span>
            </div>
          ) : (
            visiblePlaces.map((place) => (
              <button
                type="button"
                key={place.id}
                className={
                  "place-card" +
                  (selected.id === place.id ? " place-card--active" : "")
                }
                onClick={() => setSelectedId(place.id)}
              >
                <span
                  className="place-thumb"
                  style={{ "--place-accent": place.accent } as React.CSSProperties}
                  aria-hidden="true"
                >
                  {place.kind.includes("Activity") ? "◇" : place.kind.includes("Restaurant") ? "◉" : "☕"}
                </span>
                <span className="place-card__content">
                  <span className="place-card__top">
                    <strong>{place.name}</strong>
                    <small>{place.match}%</small>
                  </span>
                  <span className="place-card__meta">
                    <b>★ {place.groupRating || "Mới"}</b>
                    <span>·</span>
                    <span>{distanceLabel(place.distanceKm)}</span>
                    <span>·</span>
                    <span>{place.priceLabel}</span>
                  </span>
                  <span className="tag-line">
                    {place.tags.slice(0, 3).map((tag) => (
                      <i key={tag}>{tag}</i>
                    ))}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <button className="wide-secondary" type="button" onClick={openAddDialog}>
          <PlusIcon />
          Thêm một chỗ nhóm bạn biết
        </button>
      </section>

      <section className="map-pane" aria-label="Bản đồ">
        <div ref={mapNodeRef} className="map-canvas" />
        <div className="map-floating-top">
          <span>
            {scenario === "all"
              ? "Đang ưu tiên rating của nhóm"
              : "Đang tìm cho: " + readableScenario(scenario)}
          </span>
          <button type="button" onClick={() => {
            const center = mapRef.current?.getCenter();
            if (center) setNotice("Khu vực bản đồ: " + center.lat.toFixed(3) + ", " + center.lng.toFixed(3));
          }}>
            Tìm khu vực này
          </button>
        </div>
        <div className="privacy-pill">
          <span className="privacy-dot" />
          {userLocation
            ? "Vị trí chỉ dùng trong phiên"
            : "Không dùng vị trí cho tới khi bạn cho phép"}
        </div>
      </section>

      <aside className="detail-pane" aria-label="Chi tiết địa điểm">
        <div
          className="detail-hero"
          style={{ "--place-accent": selected.accent } as React.CSSProperties}
        >
          <span className="detail-hero__icon" aria-hidden="true">
            {selected.kind.includes("Activity") ? "◇" : selected.kind.includes("Restaurant") ? "◉" : "☕"}
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
                (saved.has(selected.id) ? " save-button--active" : "")
              }
              type="button"
              onClick={() => toggleSaved(selected.id)}
              aria-label={saved.has(selected.id) ? "Bỏ lưu" : "Lưu"}
            >
              <HeartIcon />
            </button>
          </div>

          <div className="detail-score-line">
            <span><b>★ {groupRatingLabel}</b> nhóm bạn</span>
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
                  encodeURIComponent(selected.latitude + "," + selected.longitude);
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              <LocationIcon />
              Chỉ đường
            </button>
            <button type="button" className="secondary-button" onClick={() => ratingDialogRef.current?.showModal()}>
              <StarIcon />
              Đánh giá
            </button>
          </div>

          <section className="detail-section">
            <span className="eyebrow">Vì sao hợp</span>
            <div className="context-grid">
              {selected.scenarios.slice(0, 4).map((item, index) => (
                <div key={item}>
                  <span>{scenarioEmoji[item]}</span>
                  <strong>{scenarioLabels[item]}</strong>
                  <b>{Math.max(3.6, selected.groupRating - index * 0.2).toFixed(1)}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <span className="eyebrow">Nhóm bạn nói gì</span>
            <div className="group-proof">
              <div className="avatar-stack"><span>L</span><span>M</span><span>K</span></div>
              <strong>{selected.revisit}</strong>
            </div>
            <blockquote>“{selected.note}”</blockquote>
          </section>

          <section className="detail-section">
            <span className="eyebrow">Cần biết</span>
            <dl className="fact-grid">
              <div><dt>Giá tham khảo</dt><dd>{selected.averageForTwo}</dd></div>
              <div><dt>Khoảng giá</dt><dd>{priceText(selected.priceLabel)}</dd></div>
              <div><dt>Không gian</dt><dd>{selected.noise}</dd></div>
              <div><dt>Đông đúc</dt><dd>{selected.crowd}</dd></div>
              <div><dt>Đi đẹp nhất</dt><dd>{selected.bestTime}</dd></div>
              <div><dt>Khoảng cách</dt><dd>{distanceLabel(selected.distanceKm)}</dd></div>
            </dl>
          </section>
        </div>
      </aside>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <dialog className="app-dialog" ref={addDialogRef}>
        <form method="dialog" className="dialog-card" onSubmit={submitNewPlace}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Địa điểm mới</span>
              <h2>Thêm một chỗ</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => addDialogRef.current?.close()} aria-label="Đóng">
              <CloseIcon />
            </button>
          </div>
          <p className="dialog-copy">
            Pin sẽ được đặt tại <strong>tâm bản đồ hiện tại</strong>. Chỉ cần tên và điều bạn biết; hệ thống tự gợi ý hoàn cảnh.
          </p>
          <label className="field">
            <span>Tên địa điểm</span>
            <input name="name" required minLength={2} maxLength={80} autoComplete="off" placeholder="Ví dụ: Hidden Garden" />
          </label>
          <label className="field">
            <span>Bạn biết gì về chỗ này?</span>
            <textarea name="note" maxLength={300} rows={4} placeholder="Cafe khá yên, đi tối đẹp, hợp date…" />
          </label>
          <div className="security-note">
            Không nhận HTML. Nội dung được giới hạn độ dài và xử lý dưới dạng text thuần.
          </div>
          <button className="primary-button primary-button--wide" type="submit">
            <PlusIcon />
            Thêm địa điểm
          </button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={ratingDialogRef}>
        <form method="dialog" className="dialog-card" onSubmit={submitRating}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">10 giây là đủ</span>
              <h2>Đánh giá {selected.name}</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => ratingDialogRef.current?.close()} aria-label="Đóng">
              <CloseIcon />
            </button>
          </div>

          <div className="rating-stars" aria-label={"Đánh giá " + ratingStars + " sao"}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={ratingStars >= star ? "rating-star rating-star--active" : "rating-star"}
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
              {(scenarios.filter((item) => item !== "all") as Scenario[]).map((item) => (
                <button
                  type="button"
                  key={item}
                  className={
                    "scenario-chip" +
                    (ratingContexts.includes(item) ? " scenario-chip--active" : "")
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
              {([
                ["yes", "Có"],
                ["maybe", "Có thể"],
                ["no", "Không"]
              ] as const).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={ratingRevisit === value ? "is-active" : ""}
                  onClick={() => setRatingRevisit(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Một điều nên biết? <small>Tùy chọn</small></span>
            <textarea name="ratingNote" maxLength={240} rows={3} placeholder="Đi tối đẹp hơn, cuối tuần hơi đông…" />
          </label>

          <button className="primary-button primary-button--wide" type="submit">
            Gửi đánh giá
          </button>
        </form>
      </dialog>
    </main>
  );
}
