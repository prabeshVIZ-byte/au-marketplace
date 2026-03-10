"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const LOVES_TABLE = "post_likes";
const ATTENDEES_TABLE = "event_attendees";

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
  is_cancelled: boolean | null;
  created_by: string | null;
  owner_id: string | null;
};

type OwnerProfile = {
  full_name: string | null;
  user_role: string | null;
};

type EventLoveRow = {
  event_id: string | null;
};

type EventAttendeeRow = {
  id: string;
  event_id: string;
  user_id: string;
  created_at: string | null;
};

function formatTimeRange(startsAtISO: string | null, endsAtISO: string | null) {
  if (!startsAtISO) return "Time not set";

  const s = new Date(startsAtISO);
  if (Number.isNaN(s.getTime())) return "Time not set";

  const sameDay = endsAtISO ? new Date(endsAtISO).toDateString() === s.toDateString() : true;
  const day = s.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const st = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (!endsAtISO) return `${day} • ${st}`;

  const e = new Date(endsAtISO);
  if (Number.isNaN(e.getTime())) return `${day} • ${st}`;

  const et = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (sameDay) return `${day} • ${st}–${et}`;

  const endDay = e.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return `${day} ${st} → ${endDay} ${et}`;
}

function formatShortDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function ownerNameLabel(event: EventRow | null, owner: OwnerProfile | null) {
  if (!event) return "Ashland user";
  if (event.is_anonymous) return "Anonymous";
  const name = (owner?.full_name ?? "").trim();
  return name || "Ashland user";
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "A";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

function eventCategoryLabel(v: string | null) {
  const raw = (v ?? "").trim();
  if (!raw) return "Event";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isEventEnded(event: EventRow | null) {
  if (!event) return false;
  const endIso = event.ends_at ?? event.starts_at;
  if (!endIso) return false;
  const endTs = new Date(endIso).getTime();
  if (Number.isNaN(endTs)) return false;
  return endTs < Date.now();
}

function isEventLive(event: EventRow | null) {
  if (!event?.starts_at) return false;
  const startTs = new Date(event.starts_at).getTime();
  if (Number.isNaN(startTs)) return false;

  const endIso = event.ends_at ?? event.starts_at;
  const endTs = new Date(endIso).getTime();
  if (Number.isNaN(endTs)) return false;

  const now = Date.now();
  return now >= startTs && now <= endTs;
}

function eventStateChip(event: EventRow | null) {
  if (!event) return { label: "Loading", tone: "neutral" as const };
  if (event.is_cancelled) return { label: "Cancelled", tone: "closed" as const };
  if (isEventEnded(event)) return { label: "Ended", tone: "closed" as const };
  if (isEventLive(event)) return { label: "Live", tone: "good" as const };
  return { label: "Upcoming", tone: "good" as const };
}

export default function EventDetailPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [owner, setOwner] = useState<OwnerProfile | null>(null);

  const [loveCount, setLoveCount] = useState(0);
  const [myLoved, setMyLoved] = useState(false);

  const [attendeeCount, setAttendeeCount] = useState(0);
  const [myAttending, setMyAttending] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [openImg, setOpenImg] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const organizerId = useMemo(() => {
    return event?.owner_id ?? event?.created_by ?? null;
  }, [event?.owner_id, event?.created_by]);

  const isAshland = !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  const isOwner = useMemo(() => {
    return !!userId && !!organizerId && userId === organizerId;
  }, [userId, organizerId]);

  const ownerLabel = useMemo(() => ownerNameLabel(event, owner), [event, owner]);
  const chip = useMemo(() => eventStateChip(event), [event]);

  const subtitle = useMemo(() => {
    if (!event) return "";
    return [
      event.host_org?.trim() ? event.host_org.trim() : "",
      event.category?.trim() ? eventCategoryLabel(event.category) : "",
      event.location?.trim() ? event.location.trim() : "",
    ]
      .filter(Boolean)
      .join(" • ");
  }, [event]);

  const flow = useMemo(() => {
    if (!event) return null;

    if (isOwner) {
      return {
        kind: "owner" as const,
        title: "You created this event.",
        body: "Edit details, update the flyer, or remove the event.",
        primary: "Edit event",
        secondary: "Delete event",
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (!isAshland) {
      return {
        kind: "login" as const,
        title: "Log in to attend.",
        body: "Only Ashland users can join events.",
        primary: "Log in",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (event.is_cancelled) {
      return {
        kind: "cancelled" as const,
        title: "This event has been cancelled.",
        body: "Attendance is closed.",
        primary: "Cancelled",
        secondary: null,
        primaryDisabled: true,
        secondaryDisabled: true,
      };
    }

    if (isEventEnded(event)) {
      return {
        kind: "ended" as const,
        title: "This event has already ended.",
        body: "Attendance is closed.",
        primary: "Ended",
        secondary: null,
        primaryDisabled: true,
        secondaryDisabled: true,
      };
    }

    if (myAttending) {
      return {
        kind: "attending" as const,
        title: "You’re attending this event.",
        body: "You can leave if your plans changed.",
        primary: "Attending",
        secondary: "Leave",
        primaryDisabled: true,
        secondaryDisabled: false,
      };
    }

    return {
      kind: "open" as const,
      title: "You can attend this event.",
      body: "Join now so the organizer knows you’re coming.",
      primary: "Attend",
      secondary: event.link_url ? "Open link" : null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }, [event, isOwner, isAshland, myAttending]);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function loadEverything(uid: string | null, email: string | null) {
    if (!eventId) return;

    setLoading(true);
    setErr(null);

    try {
      const { data: ev, error: eventErr } = await supabase
        .from("events")
        .select(
          "id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,is_cancelled,created_by,owner_id"
        )
        .eq("id", eventId)
        .single();

      if (eventErr) throw new Error(eventErr.message);

      const loaded = ev as EventRow;
      setEvent(loaded);

      const resolvedOwnerId = loaded.owner_id ?? loaded.created_by ?? null;

      if (!loaded.is_anonymous && resolvedOwnerId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", resolvedOwnerId)
          .maybeSingle();

        setOwner((prof as OwnerProfile) ?? null);
      } else {
        setOwner(null);
      }

      const { count: lovesCount, error: loveCountErr } = await supabase
        .from(LOVES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId);

      if (!loveCountErr) setLoveCount(lovesCount ?? 0);
      else setLoveCount(0);

      if (uid) {
        const { data: mineLove, error: mineLoveErr } = await supabase
          .from(LOVES_TABLE)
          .select("event_id")
          .eq("event_id", eventId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!mineLoveErr) setMyLoved(!!mineLove);
        else setMyLoved(false);
      } else {
        setMyLoved(false);
      }

      const { data: attendeeRows, count: attendeeCountExact, error: attendeeErr } = await supabase
        .from(ATTENDEES_TABLE)
        .select("id,event_id,user_id,created_at", { count: "exact" })
        .eq("event_id", eventId);

      if (!attendeeErr) {
        const rows = (attendeeRows as EventAttendeeRow[]) || [];
        setAttendeeCount(attendeeCountExact ?? rows.length);

        if (uid) {
          setMyAttending(rows.some((row) => row.user_id === uid));
        } else {
          setMyAttending(false);
        }
      } else {
        setAttendeeCount(0);
        setMyAttending(false);
      }

      setUserId(uid);
      setUserEmail(email);
    } catch (e: any) {
      setErr(e?.message || "Failed to load event.");
      setEvent(null);
      setOwner(null);
      setLoveCount(0);
      setMyLoved(false);
      setAttendeeCount(0);
      setMyAttending(false);
    } finally {
      setLoading(false);
    }
  }

  async function syncAuthAndLoad() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    const email = data.session?.user?.email ?? null;
    await loadEverything(uid, email);
  }

  async function toggleLove() {
    if (!event) return;

    if (!userId) {
      router.push("/me");
      return;
    }

    setBusy(true);

    try {
      if (myLoved) {
        const { error } = await supabase
          .from(LOVES_TABLE)
          .delete()
          .eq("event_id", event.id)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);

        setMyLoved(false);
        setLoveCount((c) => Math.max(0, c - 1));
      } else {
        const { error } = await supabase.from(LOVES_TABLE).insert([
          {
            event_id: event.id,
            user_id: userId,
          },
        ]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) {
            throw new Error(error.message);
          }
        }

        setMyLoved(true);
        setLoveCount((c) => c + 1);
      }
    } catch (e: any) {
      showToast(e?.message || "Could not update love.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function attendEvent() {
    if (!event) return;

    if (!userId) {
      router.push("/me");
      return;
    }

    if (isOwner) return;
    if (event.is_cancelled || isEventEnded(event)) {
      showToast("This event is not accepting attendance.", "err");
      return;
    }

    setActionBusy("attend");

    try {
      const { error } = await supabase.from(ATTENDEES_TABLE).insert([
        {
          event_id: event.id,
          user_id: userId,
        },
      ]);

      if (error) {
        const msg = error.message.toLowerCase();
        if (!msg.includes("duplicate") && !msg.includes("unique")) {
          throw new Error(error.message);
        }
      }

      await loadEverything(userId, userEmail);
      showToast("You’re attending.");
    } catch (e: any) {
      showToast(e?.message || "Could not join event.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function leaveEvent() {
    if (!event || !userId) return;

    setActionBusy("leave");

    try {
      const { error } = await supabase
        .from(ATTENDEES_TABLE)
        .delete()
        .eq("event_id", event.id)
        .eq("user_id", userId);

      if (error) throw new Error(error.message);

      await loadEverything(userId, userEmail);
      showToast("You left the event.");
    } catch (e: any) {
      showToast(e?.message || "Could not leave event.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function deleteEvent() {
    if (!event || !isOwner || !userId) return;

    setBusy(true);

    try {
      await supabase.from(ATTENDEES_TABLE).delete().eq("event_id", event.id);
      await supabase.from(LOVES_TABLE).delete().eq("event_id", event.id);

      const { error } = await supabase
        .from("events")
        .delete()
        .eq("id", event.id)
        .eq("created_by", userId);

      if (error) throw new Error(error.message);

      showToast("Event deleted.");
      router.replace("/feed");
    } catch (e: any) {
      showToast(e?.message || "Could not delete event.", "err");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  useEffect(() => {
    syncAuthAndLoad();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
      await loadEverything(uid, email);
    });

    return () => sub.subscription.unsubscribe();
  }, [eventId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setOpenImg(null);
        setConfirmDelete(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

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

        {err && <div className="alert err">{err}</div>}
        {loading && <div className="alert">Loading…</div>}

        {!loading && !err && !event && <div className="alert err">Event not found.</div>}

        {!loading && event && (
          <section className="card">
            <div className="cardTop">
              <div className="authorSide">
                <div className="avatar">{initials(ownerLabel)}</div>

                <div className="authorText">
                  <div className="authorName">{ownerLabel}</div>
                  {subtitle ? <div className="authorSub">{subtitle}</div> : null}
                </div>
              </div>

              {isOwner ? (
                <div className="menuWrap">
                  {menuOpen ? (
                    <button
                      className="menuBackdrop"
                      aria-label="Close menu"
                      onClick={() => setMenuOpen(false)}
                      type="button"
                    />
                  ) : null}

                  <button
                    className="menuBtn"
                    type="button"
                    aria-label="Event options"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    ⋯
                  </button>

                  {menuOpen ? (
                    <div className="menuCard">
                      <button
                        className="menuItem"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          router.push(`/event/${event.id}/edit`);
                        }}
                      >
                        Edit event
                      </button>

                      {event.link_url ? (
                        <button
                          className="menuItem"
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            window.open(event.link_url!, "_blank", "noopener,noreferrer");
                          }}
                        >
                          Open event link
                        </button>
                      ) : null}

                      <button
                        className="menuItem danger"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDelete(true);
                        }}
                      >
                        Delete event
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  className={`loveBtn ${myLoved ? "active" : ""}`}
                  type="button"
                  onClick={toggleLove}
                  disabled={busy}
                  aria-label="Love event"
                >
                  {myLoved ? "♥" : "♡"}
                </button>
              )}
            </div>

            <div className="mediaWrap">
              {event.photo_url ? (
                <button className="imgBtn" type="button" onClick={() => setOpenImg(event.photo_url!)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={event.photo_url} alt={event.title} className="heroImg" />
                </button>
              ) : (
                <div className="noPhoto">No flyer</div>
              )}
            </div>

            <div className="body">
              <div className="titleRow">
                <h1 className="title">{event.title}</h1>

                {!isOwner ? (
                  <button
                    className={`loveBtn small ${myLoved ? "active" : ""}`}
                    type="button"
                    onClick={toggleLove}
                    disabled={busy}
                    aria-label="Love event"
                  >
                    {myLoved ? "♥" : "♡"}
                  </button>
                ) : null}
              </div>

              <div className="statsRow">
                <span className="stat">
                  <span className="statIcon">♥</span> {loveCount}
                </span>

                <span className="dot">•</span>

                <span className="stat">{attendeeCount} attending</span>

                <span className="dot">•</span>

                <span className={`statusPill ${chip.tone}`}>{chip.label}</span>

                <span className="dot">•</span>

                <span className="stat">{formatTimeRange(event.starts_at, event.ends_at)}</span>
              </div>

              {flow ? (
                <div className="flowCard">
                  <div className="flowTitle">{flow.title}</div>
                  <div className="flowBody">{flow.body}</div>

                  <div className="flowActions">
                    <button
                      className="primaryAction"
                      type="button"
                      disabled={flow.primaryDisabled || !!actionBusy}
                      onClick={() => {
                        if (flow.kind === "owner") {
                          router.push(`/event/${event.id}/edit`);
                          return;
                        }
                        if (flow.kind === "login") {
                          router.push("/me");
                          return;
                        }
                        if (flow.kind === "open") {
                          void attendEvent();
                        }
                      }}
                    >
                      {actionBusy === "attend" ? "Saving…" : flow.primary}
                    </button>

                    {flow.secondary ? (
                      <button
                        className="secondaryAction"
                        type="button"
                        disabled={flow.secondaryDisabled || !!actionBusy}
                        onClick={() => {
                          if (flow.kind === "owner") {
                            setConfirmDelete(true);
                            return;
                          }
                          if (flow.kind === "attending") {
                            void leaveEvent();
                            return;
                          }
                          if (flow.kind === "open" && event.link_url) {
                            window.open(event.link_url, "_blank", "noopener,noreferrer");
                          }
                        }}
                      >
                        {actionBusy === "leave" ? "Working…" : flow.secondary}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="eventInfo">
                <span className="infoPill">📍 {event.location?.trim() || "Location not set"}</span>
                <span className="infoPill">🕒 {formatTimeRange(event.starts_at, event.ends_at)}</span>
                <span className="infoPill">🏷 {eventCategoryLabel(event.category)}</span>
                <span className="infoPill">👥 {event.host_org?.trim() || "Host not set"}</span>
                {event.link_url ? (
                  <button
                    className="infoPill linkPill"
                    type="button"
                    onClick={() => window.open(event.link_url!, "_blank", "noopener,noreferrer")}
                  >
                    🔗 Open link
                  </button>
                ) : null}
              </div>

              {event.description?.trim() ? (
                <div className="caption">
                  <span className="captionName">{ownerLabel}</span> {event.description.trim()}
                </div>
              ) : null}

              <div className="metaFoot">
                <span>Starts {formatShortDate(event.starts_at)}</span>
                {event.ends_at ? <span>Ends {formatShortDate(event.ends_at)}</span> : null}
                {event.is_cancelled ? <span className="dangerText">Cancelled</span> : null}
              </div>
            </div>
          </section>
        )}
      </div>

      {confirmDelete ? (
        <div className="modal" onClick={() => setConfirmDelete(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete event?</div>
            <div className="modalText">This permanently removes the event and attendee list.</div>

            <div className="modalActions">
              <button className="ghostBtn" onClick={() => setConfirmDelete(false)} type="button">
                Cancel
              </button>
              <button className="dangerBtn" onClick={deleteEvent} disabled={busy} type="button">
                {busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {toast ? <div className={`toast ${toast.kind === "err" ? "err" : "ok"}`}>{toast.msg}</div> : null}

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
          background: linear-gradient(135deg, #ede9fe 0%, #dbeafe 100%);
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

        .menuWrap {
          position: relative;
          flex: 0 0 auto;
        }

        .menuBtn,
        .loveBtn {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 22px;
          line-height: 1;
          font-weight: 900;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .loveBtn.active {
          color: #dc2626;
          border-color: #fecaca;
          background: #fff5f5;
        }

        .loveBtn.small {
          width: 34px;
          height: 34px;
          font-size: 19px;
        }

        .menuBackdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          border: 0;
          padding: 0;
          margin: 0;
        }

        .menuCard {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 200px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.14);
          z-index: 30;
        }

        .menuItem {
          width: 100%;
          border: 0;
          background: #fff;
          text-align: left;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 900;
          color: #0f172a;
          cursor: pointer;
        }

        .menuItem + .menuItem {
          border-top: 1px solid #eef2f7;
        }

        .menuItem.danger {
          color: #b91c1c;
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

        .noPhoto {
          height: 220px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }

        .body {
          padding: 14px 14px 16px;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .title {
          margin: 0;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 1000;
          letter-spacing: -0.04em;
          overflow-wrap: anywhere;
          flex: 1;
          min-width: 0;
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
          color: #dc2626;
        }

        .dot {
          color: #cbd5e1;
        }

        .statusPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
        }

        .statusPill.good {
          color: #166534;
          border-color: #bbf7d0;
          background: #ecfdf5;
        }

        .statusPill.closed,
        .statusPill.neutral {
          color: #475569;
          border-color: #e5e7eb;
          background: #f8fafc;
        }

        .flowCard {
          margin-top: 14px;
          padding: 14px;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
        }

        .flowTitle {
          font-size: 14px;
          font-weight: 1000;
          color: #0f172a;
        }

        .flowBody {
          margin-top: 5px;
          font-size: 13px;
          line-height: 1.5;
          color: #475569;
          font-weight: 700;
        }

        .flowActions {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .primaryAction,
        .secondaryAction {
          min-height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .primaryAction {
          border: 1px solid rgba(59, 130, 246, 0.24);
          background: rgba(59, 130, 246, 0.12);
          color: #1d4ed8;
        }

        .secondaryAction {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .primaryAction:disabled,
        .secondaryAction:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .eventInfo {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .infoPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid #ddd6fe;
          background: #f5f3ff;
          color: #6d28d9;
          font-size: 11px;
          font-weight: 900;
        }

        .linkPill {
          cursor: pointer;
        }

        .caption {
          margin-top: 12px;
          font-size: 13px;
          line-height: 1.58;
          color: #334155;
          white-space: pre-wrap;
        }

        .captionName {
          color: #0f172a;
          font-weight: 1000;
        }

        .metaFoot {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }

        .dangerText {
          color: #b91c1c;
        }

        .modal,
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

        .modalCard,
        .imgCard {
          width: 100%;
          max-width: 520px;
          border-radius: 22px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
        }

        .modalCard {
          padding: 16px;
        }

        .modalTitle {
          font-size: 16px;
          font-weight: 1000;
          color: #0f172a;
        }

        .modalText {
          margin-top: 8px;
          font-size: 13px;
          color: #475569;
          font-weight: 700;
          line-height: 1.45;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .ghostBtn,
        .dangerBtn {
          border-radius: 14px;
          padding: 10px 13px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .ghostBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .dangerBtn {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
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

        .toast {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 120;
          max-width: calc(100vw - 24px);
          padding: 10px 13px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.14);
        }

        .toast.ok {
          border-color: #bbf7d0;
        }

        .toast.err {
          border-color: #fecdd3;
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 320px;
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

          .flowActions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .primaryAction,
          .secondaryAction {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}