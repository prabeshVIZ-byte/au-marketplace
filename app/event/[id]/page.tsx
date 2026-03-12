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
  id?: string | null;
  full_name: string | null;
  user_role: string | null;
};

type AttendeePreviewRow = {
  user_id: string | null;
  profile:
    | {
        id?: string | null;
        full_name: string | null;
        user_role: string | null;
      }
    | {
        id?: string | null;
        full_name: string | null;
        user_role: string | null;
      }[]
    | null;
};

type RelatedEventRow = {
  id: string;
  title: string;
  starts_at: string | null;
  location: string | null;
  photo_url: string | null;
};

type ToastState =
  | {
      msg: string;
      kind: "ok" | "err";
    }
  | null;

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function eventCategoryLabel(v: string | null) {
  const raw = (v ?? "").trim();
  if (!raw) return "Event";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

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

  const st = s.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (!endsAtISO) return `${day} • ${st}`;

  const e = new Date(endsAtISO);
  if (Number.isNaN(e.getTime())) return `${day} • ${st}`;

  const et = e.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return `${day} • ${st}–${et}`;

  const endDay = e.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return `${day} ${st} → ${endDay} ${et}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "Not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not set";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  if (event.is_anonymous) return "";
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

function readableRole(role: string | null | undefined) {
  const raw = (role ?? "").trim().toLowerCase();
  if (!raw) return "Ashland member";
  if (raw === "student") return "Student";
  if (raw === "faculty") return "Faculty";
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
  if (isEventLive(event)) return { label: "Live now", tone: "good" as const };
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
  const [attendeePreview, setAttendeePreview] = useState<OwnerProfile[]>([]);

  const [relatedEvents, setRelatedEvents] = useState<RelatedEventRow[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const organizerId = useMemo(() => {
    return event?.owner_id ?? event?.created_by ?? null;
  }, [event?.owner_id, event?.created_by]);

  const isOwner = useMemo(() => {
    return !!userId && !!organizerId && userId === organizerId;
  }, [userId, organizerId]);

  const isAshland = !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  const ownerLabel = useMemo(() => ownerNameLabel(event, owner), [event, owner]);
  const chip = useMemo(() => eventStateChip(event), [event]);

  const heroMeta = useMemo(() => {
    if (!event) return "";
    return [event.host_org?.trim() || "", eventCategoryLabel(event.category)]
      .filter(Boolean)
      .join(" • ");
  }, [event]);

  const eventDateDisplay = useMemo(() => {
    return formatTimeRange(event?.starts_at ?? null, event?.ends_at ?? null);
  }, [event?.starts_at, event?.ends_at]);

  const hostOrgLabel = useMemo(() => {
    const org = (event?.host_org ?? "").trim();
    return org || "Campus organization";
  }, [event?.host_org]);

  const postedByLabel = useMemo(() => {
    if (!event || event.is_anonymous) return "";
    return ownerLabel;
  }, [event, ownerLabel]);

  const actionCard = useMemo(() => {
    if (!event || isOwner) return null;

    if (!isAshland) {
      return {
        title: userId ? "Use your Ashland account to attend" : "Log in to attend",
        body: "Only Ashland users can join campus events.",
        primary: userId ? "Open profile" : "Log in",
        secondary: event.link_url ? "Open link" : null,
        primaryDisabled: false,
        secondaryDisabled: false,
        kind: "login" as const,
      };
    }

    if (event.is_cancelled) {
      return {
        title: "This event has been cancelled",
        body: "Attendance is closed.",
        primary: "Cancelled",
        secondary: event.link_url ? "Open link" : null,
        primaryDisabled: true,
        secondaryDisabled: false,
        kind: "cancelled" as const,
      };
    }

    if (isEventEnded(event)) {
      return {
        title: "This event has ended",
        body: "Attendance is closed.",
        primary: "Ended",
        secondary: event.link_url ? "Open link" : null,
        primaryDisabled: true,
        secondaryDisabled: false,
        kind: "ended" as const,
      };
    }

    if (myAttending) {
      return {
        title: "You’re going",
        body: "You can leave anytime if your plans change.",
        primary: "Attending",
        secondary: "Leave",
        tertiary: event.link_url ? "Open link" : null,
        primaryDisabled: true,
        secondaryDisabled: false,
        tertiaryDisabled: false,
        kind: "attending" as const,
      };
    }

    return {
      title: "Join this event",
      body: "Let the organizer know you’re coming.",
      primary: "Attend",
      secondary: event.link_url ? "Open link" : null,
      primaryDisabled: false,
      secondaryDisabled: false,
      kind: "open" as const,
    };
  }, [event, isOwner, isAshland, myAttending, userId]);

  const essentials = useMemo(() => {
    if (!event) return [];
    return [
      {
        label: "When",
        value: eventDateDisplay,
      },
      {
        label: "Where",
        value: event.location?.trim() || "Location not set",
      },
      {
        label: "Host",
        value: hostOrgLabel,
      },
      {
        label: "Category",
        value: eventCategoryLabel(event.category),
      },
    ];
  }, [event, hostOrgLabel, eventDateDisplay]);

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
        .maybeSingle();

      if (eventErr) throw new Error(eventErr.message);

      if (!ev) {
        setEvent(null);
        setOwner(null);
        setLoveCount(0);
        setMyLoved(false);
        setAttendeeCount(0);
        setMyAttending(false);
        setAttendeePreview([]);
        setRelatedEvents([]);
        setUserId(uid);
        setUserEmail(email);
        return;
      }

      const loaded = ev as EventRow;
      setEvent(loaded);

      const resolvedOwnerId = loaded.owner_id ?? loaded.created_by ?? null;

      const ownerPromise =
        !loaded.is_anonymous && resolvedOwnerId
          ? supabase
              .from("profiles")
              .select("id,full_name,user_role")
              .eq("id", resolvedOwnerId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null });

      const loveCountPromise = supabase
        .from(LOVES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId);

      const myLovePromise = uid
        ? supabase
            .from(LOVES_TABLE)
            .select("event_id")
            .eq("event_id", eventId)
            .eq("user_id", uid)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const attendeeCountPromise = supabase
        .from(ATTENDEES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId);

      const myAttendingPromise = uid
        ? supabase
            .from(ATTENDEES_TABLE)
            .select("id")
            .eq("event_id", eventId)
            .eq("user_id", uid)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const attendeePreviewPromise = supabase
        .from(ATTENDEES_TABLE)
        .select("user_id, profile:profiles!event_attendees_user_id_fkey(id,full_name,user_role)")
        .eq("event_id", eventId)
        .limit(6);

      const relatedEventsPromise =
        resolvedOwnerId && !loaded.is_anonymous
          ? supabase
              .from("events")
              .select("id,title,starts_at,location,photo_url")
              .or(`owner_id.eq.${resolvedOwnerId},created_by.eq.${resolvedOwnerId}`)
              .neq("id", eventId)
              .eq("is_cancelled", false)
              .gte("starts_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
              .order("starts_at", { ascending: true })
              .limit(3)
          : Promise.resolve({ data: [], error: null });

      const [
        ownerRes,
        loveCountRes,
        myLoveRes,
        attendeeCountRes,
        myAttendingRes,
        attendeePreviewRes,
        relatedEventsRes,
      ] = await Promise.all([
        ownerPromise,
        loveCountPromise,
        myLovePromise,
        attendeeCountPromise,
        myAttendingPromise,
        attendeePreviewPromise,
        relatedEventsPromise,
      ]);

      setOwner((ownerRes?.data as OwnerProfile) ?? null);
      setLoveCount(loveCountRes.count ?? 0);
      setMyLoved(!!myLoveRes.data);
      setAttendeeCount(attendeeCountRes.count ?? 0);
      setMyAttending(!!myAttendingRes.data);

      const previewProfiles: OwnerProfile[] = (((attendeePreviewRes.data ?? []) as AttendeePreviewRow[]) || [])
        .map((row) => singleRelation(row.profile))
        .filter(Boolean) as OwnerProfile[];

      setAttendeePreview(previewProfiles);
      setRelatedEvents(((relatedEventsRes.data ?? []) as RelatedEventRow[]) || []);

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
      setAttendeePreview([]);
      setRelatedEvents([]);
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
    if (!event || !isOwner) return;

    setBusy(true);

    try {
      await supabase.from(ATTENDEES_TABLE).delete().eq("event_id", event.id);
      await supabase.from(LOVES_TABLE).delete().eq("event_id", event.id);

      const { error } = await supabase.from("events").delete().eq("id", event.id);

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
    void syncAuthAndLoad();

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

          {isOwner ? (
            <div className="headerMenuWrap">
              {menuOpen ? (
                <button
                  className="menuBackdrop"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  type="button"
                />
              ) : null}

              <button
                className="iconBtn"
                type="button"
                aria-label="Event options"
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>

              {menuOpen ? (
                <div className="menuCard topMenu">
                  <button
                    className="menuItem"
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      router.push(`/event/${event?.id}/edit`);
                    }}
                  >
                    Edit event
                  </button>

                  {event?.link_url ? (
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
            <div className="topSpacer" />
          )}
        </header>

        {err && <div className="notice error">{err}</div>}
        {loading && <div className="notice">Loading…</div>}
        {!loading && !err && !event && <div className="notice error">Event not found.</div>}

        {!loading && event ? (
          <section className="eventCard">
            <div className="hero">
              {event.photo_url ? (
                <button className="heroButton" type="button" onClick={() => setOpenImg(event.photo_url!)}>
                  <img src={event.photo_url} alt={event.title} className="heroImage" />
                </button>
              ) : (
                <div className="heroFallback">
                  <div className="heroFallbackIcon">✦</div>
                  <div className="heroFallbackText">No flyer uploaded</div>
                </div>
              )}

              <div className="heroShade" />

              <div className="heroTop">
                <span className={`statePill ${chip.tone}`}>{chip.label}</span>

                {!isOwner ? (
                  <button
                    className={`heroActionBtn love ${myLoved ? "active" : ""}`}
                    type="button"
                    onClick={toggleLove}
                    disabled={busy}
                    aria-label="Love event"
                  >
                    <span>{myLoved ? "♥" : "♡"}</span>
                    <span className="loveTinyCount">{loveCount}</span>
                  </button>
                ) : (
                  <div className="heroOwnerSpacer" />
                )}
              </div>

              <div className="heroBottom">
                {heroMeta ? <div className="heroMeta">{heroMeta}</div> : null}
                <h1 className="heroTitle">{event.title}</h1>
                <div className="heroSchedule">{eventDateDisplay}</div>

                <div className="heroSocialRow">
                  <div className="heroStat">
                    <span className="heroStatIcon">👥</span>
                    <span className="heroStatText">{attendeeCount} going</span>
                  </div>

                  <div className="heroStat subtle">
                    <span className="heroStatIcon">♥</span>
                    <span className="heroStatText">{loveCount} loves</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="content">
              {actionCard ? (
                <div className="actionCard">
                  <div className="actionText">
                    <div className="actionTitle">{actionCard.title}</div>
                    <div className="actionBody">{actionCard.body}</div>
                  </div>

                  <div className="actionButtons">
                    <button
                      className="primaryBtn"
                      type="button"
                      disabled={actionCard.primaryDisabled || !!actionBusy}
                      onClick={() => {
                        if (actionCard.kind === "login") {
                          router.push("/me");
                          return;
                        }
                        if (actionCard.kind === "open") {
                          void attendEvent();
                        }
                      }}
                    >
                      {actionBusy === "attend" ? "Saving..." : actionCard.primary}
                    </button>

                    {actionCard.secondary ? (
                      <button
                        className="secondaryBtn"
                        type="button"
                        disabled={actionCard.secondaryDisabled || !!actionBusy}
                        onClick={() => {
                          if (actionCard.kind === "attending") {
                            void leaveEvent();
                            return;
                          }
                          if (event.link_url) {
                            window.open(event.link_url, "_blank", "noopener,noreferrer");
                          }
                        }}
                      >
                        {actionBusy === "leave" ? "Working..." : actionCard.secondary}
                      </button>
                    ) : null}

                    {"tertiary" in actionCard && actionCard.tertiary ? (
                      <button
                        className="secondaryBtn"
                        type="button"
                        disabled={actionCard.tertiaryDisabled || !!actionBusy}
                        onClick={() => {
                          if (event.link_url) {
                            window.open(event.link_url, "_blank", "noopener,noreferrer");
                          }
                        }}
                      >
                        {actionCard.tertiary}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="summaryGrid">
                <div className="summaryTile strong">
                  <div className="summaryLabel">Going</div>
                  <div className="summaryValue big">{attendeeCount}</div>
                  <div className="summarySub">People attending</div>
                </div>

                <div className="summaryTile">
                  <div className="summaryLabel">When</div>
                  <div className="summaryValue">{formatDateTime(event.starts_at)}</div>
                </div>

                <div className="summaryTile">
                  <div className="summaryLabel">Where</div>
                  <div className="summaryValue truncate">{event.location?.trim() || "Not set"}</div>
                </div>

                <div className="summaryTile">
                  <div className="summaryLabel">Category</div>
                  <div className="summaryValue">{eventCategoryLabel(event.category)}</div>
                </div>
              </div>

              <div className="section hostSection">
                <div className="sectionHead">
                  <div className="sectionTitle">Host</div>
                </div>

                <div className="hostCard">
                  <div className="hostLeft">
                    <div className="hostAvatar">{initials(hostOrgLabel)}</div>
                    <div className="hostCopy">
                      <div className="hostName">{hostOrgLabel}</div>
                      {!event.is_anonymous && postedByLabel ? (
                        <div className="hostMeta">Posted by {postedByLabel}</div>
                      ) : null}
                    </div>
                  </div>

                  {!event.is_anonymous && relatedEvents.length > 0 ? (
                    <div className="hostRight">
                      <span className="hostStatPill">
                        {relatedEvents.length}+ more event{relatedEvents.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {attendeePreview.length > 0 ? (
                <div className="section">
                  <div className="sectionHead">
                    <div className="sectionTitle">People going</div>
                    <div className="sectionMeta">{attendeeCount} total</div>
                  </div>

                  <div className="peopleRow">
                    {attendeePreview.map((person, idx) => {
                      const name = (person.full_name ?? "").trim() || `Guest ${idx + 1}`;
                      return (
                        <div className="personChip" key={`${name}-${idx}`}>
                          <div className="personAvatar">{initials(name)}</div>
                          <div className="personCopy">
                            <div className="personName">{name}</div>
                            <div className="personRole">{readableRole(person.user_role)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="section">
                <div className="sectionHead">
                  <div className="sectionTitle">Essentials</div>
                </div>

                <div className="detailList">
                  {essentials.map((row) => (
                    <div className="detailRow" key={row.label}>
                      <div className="detailLabel">{row.label}</div>
                      <div className="detailValue">{row.value}</div>
                    </div>
                  ))}

                  {event.link_url ? (
                    <div className="detailRow">
                      <div className="detailLabel">Link</div>
                      <button
                        className="inlineLink"
                        type="button"
                        onClick={() => window.open(event.link_url!, "_blank", "noopener,noreferrer")}
                      >
                        Open event link
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {event.description?.trim() ? (
                <div className="section">
                  <div className="sectionHead">
                    <div className="sectionTitle">About</div>
                  </div>
                  <div className="description">{event.description.trim()}</div>
                </div>
              ) : null}

              {!event.is_anonymous && relatedEvents.length > 0 ? (
                <div className="section">
                  <div className="sectionHead">
                    <div className="sectionTitle">More from this host</div>
                  </div>

                  <div className="relatedGrid">
                    {relatedEvents.map((rel) => (
                      <button
                        key={rel.id}
                        type="button"
                        className="relatedCard"
                        onClick={() => router.push(`/event/${rel.id}`)}
                      >
                        <div className="relatedMedia">
                          {rel.photo_url ? (
                            <img src={rel.photo_url} alt={rel.title} className="relatedImg" />
                          ) : (
                            <div className="relatedFallback">EVENT</div>
                          )}
                        </div>

                        <div className="relatedBody">
                          <div className="relatedTitle">{rel.title}</div>
                          <div className="relatedMeta">
                            {formatShortDate(rel.starts_at)} • {rel.location?.trim() || "Campus"}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="footerMeta">
                <span>Starts {formatShortDate(event.starts_at)}</span>
                {event.ends_at ? <span>Ends {formatShortDate(event.ends_at)}</span> : null}
                {event.is_cancelled ? <span className="dangerText">Cancelled</span> : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {confirmDelete ? (
        <div className="modal" onClick={() => setConfirmDelete(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete event?</div>
            <div className="modalText">This permanently removes the event and all attendee data.</div>

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
        <div className="imageModal" onClick={() => setOpenImg(null)}>
          <div className="imageCard" onClick={(e) => e.stopPropagation()}>
            <div className="imageTop">
              <div className="imageTitle">{event.title}</div>
              <button className="iconBtn small" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>

            <img src={openImg} alt={event.title} className="fullImage" />
          </div>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top, rgba(99, 102, 241, 0.06), transparent 32%),
            linear-gradient(180deg, #f8fafc 0%, #f3f4f6 100%);
          color: #0f172a;
          padding: 12px 12px 32px;
        }

        .shell {
          max-width: 760px;
          margin: 0 auto;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 40;
          display: grid;
          grid-template-columns: 42px 1fr 42px;
          align-items: center;
          gap: 10px;
          padding: 6px 0 14px;
          background: rgba(248, 250, 252, 0.9);
          backdrop-filter: blur(14px);
        }

        .topCenter {
          min-width: 0;
          text-align: center;
        }

        .topTitle {
          font-size: 16px;
          font-weight: 1000;
          line-height: 1.1;
          letter-spacing: -0.02em;
        }

        .topSub {
          margin-top: 2px;
          font-size: 12px;
          font-weight: 800;
          color: #64748b;
        }

        .topSpacer {
          width: 42px;
          height: 42px;
        }

        .headerMenuWrap {
          position: relative;
        }

        .iconBtn {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
        }

        .iconBtn.small {
          width: 38px;
          height: 38px;
          font-size: 16px;
        }

        .notice {
          margin-top: 6px;
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.92);
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.05);
        }

        .notice.error {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .eventCard {
          margin-top: 8px;
          overflow: hidden;
          border-radius: 30px;
          border: 1px solid rgba(226, 232, 240, 0.92);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
        }

        .hero {
          position: relative;
          min-height: 350px;
          background: #e5e7eb;
          overflow: hidden;
        }

        .heroButton {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .heroImage {
          display: block;
          width: 100%;
          height: 420px;
          object-fit: cover;
        }

        .heroFallback {
          height: 420px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          background:
            radial-gradient(circle at top, rgba(99, 102, 241, 0.18), transparent 34%),
            linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%);
          color: #fff;
        }

        .heroFallbackIcon {
          width: 62px;
          height: 62px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.12);
          font-size: 24px;
          font-weight: 900;
        }

        .heroFallbackText {
          font-size: 13px;
          font-weight: 800;
          opacity: 0.88;
        }

        .heroShade {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            rgba(15, 23, 42, 0.1) 0%,
            rgba(15, 23, 42, 0.16) 28%,
            rgba(15, 23, 42, 0.82) 100%
          );
          pointer-events: none;
        }

        .heroTop {
          position: absolute;
          top: 14px;
          left: 14px;
          right: 14px;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .heroOwnerSpacer {
          width: 42px;
          height: 42px;
        }

        .heroBottom {
          position: absolute;
          left: 16px;
          right: 16px;
          bottom: 16px;
          z-index: 2;
        }

        .heroMeta {
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.86);
        }

        .heroTitle {
          margin: 0;
          font-size: 30px;
          line-height: 1.02;
          font-weight: 1000;
          letter-spacing: -0.05em;
          color: #fff;
          text-wrap: balance;
          overflow-wrap: anywhere;
        }

        .heroSchedule {
          margin-top: 10px;
          font-size: 14px;
          font-weight: 850;
          color: rgba(255, 255, 255, 0.92);
        }

        .heroSocialRow {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .heroStat {
          min-height: 30px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #fff;
          backdrop-filter: blur(8px);
        }

        .heroStat.subtle {
          opacity: 0.9;
        }

        .heroStatIcon {
          font-size: 12px;
        }

        .heroStatText {
          font-size: 12px;
          font-weight: 900;
        }

        .statePill {
          min-height: 34px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.14);
          color: #fff;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.15);
        }

        .statePill.good {
          background: rgba(34, 197, 94, 0.18);
          border-color: rgba(187, 247, 208, 0.3);
        }

        .statePill.closed,
        .statePill.neutral {
          background: rgba(15, 23, 42, 0.24);
          border-color: rgba(255, 255, 255, 0.16);
        }

        .heroActionBtn {
          min-width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(10px);
          color: #fff;
          font-size: 22px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
          padding: 0 12px;
        }

        .heroActionBtn.love.active {
          color: #fecdd3;
          background: rgba(190, 24, 93, 0.18);
          border-color: rgba(251, 207, 232, 0.28);
        }

        .loveTinyCount {
          font-size: 12px;
          font-weight: 900;
          line-height: 1;
        }

        .menuBackdrop {
          position: fixed;
          inset: 0;
          border: 0;
          padding: 0;
          margin: 0;
          background: transparent;
          z-index: 39;
        }

        .menuCard {
          position: absolute;
          width: 220px;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.16);
          z-index: 41;
        }

        .menuCard.topMenu {
          top: calc(100% + 8px);
          right: 0;
        }

        .menuItem {
          width: 100%;
          border: 0;
          background: #fff;
          text-align: left;
          padding: 13px 14px;
          font-size: 13px;
          font-weight: 850;
          color: #0f172a;
          cursor: pointer;
        }

        .menuItem + .menuItem {
          border-top: 1px solid #eef2f7;
        }

        .menuItem.danger {
          color: #b91c1c;
        }

        .content {
          padding: 16px;
        }

        .actionCard {
          padding: 16px;
          border-radius: 22px;
          border: 1px solid #dbeafe;
          background: linear-gradient(180deg, rgba(239, 246, 255, 0.96) 0%, rgba(248, 250, 252, 0.96) 100%);
        }

        .actionText {
          min-width: 0;
        }

        .actionTitle {
          font-size: 15px;
          font-weight: 1000;
          color: #0f172a;
        }

        .actionBody {
          margin-top: 5px;
          font-size: 13px;
          line-height: 1.55;
          color: #475569;
          font-weight: 700;
        }

        .actionButtons {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .summaryGrid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .summaryTile {
          min-width: 0;
          padding: 14px;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }

        .summaryTile.strong {
          border-color: #dbeafe;
          background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
        }

        .summaryLabel {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #64748b;
        }

        .summaryValue {
          margin-top: 8px;
          font-size: 17px;
          line-height: 1.25;
          font-weight: 1000;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .summaryValue.big {
          font-size: 28px;
          letter-spacing: -0.03em;
        }

        .summarySub {
          margin-top: 5px;
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
        }

        .truncate {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .section {
          margin-top: 16px;
          padding: 16px;
          border-radius: 22px;
          border: 1px solid #e2e8f0;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }

        .sectionHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }

        .sectionTitle {
          font-size: 13px;
          font-weight: 1000;
          letter-spacing: 0.02em;
          color: #0f172a;
        }

        .sectionMeta {
          font-size: 12px;
          font-weight: 800;
          color: #64748b;
        }

        .hostCard {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
        }

        .hostLeft {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex: 1;
        }

        .hostAvatar {
          width: 48px;
          height: 48px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          background: linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%);
          border: 1px solid #dbe3f0;
          font-size: 14px;
          font-weight: 1000;
        }

        .hostCopy {
          min-width: 0;
          flex: 1;
        }

        .hostName {
          font-size: 15px;
          font-weight: 1000;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .hostMeta {
          margin-top: 4px;
          font-size: 13px;
          color: #64748b;
          font-weight: 700;
        }

        .hostStatPill {
          min-height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #334155;
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }

        .peopleRow {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }

        .personChip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 16px;
          background: #fff;
          border: 1px solid #e9edf3;
        }

        .personAvatar {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
          border: 1px solid #e2e8f0;
          font-size: 12px;
          font-weight: 1000;
        }

        .personCopy {
          min-width: 0;
          flex: 1;
        }

        .personName {
          font-size: 14px;
          font-weight: 900;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .personRole {
          margin-top: 2px;
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
        }

        .detailList {
          margin-top: 10px;
        }

        .detailRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 11px 0;
        }

        .detailRow + .detailRow {
          border-top: 1px solid #eef2f7;
        }

        .detailLabel {
          flex: 0 0 88px;
          font-size: 12px;
          font-weight: 900;
          color: #64748b;
        }

        .detailValue {
          flex: 1;
          min-width: 0;
          text-align: right;
          font-size: 13px;
          line-height: 1.5;
          font-weight: 850;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .inlineLink {
          border: 0;
          background: transparent;
          padding: 0;
          margin: 0;
          font-size: 13px;
          font-weight: 900;
          color: #2563eb;
          cursor: pointer;
          text-align: right;
        }

        .description {
          margin-top: 10px;
          font-size: 14px;
          line-height: 1.72;
          color: #334155;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .relatedGrid {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }

        .relatedCard {
          width: 100%;
          text-align: left;
          display: grid;
          grid-template-columns: 84px 1fr;
          gap: 12px;
          padding: 10px;
          border-radius: 18px;
          border: 1px solid #e9edf3;
          background: #fff;
          cursor: pointer;
        }

        .relatedMedia {
          width: 84px;
          height: 84px;
          overflow: hidden;
          border-radius: 14px;
          background: #eef2f7;
          border: 1px solid #e2e8f0;
        }

        .relatedImg {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .relatedFallback {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 1000;
          color: #475569;
        }

        .relatedBody {
          min-width: 0;
          align-self: center;
        }

        .relatedTitle {
          font-size: 14px;
          font-weight: 1000;
          color: #0f172a;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .relatedMeta {
          margin-top: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
          line-height: 1.45;
        }

        .footerMeta {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          color: #64748b;
          font-size: 12px;
          font-weight: 850;
        }

        .primaryBtn,
        .secondaryBtn {
          min-height: 44px;
          padding: 0 15px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .primaryBtn {
          border: 1px solid rgba(59, 130, 246, 0.22);
          background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
          color: #fff;
          box-shadow: 0 14px 28px rgba(37, 99, 235, 0.18);
        }

        .secondaryBtn {
          border: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.86);
          color: #0f172a;
        }

        .primaryBtn:disabled,
        .secondaryBtn:disabled {
          opacity: 0.58;
          cursor: not-allowed;
          box-shadow: none;
        }

        .dangerText {
          color: #b91c1c;
        }

        .modal,
        .imageModal {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(15, 23, 42, 0.56);
        }

        .modalCard,
        .imageCard {
          width: 100%;
          max-width: 560px;
          border-radius: 26px;
          border: 1px solid #e2e8f0;
          background: #fff;
          box-shadow: 0 34px 90px rgba(15, 23, 42, 0.2);
        }

        .modalCard {
          padding: 18px;
        }

        .modalTitle {
          font-size: 17px;
          font-weight: 1000;
          color: #0f172a;
        }

        .modalText {
          margin-top: 8px;
          font-size: 13px;
          line-height: 1.5;
          font-weight: 700;
          color: #475569;
        }

        .modalActions {
          margin-top: 16px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .ghostBtn,
        .dangerBtn {
          min-height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .ghostBtn {
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #0f172a;
        }

        .dangerBtn {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
        }

        .imageTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .imageTitle {
          min-width: 0;
          font-size: 13px;
          font-weight: 1000;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .fullImage {
          display: block;
          width: 100%;
          max-height: 80vh;
          object-fit: contain;
          background: #0f172a;
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 18px;
          transform: translateX(-50%);
          z-index: 120;
          max-width: calc(100vw - 24px);
          padding: 11px 14px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(10px);
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);
        }

        .toast.ok {
          border-color: #bbf7d0;
        }

        .toast.err {
          border-color: #fecdd3;
        }

        @media (max-width: 640px) {
          .hero,
          .heroImage,
          .heroFallback {
            min-height: 320px;
            height: 320px;
          }

          .heroTitle {
            font-size: 24px;
          }

          .content {
            padding: 14px;
          }

          .summaryGrid {
            gap: 8px;
          }

          .summaryTile,
          .section,
          .actionCard {
            border-radius: 20px;
          }

          .detailRow {
            flex-direction: column;
            gap: 4px;
          }

          .detailLabel {
            flex: 0 0 auto;
          }

          .detailValue,
          .inlineLink {
            text-align: left;
          }

          .actionButtons {
            display: grid;
            grid-template-columns: 1fr;
          }

          .primaryBtn,
          .secondaryBtn {
            width: 100%;
          }

          .relatedCard {
            grid-template-columns: 72px 1fr;
          }

          .relatedMedia {
            width: 72px;
            height: 72px;
          }
        }
      `}</style>
    </div>
  );
}