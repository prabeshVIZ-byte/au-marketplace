"use client";

export const dynamic = "force-dynamic";

import Image from "next/image";
import { Outfit } from "next/font/google";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const brandFont = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

type OwnerRole = "student" | "faculty" | null;
type PostType = "give" | "request" | null;

type FeedRowFromView = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  expires_at: string | null;
  interest_count: number | null;
  owner_role?: OwnerRole;
};

type ItemMeta = {
  id: string;
  owner_id: string | null;
  is_claimed: boolean | null;
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;
  status: string | null;
};

type FeedRow = FeedRowFromView & {
  owner_id: string | null;
  is_claimed: boolean | null;
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;
};

type EventCategory =
  | "club"
  | "sports"
  | "party"
  | "career"
  | "volunteering"
  | "workshop"
  | "campus"
  | "other"
  | string;

type EventRow = {
  id: string;
  title: string;
  description: string;
  host_org: string;
  category: EventCategory;
  location: string;
  starts_at: string;
  ends_at: string | null;
  link_url: string | null;
  photo_url: string | null;
  is_anonymous: boolean | null;
  created_by: string | null;
  created_at?: string | null;
};

type MyInterestStatus =
  | "pending"
  | "reserved"
  | "accepted"
  | "completed"
  | "declined"
  | "withdrawn"
  | string;

type AuthState = {
  userId: string | null;
  userEmail: string | null;
  isAshland: boolean;
  isLoggedIn: boolean;
};

const NAV_APPROX_HEIGHT = 86;
const PAGE_BOTTOM_PAD = NAV_APPROX_HEIGHT + 28;
const ATTEND_TABLE = "event_attendees";

function isAshlandEmail(email: string | null) {
  return !!email && email.toLowerCase().endsWith("@ashland.edu");
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= Date.now();
}

function isItemClosed(item: FeedRow) {
  const st = normStatus(item.status);
  return !!item.is_claimed || st === "claimed" || st === "completed" || st === "expired";
}

function itemPublicStatus(item: FeedRow): "open" | "in_talks" | "closed" {
  const st = normStatus(item.status);

  if (isItemClosed(item) || isExpired(item.expires_at)) return "closed";
  if (st === "reserved" || st === "accepted" || st === "in_talks" || st === "hold") return "in_talks";
  return "open";
}

function itemBadgeLabel(item: FeedRow) {
  const pt = (item.post_type ?? "give") as PostType;
  if (pt === "request") return "REQUEST";

  const publicState = itemPublicStatus(item);
  if (publicState === "closed") return "CLOSED";
  if (publicState === "in_talks") return "IN TALKS";
  return "AVAILABLE";
}

function itemHint(item: FeedRow) {
  const pt = (item.post_type ?? "give") as PostType;
  if (pt === "request") return "";

  const publicState = itemPublicStatus(item);
  if (publicState === "in_talks") return "Someone is already being considered • Waitlist open";
  return "";
}

