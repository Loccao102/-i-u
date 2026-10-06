"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deriveGroupPollOutcome,
  isGroupPollOpen
} from "@/lib/group-poll";
import { buildGroupPollPlannerHref } from "@/lib/group-poll-handoff";
import { personalApi } from "@/lib/personal-api";
import type { GroupPoll } from "@/lib/types";

type GroupPollClientProps = {
  slug: string;
};

function formatExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Không rõ";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function ratingLabel(value: number) {
  return value > 0 ? "★ " + value.toFixed(1) : "Chưa có rating";
}

export function GroupPollClient({ slug }: GroupPollClientProps) {
  const [poll, setPoll] = useState<GroupPoll | null>(null);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [managing, setManaging] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const mutationVersionRef = useRef(0);

  useEffect(() => {
    let active = true;

    void personalApi.groupPoll
      .get(slug)
      .then(({ poll: next }) => {
        if (!active) return;
        setPoll(next);
        setClockMs(Date.now());
        setError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Không thể tải phiên bình chọn."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!poll) return;

    setClockMs(Date.now());

    const expiresAt = new Date(poll.expiresAt).getTime();
    if (
      poll.closedAt !== null ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setClockMs(Date.now());
    }, Math.max(0, expiresAt - Date.now() + 25));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [poll?.closedAt, poll?.expiresAt]);

  const pollIsOpen =
    poll !== null &&
    poll.isOpen &&
    isGroupPollOpen(
      {
        closedAt: poll.closedAt,
        expiresAt: poll.expiresAt
      },
      clockMs
    );

  useEffect(() => {
    if (!pollIsOpen) return;

    let active = true;

    async function refreshPoll() {
      if (document.visibilityState !== "visible") return;

      const version = mutationVersionRef.current;
      try {
        const result = await personalApi.groupPoll.get(slug);
        if (!active || version !== mutationVersionRef.current) return;
        setPoll(result.poll);
        setClockMs(Date.now());
      } catch {
        // Background refresh is best-effort; keep the last known poll visible.
      }
    }

    const intervalId = window.setInterval(() => {
      void refreshPoll();
    }, 10_000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshPoll();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [pollIsOpen, slug]);

  const outcome = useMemo(
    () =>
      poll
        ? deriveGroupPollOutcome(poll.candidates)
        : {
            state: "no_votes" as const,
            leaderVotes: 0,
            leaders: []
          },
    [poll]
  );
  const { leaderVotes, leaders } = outcome;

  async function vote(placeId: string) {
    if (!pollIsOpen || votingId) return;

    mutationVersionRef.current += 1;
    setVotingId(placeId);
    setError(null);
    try {
      const result = await personalApi.groupPoll.vote(slug, placeId);
      setPoll(result.poll);
      setClockMs(Date.now());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể ghi nhận lựa chọn."
      );
    } finally {
      setVotingId(null);
    }
  }

  async function setPollOpen(open: boolean) {
    if (!poll?.isOwner || managing) return;

    mutationVersionRef.current += 1;
    setManaging(true);
    setError(null);
    try {
      const result = await personalApi.groupPoll.setOpen(slug, open);
      setPoll(result.poll);
      setClockMs(Date.now());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể cập nhật trạng thái poll."
      );
    } finally {
      setManaging(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (loading) {
    return (
      <main className="group-poll-page group-poll-page--center">
        <div className="group-poll-loading">Đang mở phiên bình chọn…</div>
      </main>
    );
  }

  if (!poll) {
    return (
      <main className="group-poll-page group-poll-page--center">
        <section className="group-poll-empty">
          <a href="/" className="group-poll-brand">ĐiĐâu</a>
          <h1>Không mở được poll</h1>
          <p>{error ?? "Link có thể đã sai hoặc phiên bình chọn không tồn tại."}</p>
          <a href="/" className="group-poll-home-link">Về ĐiĐâu →</a>
        </section>
      </main>
    );
  }

  return (
    <main className="group-poll-page">
      <header className="group-poll-hero">
        <div className="group-poll-hero__top">
          <a href="/" className="group-poll-brand">ĐiĐâu</a>
          <div className="group-poll-hero__actions">
            {poll.isOwner ? (
              <button
                type="button"
                disabled={managing}
                onClick={() => void setPollOpen(!pollIsOpen)}
              >
                {managing
                  ? "Đang cập nhật…"
                  : pollIsOpen
                    ? "Đóng poll"
                    : "Mở lại 24h"}
              </button>
            ) : null}
            <button type="button" onClick={() => void copyLink()}>
              {copied ? "Đã copy" : "Copy link"}
            </button>
          </div>
        </div>
        <span className="eyebrow">Vote nhóm · không cần tài khoản</span>
        <h1>{poll.title}</h1>
        <p>
          Mỗi trình duyệt có một lựa chọn. Bạn có thể đổi ý bất kỳ lúc nào
          trước khi poll đóng.
        </p>
        <div className="group-poll-meta">
          <span>{poll.totalVotes} lượt vote</span>
          <span>Hết hạn {formatExpiry(poll.expiresAt)}</span>
          <span>{pollIsOpen ? "Đang mở" : "Đã đóng"}</span>
          {poll.isOwner ? <span>Bạn là người tạo poll</span> : null}
        </div>
      </header>

      {error ? <div className="group-poll-error">{error}</div> : null}

      {!pollIsOpen ? (
        <section className="group-poll-result">
          {outcome.state === "winner" ? (
            <>
              <div>
                <span className="eyebrow">Kết quả hiện tại</span>
                <strong>{leaders[0]!.name}</strong>
                <small>
                  Dẫn đầu với {leaders[0]!.votes} lượt vote. Poll đã đóng nên
                  kết quả sẽ không đổi cho tới khi người tạo mở lại.
                </small>
              </div>
              <a href={buildGroupPollPlannerHref(slug, leaders[0]!)}>
                Chốt kèo & lên plan →
              </a>
            </>
          ) : outcome.state === "tie" ? (
            <div>
              <span className="eyebrow">Kết quả đang hòa</span>
              <strong>
                {leaders.map((candidate) => candidate.name).join(" · ")}
              </strong>
              <small>
                Mỗi lựa chọn đang có {leaderVotes} lượt vote. Người tạo có thể
                mở lại poll nếu muốn cả nhóm phân định tiếp.
              </small>
            </div>
          ) : (
            <div>
              <span className="eyebrow">Poll đã đóng</span>
              <strong>Chưa có lượt vote nào</strong>
              <small>
                Người tạo có thể mở lại poll thêm 24 giờ để tiếp tục bình chọn.
              </small>
            </div>
          )}
        </section>
      ) : null}

      <section className="group-poll-grid">
        {poll.candidates.map((candidate) => {
          const selected = poll.myVote === candidate.placeId;
          const leading = leaderVotes > 0 && candidate.votes === leaderVotes;
          const params = new URLSearchParams({
            api: "1",
            query: candidate.latitude + "," + candidate.longitude
          });
          const plannerHref = buildGroupPollPlannerHref(slug, candidate);

          return (
            <article
              key={candidate.placeId}
              className={
                "group-poll-card" +
                (selected ? " group-poll-card--selected" : "") +
                (leading ? " group-poll-card--leading" : "")
              }
            >
              <div className="group-poll-card__head">
                <div>
                  <span className="eyebrow">{candidate.kind}</span>
                  <h2>{candidate.name}</h2>
                </div>
                <strong>{candidate.votes}</strong>
              </div>

              <div className="group-poll-card__facts">
                <span>{candidate.averageForTwo} / 2 người</span>
                <span>{ratingLabel(candidate.publicRating)}</span>
                <span>{candidate.match}% match</span>
              </div>

              {candidate.address ? (
                <p className="group-poll-card__address">{candidate.address}</p>
              ) : null}

              <div className="group-poll-card__actions">
                <button
                  type="button"
                  disabled={!pollIsOpen || Boolean(votingId)}
                  className={selected ? "is-selected" : ""}
                  onClick={() => void vote(candidate.placeId)}
                >
                  {votingId === candidate.placeId
                    ? "Đang ghi…"
                    : selected
                      ? "✓ Lựa chọn của bạn"
                      : "Vote chỗ này"}
                </button>
                <a href={plannerHref}>
                  {leading && leaderVotes > 0
                    ? "Chốt kèo & lên plan →"
                    : "Lên plan quanh chỗ này →"}
                </a>
                <a
                  href={"https://www.google.com/maps/search/?" + params.toString()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Xem bản đồ ↗
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="group-poll-footer">
        <p>
          Poll chỉ lưu lựa chọn theo profile ẩn danh của trình duyệt; không yêu
          cầu email hay tài khoản.
        </p>
        <a href="/">Tạo shortlist và poll mới với ĐiĐâu →</a>
      </footer>
    </main>
  );
}
