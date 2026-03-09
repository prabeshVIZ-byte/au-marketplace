"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
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

function fmtDateTime(value: string | null) {
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

export default function EventDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";

  const [event, setEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvent() {
      if (!id) return;

      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,created_by,created_at"
        )
        .eq("id", id)
        .single();

      if (error) {
        setErr(error.message || "Could not load event.");
        setEvent(null);
        setLoading(false);
        return;
      }

      setEvent(data as EventRow);
      setLoading(false);
    }

    loadEvent();
  }, [id]);

  return (
    <div className="page">
      <div className="shell">
        <header className="topBar">
          <button className="backBtn" onClick={() => router.back()} type="button">
            ← Back
          </button>
        </header>

        {loading ? <div className="card">Loading event…</div> : null}
        {err ? <div className="card error">{err}</div> : null}

        {!loading && !err && event ? (
          <section className="card">
            {event.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.photo_url} alt={event.title} className="heroImg" />
            ) : (
              <div className="heroFallback">Event</div>
            )}

            <div className="body">
              <div className="badge">EVENT</div>
              <h1 className="title">{event.title}</h1>

              <div className="meta">
                <div><b>Host:</b> {event.is_anonymous ? "Anonymous" : event.host_org || "—"}</div>
                <div><b>Category:</b> {event.category || "—"}</div>
                <div><b>Location:</b> {event.location || "—"}</div>
                <div><b>Starts:</b> {fmtDateTime(event.starts_at)}</div>
                <div><b>Ends:</b> {fmtDateTime(event.ends_at)}</div>
              </div>

              {event.description ? <p className="desc">{event.description}</p> : null}

              {event.link_url ? (
                <a
                  href={event.link_url}
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

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f7f7f8;
          color: #0f172a;
          padding: 12px;
        }

        .shell {
          max-width: 760px;
          margin: 0 auto;
        }

        .topBar {
          margin-bottom: 12px;
        }

        .backBtn {
          height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-weight: 900;
          cursor: pointer;
        }

        .card {
          overflow: hidden;
          border-radius: 22px;
          border: 1px solid #e5e7eb;
          background: #fff;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
        }

        .error {
          padding: 14px;
          color: #b91c1c;
        }

        .heroImg {
          width: 100%;
          height: 260px;
          object-fit: cover;
          display: block;
          background: #f1f5f9;
        }

        .heroFallback {
          height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          font-size: 22px;
          font-weight: 900;
          color: #3730a3;
        }

        .body {
          padding: 16px;
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
          font-size: 28px;
          line-height: 1.05;
          font-weight: 1000;
        }

        .meta {
          margin-top: 14px;
          display: grid;
          gap: 8px;
          color: #475569;
          font-size: 14px;
          line-height: 1.45;
        }

        .desc {
          margin-top: 16px;
          font-size: 15px;
          line-height: 1.6;
          color: #334155;
          white-space: pre-wrap;
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
          color: white;
          font-weight: 900;
          text-decoration: none;
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 220px;
          }

          .title {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
}