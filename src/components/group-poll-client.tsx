"use client";

import { useEffect, useMemo, useState } from "react";
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

function plannerHandoffHref(
  slug: string,
  candidate: GroupPoll["candidates"][number]
) {
  const params = new URLSearchParams({
    fromPoll: slug,
    anchorId: candidate.placeId,
    anchorName: candidate.name,
    anchorKind: candidate.kind,
    anchorLat: String(candidate.latitude),
    anchorLng: String(candidate.longitude),
    anchorAddress: candidate.address,
    anchorCost: candidate.averageForTwo,
    anchorRating: String(candidate.publicRating),
    anchorMatch: String(candidate.match)
  });

  return "/?" + params.toString();
}

export function GroupPollClient({ slug }: GroupPollClientProps) {
  const [poll, setPoll] = useState<GroupPoll | null>(null);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let active = true;

    void personalApi.groupPoll
      .get(slug)
      .then(({ poll: next }) => {
        if (!active) return;
        setPoll(next);
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

  const leaderVotes = useMemo(
    () =>
      poll
        ? Math.max(0, ...poll.candidates.map((candidate) => candidate.votes))
        : 0,
    [poll]
  );

  const leaders = useMemo(
    () =>
      poll && leaderVotes > 0
        ? poll.candidates.filter(
            (candidate) => candidate.votes === leaderVotes
          )
        : [],
    [poll, leaderVotes]
  );

  async function vote(placeId: string) {
    if (!poll?.isOpen || votingId) return;

    setVotingId(placeId);
    setError(null);
    try {
      const result = await personalApi.groupPoll.vote(slug, placeId);
      setPoll(result.poll);
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

    setManaging(true);
    setError(null);
    try {
      const result = await personalApi.groupPoll.setOpen(slug, open);
      setPoll(result.poll);
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
                onClick={() => void setPollOpen(!poll.isOpen)}
              >
                {managing
                  ? "Đang cập nhật…"
                  : poll.isOpen
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
          <span>{poll.isOpen ? "Đang mở" : "Đã đóng"}</span>
          {poll.isOwner ? <span>Bạn là người tạo poll</span> : null}
        </div>
      </header>

      {error ? <div className="group-poll-error">{error}</div> : null}

      {!poll.isOpen ? (
        <section className="group-poll-result">
          {leaders.length === 1 ? (
            <>
              <div>
                <span className="eyebrow">Kết quả hiện tại</span>
                <strong>{leaders[0]!.name}</strong>
                <small>
                  Dẫn đầu với {leaders[0]!.votes} lượt vote. Poll đã đóng nên
                  kết quả sẽ không đổi cho tới khi người tạo mở lại.
                </small>
              </div>
              <a href={plannerHandoffHref(slug, leaders[0]!)}>
                Chốt kèo & lên plan →
              </a>
            </>
          ) : leaders.length > 1 ? (
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
          const plannerHref = plannerHandoffHref(slug, candidate);

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
                  disabled={!poll.isOpen || Boolean(votingId)}
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
