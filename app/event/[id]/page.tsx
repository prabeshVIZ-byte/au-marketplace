"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  host_org: string | null;
  category: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  link_url: string | null;
  photo_url: string | null;
  is_anonymous: boolean | null;
  created_by: string | null;
  created_at: string | null;
};

type CreatorProfile = {
  full_name: string | null;
  user_role: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDateTime(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventStatusLabel(event: EventRow | null) {
  if (!event?.starts_at && !event?.ends_at) return "Schedule TBD";

  const now = Date.now();
  const starts = event.starts_at ? new Date(event.starts_at).getTime() : null;
  const ends = event.ends_at ? new Date(event.ends_at).getTime() : null;

  if (starts && !Number.isNaN(starts) && now < starts) return "Upcoming";
  if (ends && !Number.isNaN(ends) && now > ends) return "Ended";
  return "Live / Ongoing";
}

function eventStatusTone(event: EventRow | null) {
  const label = eventStatusLabel(event);
  if (label === "Upcoming") return "upcoming";
  if (label === "Ended") return "ended";
  if (label === "Live / Ongoing") return "live";
  return "neutral";
}

function normalizeUrl(value: string | null) {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function hostLabel(event: EventRow | null, creator: CreatorProfile | null) {
  if (!event) return "Campus event";
  if (event.is_anonymous) return "Anonymous";

  const org = (event.host_org ?? "").trim();
  if (org) return org;

  const creatorName = (creator?.full_name ?? "").trim();
  if (creatorName) return creatorName;

  return "Campus event";
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "E";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function EventDetailPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [openImg, setOpenImg] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvent() {
      if (!eventId) return;

      setLoading(true);
      setErr(null);

      try {
        const { data, error } = await supabase
          .from("events")
          .select(
            "id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,created_by,created_at"
          )
          .eq("id", eventId)
          .single();

        if (error) throw new Error(error.message);

        const loaded = data as EventRow;
        setEvent(loaded);

        if (!loaded.is_anonymous && loaded.created_by) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name,user_role")
            .eq("id", loaded.created_by)
            .maybeSingle();

          setCreator((prof as CreatorProfile) ?? null);
        } else {
          setCreator(null);
        }
      } catch (e: any) {
        setErr(e?.message || "Could not load event.");
        setEvent(null);
        setCreator(null);
      } finally {
        setLoading(false);
      }
    }

    loadEvent();
  }, [eventId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const host = useMemo(() => hostLabel(event, creator), [event, creator]);

  const subtitle = useMemo(() => {
    if (!event) return "";
    return [event.category?.trim() || "", event.location?.trim() || ""]
      .filter(Boolean)
      .join(" • ");
  }, [event]);

  const status = useMemo(() => eventStatusLabel(event), [event]);
  const statusClass = useMemo(() => eventStatusTone(event), [event]);

  const startShort = useMemo(() => formatShortDateTime(event?.starts_at ?? null), [event?.starts_at]);
  const endShort = useMemo(() => formatShortDateTime(event?.ends_at ?? null), [event?.ends_at]);

  const linkHref = useMemo(() => normalizeUrl(event?.link_url ?? null), [event?.link_url]);

  return (
    <div className="page">
      <div className="shell">
        <header className="topBar">
          <button className="iconBtn" onClick={() => router.back()} aria-label="Back" type="button">
            ←
          </button>

          <div className="topCenter">
            <div className="topTitle">Event</div>
            <div className="topSub">scholarswap</div>
          </div>

          <div className="topRightSpace" />
        </header>

        {err ? <div className="alert err">{err}</div> : null}
        {loading ? <div className="alert">Loading event…</div> : null}

        {!loading && !err && event ? (
          <section className="card">
            <div className="cardTop">
              <div className="authorSide">
                <div className="avatar">{initials(host)}</div>

                <div className="authorText">
                  <div className="authorName">{host}</div>
                  {subtitle ? <div className="authorSub">{subtitle}</div> : null}
                </div>
              </div>

              <div className={`statusPill ${statusClass}`}>{status}</div>
            </div>

            <div className="mediaWrap">
              {event.photo_url ? (
                <button
                  className="imgBtn"
                  type="button"
                  onClick={() => setOpenImg(event.photo_url!)}
                  aria-label="Open event image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={event.photo_url} alt={event.title} className="heroImg" />
                </button>
              ) : (
                <div className="heroFallback">Event</div>
              )}
            </div>

            <div className="body">
              <div className="badge">EVENT</div>

              <h1 className="title">{event.title}</h1>

              <div className="statsRow">
                {startShort ? (
                  <span className="stat">
                    <span className="statIcon">🕒</span>
                    Starts {startShort}
                  </span>
                ) : null}

                {endShort ? (
                  <>
                    <span className="dot">•</span>
                    <span className="stat">
                      <span className="statIcon">⏳</span>
                      Ends {endShort}
                    </span>
                  </>
                ) : null}

                {event.location?.trim() ? (
                  <>
                    <span className="dot">•</span>
                    <span className="stat">
                      <span className="statIcon">📍</span>
                      {event.location.trim()}
                    </span>
                  </>
                ) : null}
              </div>

              <div className="infoGrid">
                <div className="infoCard">
                  <div className="infoLabel">Host</div>
                  <div className="infoValue">{host}</div>
                </div>

                <div className="infoCard">
                  <div className="infoLabel">Category</div>
                  <div className="infoValue">{event.category || "—"}</div>
                </div>

                <div className="infoCard">
                  <div className="infoLabel">Starts</div>
                  <div className="infoValue">{formatDateTime(event.starts_at)}</div>
                </div>

                <div className="infoCard">
                  <div className="infoLabel">Ends</div>
                  <div className="infoValue">{formatDateTime(event.ends_at)}</div>
                </div>

                <div className="infoCard full">
                  <div className="infoLabel">Location</div>
                  <div className="infoValue">{event.location || "—"}</div>
                </div>
              </div>

              {event.description?.trim() ? (
                <div className="caption">
                  <span className="captionName">{host}</span> {event.description.trim()}
                </div>
              ) : null}

              {linkHref ? (
                <a
                  href={linkHref}
                  target="_blank"
                  rel="noreferrer"
                  className="linkBtn"
                >
                  Open event link
                </a>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {openImg && event ? (
        <div className="imgModal" onClick={() => setOpenImg(null)}>
          <div className="imgCard" onClick={(e) => e.stopPropagation()}>
            <div className="imgTop">
              <div className="imgTitle">{event.title}</div>
              <button className="iconGhost" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={event.title} className="imgFull" />
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f6f7fb;
          color: #0f172a;
          padding: 12px 12px 28px;
        }

        .shell {
          max-width: 760px;
          margin: 0 auto;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          grid-template-columns: 42px 1fr 42px;
          align-items: center;
          gap: 10px;
          padding: 6px 0 12px;
          background: rgba(246, 247, 251, 0.9);
          backdrop-filter: blur(12px);
        }

        .iconBtn,
        .iconGhost {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
        }

        .topCenter {
          text-align: center;
          min-width: 0;
        }

        .topTitle {
          font-size: 16px;
          font-weight: 1000;
          line-height: 1.1;
        }

        .topSub {
          margin-top: 2px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
        }

        .topRightSpace {
          width: 42px;
          height: 42px;
        }

        .alert {
          margin: 8px 0 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 11px 13px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .alert.err {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .card {
          margin-top: 8px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
        }

        .cardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid #eef2f7;
        }

        .authorSide {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          border: 1px solid #dbe3f0;
          background: linear-gradient(135deg, #e0e7ff 0%, #dbeafe 100%);
          font-size: 12px;
          font-weight: 1000;
          flex: 0 0 auto;
        }

        .authorText {
          min-width: 0;
        }

        .authorName {
          font-size: 13px;
          font-weight: 1000;
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .authorSub {
          margin-top: 4px;
          font-size: 11px;
          color: #64748b;
          font-weight: 700;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .statusPill {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 1000;
          border: 1px solid transparent;
          white-space: nowrap;
        }

        .statusPill.upcoming {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #bfdbfe;
        }

        .statusPill.live {
          background: #ecfdf5;
          color: #047857;
          border-color: #a7f3d0;
        }

        .statusPill.ended {
          background: #f8fafc;
          color: #475569;
          border-color: #e2e8f0;
        }

        .statusPill.neutral {
          background: #f8fafc;
          color: #475569;
          border-color: #e2e8f0;
        }

        .mediaWrap {
          background: #f8fafc;
        }

        .imgBtn {
          display: block;
          width: 100%;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .heroImg {
          width: 100%;
          height: 420px;
          object-fit: cover;
          display: block;
        }

        .heroFallback {
          height: 260px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff 0%, #dbeafe 100%);
          color: #3730a3;
          font-size: 24px;
          font-weight: 1000;
        }

        .body {
          padding: 14px 14px 16px;
        }

        .badge {
          display: inline-flex;
          min-height: 28px;
          align-items: center;
          padding: 0 10px;
          border-radius: 999px;
          background: rgba(59, 130, 246, 0.12);
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 900;
        }

        .title {
          margin: 10px 0 0;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 1000;
          letter-spacing: -0.04em;
          overflow-wrap: anywhere;
        }

        .statsRow {
          margin-top: 10px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          color: #475569;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.4;
        }

        .stat {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .statIcon {
          font-size: 12px;
        }

        .dot {
          color: #cbd5e1;
        }

        .infoGrid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .infoCard {
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          border-radius: 16px;
          padding: 12px;
          min-width: 0;
        }

        .infoCard.full {
          grid-column: 1 / -1;
        }

        .infoLabel {
          font-size: 11px;
          font-weight: 900;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .infoValue {
          margin-top: 6px;
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .caption {
          margin-top: 14px;
          font-size: 13px;
          line-height: 1.58;
          color: #334155;
          white-space: pre-wrap;
        }

        .captionName {
          color: #0f172a;
          font-weight: 1000;
        }

        .linkBtn {
          margin-top: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 14px;
          border-radius: 14px;
          background: #10b981;
          color: #fff;
          font-weight: 900;
          text-decoration: none;
          border: 1px solid #10b981;
        }

        .imgModal {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(15, 23, 42, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .imgCard {
          width: 100%;
          max-width: 520px;
          border-radius: 22px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
          overflow: hidden;
        }

        .imgTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .imgTitle {
          font-size: 13px;
          font-weight: 1000;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imgFull {
          display: block;
          width: 100%;
          max-height: 80vh;
          object-fit: contain;
          background: #111827;
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 320px;
          }

          .heroFallback {
            height: 220px;
            font-size: 22px;
          }

          .title {
            font-size: 20px;
          }

          .authorSub {
            white-space: normal;
          }

          .statsRow {
            gap: 6px;
          }

          .dot {
            display: none;
          }

          .stat {
            width: 100%;
          }

          .infoGrid {
            grid-template-columns: 1fr;
          }

          .infoCard.full {
            grid-column: auto;
          }
        }
      `}</style>
    </div>
  );
}