function requestGroupLabel(g: string | null | undefined) {
  const k = (g ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  return "Request";
}

function requestTimeframeLabel(t: string | null | undefined) {
  const k = (t ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

function myInterestLabel(status: MyInterestStatus | null | undefined) {
  const st = normStatus(status);
  if (st === "accepted") return "Accepted";
  if (st === "reserved") return "Reserved";
  if (st === "completed") return "Completed";
  if (st === "declined") return "Declined";
  if (st === "withdrawn") return "Withdrawn";
  if (st === "pending") return "Requested";
  return "Requested";
}

function isActiveInterestStatus(status: MyInterestStatus | null | undefined) {
  const st = normStatus(status);
  return st === "pending" || st === "reserved" || st === "accepted";
}

function formatShortDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimeRange(startsAtISO: string, endsAtISO: string | null) {
  const s = new Date(startsAtISO);
  if (Number.isNaN(s.getTime())) return "";

  const sameDay = endsAtISO ? new Date(endsAtISO).toDateString() === s.toDateString() : true;
  const day = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const st = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (!endsAtISO) return `${day} • ${st}`;

  const e = new Date(endsAtISO);
  if (Number.isNaN(e.getTime())) return `${day} • ${st}`;

  const et = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `${day} • ${st}–${et}`;

  const endDay = e.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${st} → ${endDay} ${et}`;
}

async function getAuthState(): Promise<AuthState> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;
  const isAshland = isAshlandEmail(userEmail);

  return {
    userId,
    userEmail,
    isAshland,
    isLoggedIn: !!userId && !!userEmail && isAshland,
  };
}

export default function FeedPage() {
  const router = useRouter();

  const [auth, setAuth] = useState<AuthState>({
    userId: null,
    userEmail: null,
    isAshland: false,
    isLoggedIn: false,
  });

  const [items, setItems] = useState<FeedRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [errItems, setErrItems] = useState<string | null>(null);
  const [errEvents, setErrEvents] = useState<string | null>(null);

  const [myInterestMap, setMyInterestMap] = useState<Record<string, MyInterestStatus>>({});
  const [myAttending, setMyAttending] = useState<Record<string, boolean>>({});
  const [savingAttendId, setSavingAttendId] = useState<string | null>(null);

  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState("");

  const [tab, setTab] = useState<"items" | "requests" | "events">("items");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [searchFocused, setSearchFocused] = useState(false);
  const [searchPulse, setSearchPulse] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const chipRowRef = useRef<HTMLDivElement | null>(null);

  async function loadOwnerMeta(itemIds: string[]) {
    if (itemIds.length === 0) return new Map<string, ItemMeta>();

    const { data, error } = await supabase
      .from("items")
      .select("id,owner_id,is_claimed,post_type,request_group,request_timeframe,request_location,status")
      .in("id", itemIds);

    if (error) return new Map<string, ItemMeta>();

    const map = new Map<string, ItemMeta>();
    for (const row of ((data as ItemMeta[]) || [])) {
      map.set(row.id, row);
    }
    return map;
  }

  async function loadMyInterestStatuses(userId: string, itemIds: string[]) {
    if (itemIds.length === 0) {
      setMyInterestMap({});
      return;
    }

    const { data, error } = await supabase
      .from("interests")
      .select("item_id,status")
      .eq("user_id", userId)
      .in("item_id", itemIds);

    if (error) {
      setMyInterestMap({});
      return;
    }

    const next: Record<string, MyInterestStatus> = {};
    for (const row of ((data as Array<{ item_id: string; status: MyInterestStatus }>) || [])) {
      next[String(row.item_id)] = row.status ?? "pending";
    }
    setMyInterestMap(next);
  }

  async function loadMyAttendanceMap(userId: string, eventIds: string[]) {
    if (eventIds.length === 0) {
      setMyAttending({});
      return;
    }

    const { data, error } = await supabase
      .from(ATTEND_TABLE)
      .select("event_id")
      .eq("user_id", userId)
      .in("event_id", eventIds);

    if (error) {
      setMyAttending({});
      return;
    }

    const next: Record<string, boolean> = {};
    for (const row of ((data as Array<{ event_id: string }>) || [])) {
      next[String(row.event_id)] = true;
    }
    setMyAttending(next);
  }

  async function loadFeedItems(nextAuth: AuthState) {
    setLoadingItems(true);
    setErrItems(null);

    try {
      const { data, error } = await supabase
        .from("v_feed_items")
        .select("id,title,description,category,status,created_at,photo_url,expires_at,interest_count,owner_role")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || "Error loading feed.");

      const baseRows = ((data as FeedRowFromView[]) || []).map((row) => ({ ...row }));
      const ids = baseRows.map((row) => row.id);
      const meta = await loadOwnerMeta(ids);

      const merged: FeedRow[] = baseRows.map((row) => {
        const m = meta.get(row.id);
        return {
          ...row,
          owner_id: m?.owner_id ?? null,
          is_claimed: m?.is_claimed ?? null,
          post_type: (m?.post_type ?? "give") as PostType,
          request_group: m?.request_group ?? null,
          request_timeframe: m?.request_timeframe ?? null,
          request_location: m?.request_location ?? null,
          status: m?.status ?? row.status ?? "available",
          interest_count: row.interest_count ?? 0,
        };
      });

      const visible = merged.filter((item) => {
        if (isItemClosed(item)) return false;
        if (isExpired(item.expires_at)) return false;
        return true;
      });

      setItems(visible);

      const giveIds = visible
        .filter((item) => (item.post_type ?? "give") === "give")
        .map((item) => item.id);

      if (nextAuth.isLoggedIn && nextAuth.userId) {
        await loadMyInterestStatuses(nextAuth.userId, giveIds);
      } else {
        setMyInterestMap({});
      }
    } catch (e: any) {
      setItems([]);
      setMyInterestMap({});
      setErrItems(e?.message || "Error loading feed.");
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadFeedEvents(nextAuth: AuthState) {
    setLoadingEvents(true);
    setErrEvents(null);

    try {
      const nowMinus6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("events")
        .select("id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,created_by,created_at")
        .gte("starts_at", nowMinus6h)
        .order("starts_at", { ascending: true });

      if (error) throw new Error(error.message || "Error loading events.");

      const rows = (data as EventRow[]) || [];
      setEvents(rows);

      if (nextAuth.isLoggedIn && nextAuth.userId) {
        await loadMyAttendanceMap(nextAuth.userId, rows.map((e) => e.id));
      } else {
        setMyAttending({});
      }
    } catch (e: any) {
      setEvents([]);
      setMyAttending({});
      setErrEvents(e?.message || "Error loading events.");
    } finally {
      setLoadingEvents(false);
    }
  }

  async function refreshAll(nextAuth?: AuthState) {
    const resolvedAuth = nextAuth ?? (await getAuthState());
    setAuth(resolvedAuth);
    await Promise.all([loadFeedItems(resolvedAuth), loadFeedEvents(resolvedAuth)]);
  }

  async function onAttendToggle(ev: EventRow) {
    if (!auth.isLoggedIn || !auth.userId) {
      router.push("/me");
      return;
    }

    const isMine = !!ev.created_by && ev.created_by === auth.userId;
    if (isMine) return;

    const already = myAttending[ev.id] === true;
    setSavingAttendId(ev.id);

    try {
      if (already) {
        const { error } = await supabase
          .from(ATTEND_TABLE)
          .delete()
          .eq("event_id", ev.id)
          .eq("user_id", auth.userId);

        if (error) throw new Error(error.message);
        setMyAttending((prev) => ({ ...prev, [ev.id]: false }));
        return;
      }

      const { error } = await supabase
        .from(ATTEND_TABLE)
        .insert([{ event_id: ev.id, user_id: auth.userId }]);

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          setMyAttending((prev) => ({ ...prev, [ev.id]: true }));
          return;
        }
        throw new Error(error.message);
      }

      setMyAttending((prev) => ({ ...prev, [ev.id]: true }));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingAttendId(null);
    }
  }

  useEffect(() => {
    if (!query) return;
    setSearchPulse(true);
    const t = setTimeout(() => setSearchPulse(false), 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setQuery("");
    setCategoryFilter("all");
    setFiltersOpen(false);

    if (tab === "events") {
      setSort("newest");
    }
  }, [tab]);

  useEffect(() => {
    refreshAll();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const nextAuth: AuthState = {
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        isAshland: isAshlandEmail(session?.user?.email ?? null),
        isLoggedIn:
          !!session?.user?.id &&
          !!session?.user?.email &&
          isAshlandEmail(session?.user?.email ?? null),
      };

      await refreshAll(nextAuth);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenImg(null);
        setFiltersOpen(false);
      }

      if (e.key === "/" && !openImg) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openImg]);

  useEffect(() => {
    const el = chipRowRef.current;
    if (!el) return;

    let down = false;
    let startX = 0;
    let startLeft = 0;

    const onPointerDown = (e: PointerEvent) => {
      down = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      el.scrollLeft = startLeft - dx;
    };

    const onPointerUp = () => {
      down = false;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if ((item.post_type ?? "give") !== "give") continue;
      const c = (item.category ?? "").trim();
      if (c) set.add(c);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const tabbedItems = useMemo(() => {
    return items.filter((item) => {
      const pt = (item.post_type ?? "give") as PostType;
      if (tab === "items") return pt !== "request";
      if (tab === "requests") return pt === "request";
      return false;
    });
  }, [items, tab]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = tabbedItems.filter((item) => {
      const pt = (item.post_type ?? "give") as PostType;

      if (roleFilter !== "all") {
        const r = (item.owner_role ?? null) as OwnerRole;
        if (!r || r !== roleFilter) return false;
      }

      if (tab === "items" && pt !== "request") {
        if (categoryFilter !== "all" && (item.category ?? "") !== categoryFilter) return false;
      }

      if (q) {
        const blob = [
          item.title,
          item.description ?? "",
          item.category ?? "",
          item.request_group ?? "",
          item.request_timeframe ?? "",
          item.request_location ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (!blob.includes(q)) return false;
      }

      return true;
    });

    if (sort === "popular") {
      list = [...list].sort((a, b) => (b.interest_count || 0) - (a.interest_count || 0));
    } else {
      list = [...list].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return list;
  }, [tabbedItems, query, sort, roleFilter, categoryFilter, tab]);

  const filteredEvents = useMemo(() => {
    if (tab !== "events") return [];

    const q = query.trim().toLowerCase();
    let list = [...events];

    if (q) {
      list = list.filter((e) => {
        const blob = [
          e.title,
          e.description,
          e.host_org,
          e.category ?? "",
          e.location,
          e.link_url ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return blob.includes(q);
      });
    }

    list = list.sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

    return list;
  }, [tab, events, query]);

  const showingCount = tab === "events" ? filteredEvents.length : filteredItems.length;
  const loading = tab === "events" ? loadingEvents : loadingItems;
  const err = tab === "events" ? errEvents : errItems;

  return (
    <div className={`${brandFont.className} page`}>
      <header className="topbar">
        <div className="row brandRow">
          <button className="iconBtn" onClick={() => router.push("/feed")} aria-label="Home" type="button">
            <Image src="/scholarswap-logo.png" alt="ScholarSwap" width={34} height={34} priority className="logoImg" />
          </button>

          <div className="brandCenter" role="heading" aria-level={1}>
            <span className="brandName">ScholarSwap</span>
            <Image
              src="/Ashland_Eagles_logo.svg.png"
              alt="Ashland University"
              width={18}
              height={18}
              priority
              className="brandMark"
            />
          </div>

          <button className="plusBtn" onClick={() => router.push("/create")} aria-label="Create" type="button">
            +
          </button>
        </div>

        <div className="row tabsRow">
          <div className="seg3" role="tablist" aria-label="Feed tabs">
            <button className={`segBtn ${tab === "items" ? "active" : ""}`} onClick={() => setTab("items")} type="button">
              Items
            </button>
            <button className={`segBtn ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")} type="button">
              Requests
            </button>
            <button className={`segBtn ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")} type="button">
              Events
            </button>
            <span
              className={`segIndicator3 ${tab === "items" ? "pos0" : tab === "requests" ? "pos1" : "pos2"}`}
              aria-hidden="true"
            />
          </div>

          <button
            className={`ctrlBtn ${filtersOpen ? "ctrlActive" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            type="button"
            aria-label="Open filters"
            title="Filters"
          >
            <span className="ctrlIcon">≡</span>
          </button>
        </div>

        <div className={`row searchWrap ${searchFocused ? "searchFocused" : ""} ${searchPulse ? "searchPulse" : ""}`}>
          <div className="searchRow">
            <button
              type="button"
              className="searchIconBtn"
              aria-label="Focus search"
              onClick={() => searchRef.current?.focus()}
              title="Search"
            >
              🔎
            </button>

            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={
                tab === "events"
                  ? "Search events, hosts, locations…"
                  : tab === "items"
                  ? "Search items, categories…"
                  : "Search requests, locations…"
              }
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {query ? (
              <button className="clearBtn" onClick={() => setQuery("")} type="button" aria-label="Clear search">
                ✕
              </button>
            ) : (
              <div className="kbdHint" aria-hidden="true">
                /
              </div>
            )}
          </div>

          {tab === "items" && (
            <div className="chipRow" ref={chipRowRef} aria-label="Categories">
              {categories.map((c) => {
                const active = categoryFilter === c;
                const label = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);

                return (
                  <button
                    key={c}
                    className={`chip ${active ? "chipOn" : ""}`}
                    onClick={() => setCategoryFilter(c)}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="subline">
          <div className="subTitle">
            {tab === "items" ? "Public Items" : tab === "requests" ? "Public Requests" : "Campus Events"}
          </div>
          <div className="count">
            Showing <b>{showingCount}</b>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        {loading && <div className="loading">Loading…</div>}
      </header>

      {filtersOpen && (
        <div className="sheetBackdrop" onClick={() => setFiltersOpen(false)} role="dialog" aria-modal="true">
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheetTop">
              <div className="sheetTitle">Filters</div>
              <button className="sheetClose" onClick={() => setFiltersOpen(false)} type="button" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="sheetGrid">
              <div className="sheetBlock">
                <div className="sheetLabel">Sort</div>
                <div className="togRow">
                  <button className={`tog ${sort === "newest" ? "togOn" : ""}`} onClick={() => setSort("newest")} type="button">
                    ↕️ {tab === "events" ? "Soonest" : "Newest"}
                  </button>

                  {tab !== "events" && (
                    <button className={`tog ${sort === "popular" ? "togOn" : ""}`} onClick={() => setSort("popular")} type="button">
                      🔥 Popular
                    </button>
                  )}
                </div>
              </div>

              {tab !== "events" && (
                <div className="sheetBlock">
                  <div className="sheetLabel">Lister</div>
                  <div className="togRow">
                    <button className={`tog ${roleFilter === "all" ? "togOn" : ""}`} onClick={() => setRoleFilter("all")} type="button">
                      👤 All
                    </button>
                    <button className={`tog ${roleFilter === "student" ? "togOn" : ""}`} onClick={() => setRoleFilter("student")} type="button">
                      🎓 Student
                    </button>
                    <button className={`tog ${roleFilter === "faculty" ? "togOn" : ""}`} onClick={() => setRoleFilter("faculty")} type="button">
                      🧑‍🏫 Faculty
                    </button>
                  </div>
                </div>
              )}

              <div className="sheetActions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setSort("newest");
                    setRoleFilter("all");
                    setCategoryFilter("all");
                    setQuery("");
                  }}
                >
                  Reset
                </button>
                <button className="primary" type="button" onClick={() => setFiltersOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="main">
        <div className="grid">
          {tab === "events" &&
            filteredEvents.map((ev) => {
              const isMine = !!auth.userId && !!ev.created_by && ev.created_by === auth.userId;
              const attending = myAttending[ev.id] === true;

              return (
                <article key={ev.id} className="card cardEvent">
                  <div className="media">
                    <div className="badge badgeEvent">EVENT</div>

                    {ev.photo_url ? (
                      <button
                        className="mediaBtn"
                        onClick={() => {
                          setOpenImg(ev.photo_url!);
                          setOpenTitle(ev.title);
                        }}
                        aria-label="Open flyer"
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ev.photo_url} alt={ev.title} loading="lazy" className="mediaImg" />
                      </button>
                    ) : (
                      <div className="noPhoto">No flyer</div>
                    )}
                  </div>

                  <div className="body">
                    <div className="metaRow">
                      <span className="meta">Host: {ev.is_anonymous ? "Anonymous" : ev.host_org}</span>
                      <span className="meta">• {String(ev.category || "other")}</span>
                      {isMine ? <span className="mine">Yours</span> : null}
                    </div>

                    <div className="title">{ev.title}</div>

                    <div className="hint">
                      {formatTimeRange(ev.starts_at, ev.ends_at)} • {ev.location}
                    </div>

                    <div className="desc clamp2">{ev.description}</div>

                    <div className="footerRow">
                      <span className="small">{ev.link_url ? "Link included" : "No link"}</span>
                      <span className="small">Starts: {formatShortDate(ev.starts_at)}</span>
                    </div>

                    <div className="actions">
                      <button className="btn btnGhost" onClick={() => router.push(`/event/${ev.id}`)} type="button">
                        View
                      </button>

                      <button
                        className={`btn btnPrimary ${isMine ? "btnDisabled" : attending ? "btnOn" : ""}`}
                        onClick={() => onAttendToggle(ev)}
                        disabled={savingAttendId === ev.id || isMine}
                        type="button"
                      >
                        {isMine
                          ? "Yours"
                          : savingAttendId === ev.id
                          ? "Saving…"
                          : auth.isLoggedIn
                          ? attending
                            ? "Attending"
                            : "Attend"
                          : "Attend (login)"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

          {tab !== "events" &&
            filteredItems.map((item) => {
              const postType = (item.post_type ?? "give") as PostType;
              const isMine = !!auth.userId && !!item.owner_id && item.owner_id === auth.userId;
              const myStatus = myInterestMap[item.id];
              const mineActive = isActiveInterestStatus(myStatus);
              const publicState = itemPublicStatus(item);

              const group = requestGroupLabel(item.request_group);
              const tf = requestTimeframeLabel(item.request_timeframe);
              const loc = (item.request_location ?? "").trim();

              return (
                <article key={item.id} className={`card ${postType === "request" ? "cardRequest" : ""}`}>
                  {postType === "request" ? (
                    <div className="reqHero">
                      <div className="badge badgeRequest">{itemBadgeLabel(item)}</div>
                      <div className="reqMeta">
                        {group}
                        {tf ? ` • ${tf}` : ""}
                        {loc ? ` • ${loc}` : ""}
                      </div>
                      <div className="title clamp2">{item.title}</div>
                    </div>
                  ) : (
                    <div className="media">
                      <div className={`badge ${publicState === "in_talks" ? "badgeTalks" : "badgeItem"}`}>
                        {itemBadgeLabel(item)}
                      </div>

                      {item.photo_url ? (
                        <button
                          className="mediaBtn"
                          onClick={() => {
                            setOpenImg(item.photo_url!);
                            setOpenTitle(item.title);
                          }}
                          aria-label="Open photo"
                          type="button"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.photo_url} alt={item.title} loading="lazy" className="mediaImg" />
                        </button>
                      ) : (
                        <div className="noPhoto">No photo</div>
                      )}
                    </div>
                  )}

                  <div className="body">
                    <div className="metaRow">
                      <span className="meta">
                        {postType === "request"
                          ? `Type: ${group}`
                          : item.category
                          ? `Category: ${item.category}`
                          : "Category: —"}
                      </span>
                      {item.owner_role ? <span className="meta">• {item.owner_role}</span> : null}
                      {isMine ? <span className="mine">Yours</span> : null}
                    </div>

                    {postType !== "request" ? <div className="title">{item.title}</div> : null}

                    {postType !== "request" && itemHint(item) ? (
                      <div className="hint">{itemHint(item)}</div>
                    ) : null}

                    <div className="desc clamp2">{item.description || "—"}</div>

                    <div className="footerRow">
                      {postType === "request" ? (
                        <span className="small">Tap to offer help</span>
                      ) : (
                        <span className="small">{item.interest_count || 0} requests</span>
                      )}
                      {item.expires_at ? <span className="small">Ends: {formatShortDate(item.expires_at)}</span> : null}
                    </div>

                    <div className="actions">
                      <button className="btn btnGhost" onClick={() => router.push(`/item/${item.id}`)} type="button">
                        View
                      </button>

                      <button
                        className={`btn btnPrimary ${isMine ? "btnDisabled" : ""} ${
                          postType !== "request" && mineActive ? "btnOn" : ""
                        }`}
                        onClick={() => router.push(auth.isLoggedIn ? `/item/${item.id}` : "/me")}
                        disabled={isMine}
                        type="button"
                      >
                        {isMine
                          ? "Yours"
                          : postType === "request"
                          ? auth.isLoggedIn
                            ? "Offer help"
                            : "Offer (login)"
                          : auth.isLoggedIn
                          ? mineActive
                            ? myInterestLabel(myStatus)
                            : publicState === "in_talks"
                            ? "Join waitlist"
                            : "Request"
                          : "Request (login)"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
        </div>
      </main>

      {openImg && (
        <div className="modal" onClick={() => setOpenImg(null)} role="dialog" aria-modal="true">
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">{openTitle || "Photo"}</div>
              <button className="modalClose" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={openTitle || "Full photo"} className="modalImg" />
          </div>
        </div>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f7f7f8;
          color: #0f172a;
        }

        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(247, 247, 248, 0.86);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid #e5e7eb;
        }

        .row {
          padding: 10px 12px;
        }

        .brandRow {
          display: grid;
          grid-template-columns: 44px 1fr 44px;
          align-items: center;
          gap: 10px;
          padding-top: 12px;
          padding-bottom: 8px;
        }

        .iconBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          overflow: hidden;
          background: #fff;
          border: 1px solid #e5e7eb;
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .logoImg {
          width: 34px;
          height: 34px;
          object-fit: contain;
        }

        .brandCenter {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 0;
        }

        .brandName {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.6px;
          white-space: nowrap;
          color: #0f172a;
        }

        .brandMark {
          opacity: 0.9;
          transform: translateY(1px);
        }

        .plusBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
          font-size: 24px;
          font-weight: 900;
          display: grid;
          place-items: center;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }

        .plusBtn:active {
          transform: translateY(1px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
        }

        .tabsRow {
          display: grid;
          grid-template-columns: 1fr 46px;
          gap: 10px;
          align-items: center;
          padding-top: 6px;
          padding-bottom: 6px;
        }

        .seg3 {
          position: relative;
          height: 44px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #f3f4f6;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          overflow: hidden;
        }

        .segBtn {
          border: none;
          background: transparent;
          color: #374151;
          font-weight: 950;
          cursor: pointer;
          z-index: 2;
          transition: color 0.18s ease;
        }

        .segBtn.active {
          color: #111827;
        }

        .segIndicator3 {
          position: absolute;
          top: 3px;
          bottom: 3px;
          width: calc(33.333% - 6px);
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
          transition: transform 0.22s ease;
          z-index: 1;
        }

        .segIndicator3.pos0 {
          transform: translateX(3px);
        }
        .segIndicator3.pos1 {
          transform: translateX(calc(100% + 3px));
        }
        .segIndicator3.pos2 {
          transform: translateX(calc(200% + 3px));
        }

        .ctrlBtn {
          width: 46px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
          transition: transform 0.12s ease, border-color 0.18s ease, background 0.18s ease;
        }

        .ctrlBtn:active {
          transform: translateY(1px);
        }

        .ctrlActive {
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.08);
        }

        .ctrlIcon {
          font-size: 18px;
          font-weight: 900;
          opacity: 0.9;
        }

        .searchWrap {
          padding-top: 6px;
          padding-bottom: 10px;
        }

        .searchRow {
          height: 46px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          display: grid;
          grid-template-columns: 40px 1fr 40px;
          align-items: center;
          gap: 8px;
          padding: 0 6px;
          margin: 0;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .searchFocused .searchRow {
          border-color: rgba(16, 185, 129, 0.35);
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1), 0 10px 24px rgba(0, 0, 0, 0.06);
        }

        .searchPulse .searchRow {
          animation: glow 0.22s ease-out;
        }

        @keyframes glow {
          from {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.18), 0 10px 24px rgba(0, 0, 0, 0.06);
          }
          to {
            box-shadow: 0 0 0 10px rgba(16, 185, 129, 0), 0 10px 24px rgba(0, 0, 0, 0.06);
          }
        }

        .searchIconBtn {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          cursor: pointer;
          display: grid;
          place-items: center;
          transition: transform 0.12s ease;
        }

        .searchIconBtn:active {
          transform: translateY(1px);
        }

        .searchRow input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #111827;
          font-weight: 900;
          font-size: 14px;
        }

        .searchRow input::placeholder {
          color: #6b7280;
          font-weight: 800;
        }

        .clearBtn,
        .kbdHint {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          display: grid;
          place-items: center;
          font-weight: 950;
        }

        .clearBtn {
          cursor: pointer;
          transition: transform 0.12s ease;
        }

        .clearBtn:active {
          transform: translateY(1px);
        }

        .kbdHint {
          background: #ffffff;
          color: #9ca3af;
        }

        .chipRow {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 6px;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          scrollbar-width: none;
        }

        .chipRow::-webkit-scrollbar {
          display: none;
        }

        .chip {
          flex: 0 0 auto;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          padding: 10px 12px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .chipOn {
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.1);
          color: #065f46;
        }

        .subline {
          padding: 0 12px 10px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .subTitle {
          font-size: 13px;
          font-weight: 950;
          color: #111827;
        }

        .count {
          font-size: 12px;
          color: #6b7280;
          font-weight: 900;
        }

        .err {
          padding: 0 12px 10px;
          color: #b91c1c;
          font-weight: 900;
        }

        .loading {
          padding: 0 12px 10px;
          color: #6b7280;
          font-weight: 800;
        }

        .sheetBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.35);
          z-index: 9998;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 12px;
        }

        .sheet {
          width: min(720px, 100%);
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(14px);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.12);
          overflow: hidden;
        }

        .sheetTop {
          padding: 12px 12px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e5e7eb;
        }

        .sheetTitle {
          font-weight: 950;
          font-size: 14px;
          color: #111827;
        }

        .sheetClose {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          cursor: pointer;
          font-weight: 950;
        }

        .sheetGrid {
          padding: 12px;
          display: grid;
          gap: 12px;
        }

        .sheetBlock {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 16px;
          padding: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
        }

        .sheetLabel {
          font-size: 12px;
          font-weight: 950;
          color: #6b7280;
          margin-bottom: 10px;
        }

        .togRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .tog {
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          padding: 10px 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .togOn {
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.1);
          color: #065f46;
        }

        .sheetActions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .ghost {
          height: 44px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          font-weight: 950;
          cursor: pointer;
        }

        .primary {
          height: 44px;
          border-radius: 14px;
          border: none;
          background: #10b981;
          color: #ffffff;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(16, 185, 129, 0.2);
        }

        .main {
          padding: 14px 12px ${PAGE_BOTTOM_PAD}px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }

        @media (min-width: 720px) {
          .main {
            padding: 16px 16px ${PAGE_BOTTOM_PAD}px;
            max-width: 1100px;
            margin: 0 auto;
          }
          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }
        }

        .card {
          background: #ffffff;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          overflow: hidden;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
        }

        .cardRequest {
          border: 1px solid rgba(16, 185, 129, 0.25);
        }

        .cardEvent {
          border: 1px solid rgba(59, 130, 246, 0.18);
        }

        .media {
          position: relative;
          height: 210px;
          background: #f3f4f6;
        }

        .mediaBtn {
          width: 100%;
          height: 100%;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
        }

        .mediaImg {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .noPhoto {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #6b7280;
          font-weight: 800;
        }

        .reqHero {
          position: relative;
          height: 210px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          background: rgba(16, 185, 129, 0.08);
        }

        .badge {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.85);
          color: #111827;
        }

        .badgeRequest,
        .badgeItem {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }

        .badgeTalks {
          border-color: rgba(59, 130, 246, 0.25);
          background: rgba(59, 130, 246, 0.12);
          color: #1d4ed8;
        }

        .badgeEvent {
          border-color: rgba(59, 130, 246, 0.25);
          background: rgba(59, 130, 246, 0.12);
          color: #1e3a8a;
        }

        .reqMeta {
          font-size: 13px;
          font-weight: 900;
          color: #374151;
          margin-bottom: 8px;
        }

        .body {
          padding: 14px;
        }

        .metaRow {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .meta {
          font-size: 12px;
          color: #6b7280;
          font-weight: 800;
        }

        .mine {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          font-weight: 900;
        }

        .title {
          margin-top: 8px;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: -0.2px;
          color: #111827;
        }

        .hint {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 900;
          color: #065f46;
        }

        .desc {
          margin-top: 10px;
          color: #374151;
          font-size: 14px;
          min-height: 40px;
        }

        .footerRow {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: #6b7280;
          font-weight: 900;
          font-size: 12px;
        }

        .small {
          font-size: 12px;
        }

        .actions {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .btn {
          width: 100%;
          padding: 10px 12px;
          border-radius: 14px;
          cursor: pointer;
          font-weight: 950;
          border: 1px solid #e5e7eb;
          transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
        }

        .btn:active {
          transform: translateY(1px);
        }

        .btnGhost {
          background: #ffffff;
          color: #111827;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .btnPrimary {
          border: none;
          background: #10b981;
          color: #ffffff;
          box-shadow: 0 14px 30px rgba(16, 185, 129, 0.2);
        }

        .btnOn {
          background: rgba(16, 185, 129, 0.14);
          color: #065f46;
          border: 1px solid rgba(16, 185, 129, 0.35);
          box-shadow: 0 10px 22px rgba(16, 185, 129, 0.14);
        }

        .btnDisabled {
          opacity: 0.6;
          cursor: not-allowed;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          color: #6b7280;
          box-shadow: none;
        }

        .clamp2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .modal {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
        }

        .modalInner {
          width: min(1000px, 95vw);
          max-height: 90vh;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.2);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #e5e7eb;
        }

        .modalTitle {
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #111827;
        }

        .modalClose {
          background: #ffffff;
          color: #111827;
          border: 1px solid #e5e7eb;
          padding: 6px 10px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
        }

        .modalImg {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #0b0f19;
        }
      `}</style>
    </div>
  );
}