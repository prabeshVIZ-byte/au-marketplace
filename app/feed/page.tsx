"use client";

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
  interest_count: number;
  owner_role?: OwnerRole;

  post_type?: PostType;
  request_group?: string | null;
  request_timeframe?: string | null;
  request_location?: string | null;
};

type ItemMeta = {
  id: string;
  owner_id: string | null;
  is_claimed: boolean | null;
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;
  status?: string | null;
};

type FeedRow = FeedRowFromView & {
  owner_id?: string | null;
  is_claimed?: boolean | null;
  post_type?: PostType;
};

function formatShortDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normStatus(s: string | null | undefined) {
  return (s ?? "available").toLowerCase().trim();
}

// Feed rule: show everything except completed/claimed.
// Also: while reserved/in talk, still show AVAILABLE label (waitlist open).
function statusLabel(status: string | null, postType: PostType) {
  if ((postType ?? "give") === "request") return "REQUEST";
  const st = normStatus(status);
  if (st === "claimed") return "CLAIMED";
  return "AVAILABLE";
}

function statusHint(status: string | null, postType: PostType) {
  if ((postType ?? "give") === "request") return "";
  const st = normStatus(status);
  if (st === "reserved") return "In talks • Waitlist open";
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

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function FeedPage() {
  const router = useRouter();

  const [items, setItems] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [myInterested, setMyInterested] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // image modal
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState<string>("");

  // UI state
  const [tab, setTab] = useState<"items" | "requests">("items");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // search delight
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchPulse, setSearchPulse] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // chips row
  const chipRowRef = useRef<HTMLDivElement | null>(null);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  const isAshland = !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  const isLoggedIn = !!userId && !!userEmail && isAshland;

  async function loadMyInterestMap(uid: string, itemIds: string[]) {
    if (itemIds.length === 0) return;
    const { data, error } = await supabase
      .from("interests")
      .select("item_id")
      .eq("user_id", uid)
      .in("item_id", itemIds);
    if (error) return;

    const map: Record<string, boolean> = {};
    for (const r of (data as any[]) || []) map[String(r.item_id)] = true;
    setMyInterested(map);
  }

  async function loadOwnerMeta(itemIds: string[]) {
    if (itemIds.length === 0) return new Map<string, ItemMeta>();
    const { data, error } = await supabase
      .from("items")
      .select("id,owner_id,is_claimed,post_type,request_group,request_timeframe,request_location,status")
      .in("id", itemIds);

    if (error) return new Map<string, ItemMeta>();
    const m = new Map<string, ItemMeta>();
    for (const r of (data as ItemMeta[]) || []) m.set(r.id, r);
    return m;
  }

  async function loadFeed() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("v_feed_items")
      .select("id,title,description,category,status,created_at,photo_url,expires_at,interest_count,owner_role")
      .order("created_at", { ascending: false });

    if (error) {
      setItems([]);
      setMyInterested({});
      setErr(error.message || "Error loading feed.");
      setLoading(false);
      return;
    }

    const rows = ((data as FeedRowFromView[]) || []).map((x) => ({ ...x })) as FeedRow[];
    const ids = rows.map((x) => x.id);

    const meta = await loadOwnerMeta(ids);

    const merged = rows.map((x) => {
      const m = meta.get(x.id);
      return {
        ...x,
        owner_id: m?.owner_id ?? null,
        is_claimed: m?.is_claimed ?? null,
        post_type: (m?.post_type ?? x.post_type ?? "give") as PostType,
        request_group: m?.request_group ?? x.request_group ?? null,
        request_timeframe: m?.request_timeframe ?? x.request_timeframe ?? null,
        request_location: m?.request_location ?? x.request_location ?? null,
        status: (m?.status ?? x.status ?? "available") as any,
      };
    });

    const visible = merged.filter((x) => {
      const st = normStatus(x.status);
      const claimed = !!x.is_claimed || st === "claimed";
      return !claimed;
    });

    setItems(visible);

    const giveIds = visible.filter((x) => (x.post_type ?? "give") === "give").map((x) => x.id);
    if (isLoggedIn && userId) await loadMyInterestMap(userId, giveIds);
    else setMyInterested({});

    setLoading(false);
  }

  async function onPrimaryAction(item: FeedRow) {
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    const postType = (item.post_type ?? "give") as PostType;

    if (postType === "request") {
      router.push(`/item/${item.id}`);
      return;
    }

    const isMine = !!item.owner_id && item.owner_id === userId;
    if (isMine) return;

    const already = myInterested[item.id] === true;
    setSavingId(item.id);

    if (already) {
      const { error } = await supabase.from("interests").delete().eq("item_id", item.id).eq("user_id", userId);
      setSavingId(null);
      if (error) return alert(error.message);

      setMyInterested((p) => ({ ...p, [item.id]: false }));
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, interest_count: Math.max(0, (x.interest_count || 0) - 1) } : x))
      );
      return;
    }

    const { error } = await supabase.from("interests").insert([{ item_id: item.id, user_id: userId }]);
    setSavingId(null);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setMyInterested((p) => ({ ...p, [item.id]: true }));
        return;
      }
      return alert(error.message);
    }

    setMyInterested((p) => ({ ...p, [item.id]: true }));
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, interest_count: (x.interest_count || 0) + 1 } : x)));
  }

  // micro-delight pulse while typing
  useEffect(() => {
    if (!query) return;
    setSearchPulse(true);
    const t = setTimeout(() => setSearchPulse(false), 220);
    return () => clearTimeout(t);
  }, [query]);

  // reset some filters on tab change
  useEffect(() => {
    setQuery("");
    setCategoryFilter("all");
    setFiltersOpen(false);
  }, [tab]);

  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadFeed();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadFeed();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // draggable chip row
  useEffect(() => {
    const root = chipRowRef.current;
    if (!root) return;

    let down = false;
    let startX = 0;
    let startLeft = 0;

    const getEl = () => chipRowRef.current as HTMLDivElement | null;

    function onPointerDown(e: PointerEvent) {
      const el = getEl();
      if (!el) return;
      down = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      if ("setPointerCapture" in el) (el as any).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!down) return;
      const el = getEl();
      if (!el) return;
      const dx = e.clientX - startX;
      el.scrollLeft = startLeft - dx;
    }

    function onPointerUp() {
      down = false;
    }

    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerup", onPointerUp, { passive: true });
    root.addEventListener("pointercancel", onPointerUp, { passive: true });

    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const x of items) {
      if ((x.post_type ?? "give") !== "give") continue;
      const c = (x.category ?? "").trim();
      if (c) set.add(c);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const tabbed = useMemo(() => {
    return items.filter((x) => {
      const pt = (x.post_type ?? "give") as PostType;
      return tab === "items" ? pt !== "request" : pt === "request";
    });
  }, [items, tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = tabbed.filter((x) => {
      const pt = (x.post_type ?? "give") as PostType;

      if (roleFilter !== "all") {
        const r = (x.owner_role ?? null) as OwnerRole;
        if (!r) return false;
        if (r !== roleFilter) return false;
      }

      if (tab === "items" && pt !== "request") {
        if (categoryFilter !== "all" && (x.category ?? "") !== categoryFilter) return false;
      }

      if (q) {
        const blob =
          [
            x.title,
            x.description ?? "",
            x.category ?? "",
            x.request_group ?? "",
            x.request_timeframe ?? "",
            x.request_location ?? "",
          ]
            .join(" ")
            .toLowerCase() || "";
        if (!blob.includes(q)) return false;
      }

      return true;
    });

    if (sort === "popular") {
      list = [...list].sort((a, b) => (b.interest_count || 0) - (a.interest_count || 0));
    } else {
      list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return list;
  }, [tabbed, query, sort, roleFilter, categoryFilter, tab]);

  const skeletonCount = 6;

  return (
    <div className={`${brandFont.className} page`}>
      <header className="topbar">
        {/* Row 1: Brand + micro hero */}
        <div className="row brandRow">
          <button className="logoBtn" onClick={() => router.push("/feed")} aria-label="Home" type="button">
            <Image src="/scholarswap-logo.png" alt="ScholarSwap" width={34} height={34} priority className="logoImg" />
          </button>

          <div className="brandCenter" role="heading" aria-level={1}>
            <div className="brandStack">
              <div className="brandLine">
                <span className="brandName">ScholarSwap</span>
                <span className="dot" aria-hidden="true" />
                <Image
                  src="/Ashland_Eagles_logo.svg.png"
                  alt="Ashland University"
                  width={18}
                  height={18}
                  priority
                  className="brandMark"
                />
              </div>
              <div className="tagline">Give. Request. Help each other — faster.</div>
            </div>
          </div>

          <button className="plusBtn" onClick={() => router.push("/create")} aria-label="Create" type="button">
            +
          </button>
        </div>

        {/* Row 2: Tabs + controls */}
        <div className="row tabsRow">
          <div className="seg" role="tablist" aria-label="Feed tabs">
            <button className={`segBtn ${tab === "items" ? "active" : ""}`} onClick={() => setTab("items")} type="button">
              Items
            </button>
            <button
              className={`segBtn ${tab === "requests" ? "active" : ""}`}
              onClick={() => setTab("requests")}
              type="button"
            >
              Requests
            </button>
            <span className={`segIndicator ${tab === "items" ? "left" : "right"}`} aria-hidden="true" />
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

        {/* Row 3: Search + chips */}
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
              placeholder={tab === "items" ? "Search items, categories…" : "Search requests, locations…"}
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
                    <span className="chipGlow" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="subline">
          <div className="subTitle">{tab === "items" ? "Public Items" : "Public Requests"}</div>
          <div className="count">
            Showing <b>{filtered.length}</b>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        {loading && <div className="loading">Loading…</div>}
      </header>

      {/* FILTER SHEET */}
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
                    ↕️ Newest
                  </button>
                  <button className={`tog ${sort === "popular" ? "togOn" : ""}`} onClick={() => setSort("popular")} type="button">
                    🔥 Popular
                  </button>
                </div>
              </div>

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

      {/* GRID */}
      <main className="main">
        <div className="grid">
          {loading
            ? Array.from({ length: skeletonCount }).map((_, i) => (
                <div key={i} className="card skel">
                  <div className="skMedia" />
                  <div className="skBody">
                    <div className="skLine w70" />
                    <div className="skLine w90" />
                    <div className="skLine w55" />
                    <div className="skBtns">
                      <div className="skBtn" />
                      <div className="skBtn" />
                    </div>
                  </div>
                </div>
              ))
            : filtered.map((item) => {
                const postType = (item.post_type ?? "give") as PostType;
                const isMine = !!userId && !!item.owner_id && item.owner_id === userId;
                const interested = myInterested[item.id] === true;

                const group = requestGroupLabel(item.request_group);
                const tf = requestTimeframeLabel(item.request_timeframe);
                const loc = (item.request_location ?? "").trim();

                return (
                  <article key={item.id} className={`card ${postType === "request" ? "cardRequest" : ""}`}>
                    {postType === "request" ? (
                      <div className="reqHero">
                        <div className="reqTop">
                          <div className="badge badgeRequest">{statusLabel(item.status, postType)}</div>
                          <div className="ago">{timeAgo(item.created_at)}</div>
                        </div>

                        <div className="reqMeta">
                          {group}
                          {tf ? ` • ${tf}` : ""}
                          {loc ? ` • ${loc}` : ""}
                        </div>

                        <div className="title clamp2">{item.title}</div>

                        <div className="reqBottom">
                          <span className="pill">Tap “Offer help” to respond</span>
                        </div>
                      </div>
                    ) : (
                      <div className="media">
                        <div className="badge badgeItem">{statusLabel(item.status, postType)}</div>
                        <div className="ago">{timeAgo(item.created_at)}</div>

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
                            <span className="mediaOverlay" aria-hidden="true" />
                          </button>
                        ) : (
                          <div className="noPhoto">
                            <div className="noIcon" aria-hidden="true">
                              ⬚
                            </div>
                            <div className="noText">No photo</div>
                          </div>
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

                      {postType !== "request" && statusHint(item.status, postType) ? (
                        <div className="hint">{statusHint(item.status, postType)}</div>
                      ) : null}

                      <div className="desc clamp2">{item.description || "—"}</div>

                      <div className="footerRow">
                        {postType === "request" ? (
                          <span className="small">Need help? Offer now</span>
                        ) : (
                          <span className="small">
                            <b>{item.interest_count || 0}</b> requests
                          </span>
                        )}
                        {item.expires_at ? <span className="small">Ends: {formatShortDate(item.expires_at)}</span> : null}
                      </div>

                      <div className="actions">
                        <button className="btn btnGhost" onClick={() => router.push(`/item/${item.id}`)} type="button">
                          View
                        </button>

                        <button
                          className={`btn btnPrimary ${isMine ? "btnDisabled" : ""} ${interested ? "btnOn" : ""}`}
                          onClick={() => onPrimaryAction(item)}
                          disabled={savingId === item.id || isMine}
                          type="button"
                        >
                          {isMine
                            ? "Yours"
                            : savingId === item.id
                            ? "Saving…"
                            : postType === "request"
                            ? isLoggedIn
                              ? "Offer help"
                              : "Offer (login)"
                            : isLoggedIn
                            ? interested
                              ? "Requested"
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

      {/* floating CTA */}
      <button className="fab" onClick={() => router.push("/create")} type="button" aria-label="Create new post">
        <span className="fabPlus">+</span>
        <span className="fabText">Create</span>
      </button>

      {/* IMAGE MODAL */}
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
          background: radial-gradient(1200px 700px at 50% -120px, rgba(16, 185, 129, 0.16), transparent 60%),
            #000;
          color: #fff;
        }

        /* ========= TOPBAR ========= */
        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(0, 0, 0, 0.9);
          backdrop-filter: blur(18px);
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
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
          padding-bottom: 6px;
        }

        .logoBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
          transition: transform 0.12s ease;
        }
        .logoBtn:active {
          transform: scale(0.98);
        }

        .logoImg {
          width: 100%;
          height: 100%;
          object-fit: contain;
          padding: 6px;
        }

        .brandCenter {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
        }

        .brandStack {
          min-width: 0;
          text-align: center;
        }

        .brandLine {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-width: 0;
        }

        .brandName {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.6px;
          white-space: nowrap;
          text-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
        }

        .dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: rgba(52, 211, 153, 0.65);
          box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.12);
        }

        .brandMark {
          opacity: 0.92;
          transform: translateY(1px);
        }

        .tagline {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 850;
          color: rgba(255, 255, 255, 0.6);
          letter-spacing: -0.2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .plusBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid rgba(52, 211, 153, 0.35);
          background: radial-gradient(circle at 30% 30%, rgba(16, 185, 129, 0.28), rgba(16, 185, 129, 0.12));
          color: #fff;
          font-size: 24px;
          font-weight: 900;
          display: grid;
          place-items: center;
          cursor: pointer;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
          transition: transform 0.12s ease;
        }
        .plusBtn:active {
          transform: scale(0.98);
        }

        .tabsRow {
          display: grid;
          grid-template-columns: 1fr 46px;
          gap: 10px;
          align-items: center;
          padding-top: 8px;
          padding-bottom: 6px;
        }

        .seg {
          position: relative;
          height: 44px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.04);
          display: grid;
          grid-template-columns: 1fr 1fr;
          overflow: hidden;
        }

        .segBtn {
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.72);
          font-weight: 950;
          cursor: pointer;
          z-index: 2;
          transition: color 0.18s ease;
        }

        .segBtn.active {
          color: rgba(209, 250, 229, 0.98);
        }

        .segIndicator {
          position: absolute;
          top: 3px;
          bottom: 3px;
          width: calc(50% - 6px);
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.14);
          border: 1px solid rgba(52, 211, 153, 0.35);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
          transition: transform 0.22s ease;
          z-index: 1;
        }

        .segIndicator.left {
          transform: translateX(3px);
        }

        .segIndicator.right {
          transform: translateX(calc(100% + 3px));
        }

        .ctrlBtn {
          width: 46px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
          transition: transform 0.12s ease, border-color 0.18s ease, background 0.18s ease;
        }

        .ctrlBtn:active {
          transform: scale(0.98);
        }

        .ctrlActive {
          border-color: rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.12);
        }

        .ctrlIcon {
          font-size: 18px;
          font-weight: 900;
          opacity: 0.92;
        }

        .searchWrap {
          padding-top: 6px;
          padding-bottom: 10px;
        }

        .searchRow {
          height: 46px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.03);
          display: grid;
          grid-template-columns: 40px 1fr 40px;
          align-items: center;
          gap: 8px;
          padding: 0 6px;
          margin: 0;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .searchFocused .searchRow {
          border-color: rgba(52, 211, 153, 0.45);
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14), 0 14px 40px rgba(0, 0, 0, 0.45);
        }

        .searchPulse .searchRow {
          animation: glow 0.22s ease-out;
        }

        @keyframes glow {
          from {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.22), 0 14px 40px rgba(0, 0, 0, 0.45);
          }
          to {
            box-shadow: 0 0 0 10px rgba(16, 185, 129, 0), 0 14px 40px rgba(0, 0, 0, 0.45);
          }
        }

        .searchIconBtn {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          cursor: pointer;
          display: grid;
          place-items: center;
          transition: transform 0.12s ease;
        }

        .searchIconBtn:active {
          transform: scale(0.98);
        }

        .searchRow input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #fff;
          font-weight: 950;
          font-size: 14px;
        }

        .searchRow input::placeholder {
          color: rgba(255, 255, 255, 0.45);
          font-weight: 900;
        }

        .clearBtn,
        .kbdHint {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          display: grid;
          place-items: center;
          font-weight: 950;
        }

        .clearBtn {
          cursor: pointer;
          transition: transform 0.12s ease;
        }

        .clearBtn:active {
          transform: scale(0.98);
        }

        .kbdHint {
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(148, 163, 184, 0.16);
        }

        /* chips */
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
          scroll-snap-type: x mandatory;
        }

        .chipRow::-webkit-scrollbar {
          display: none;
        }

        .chip {
          position: relative;
          flex: 0 0 auto;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.82);
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          scroll-snap-align: start;
          transition: transform 0.12s ease, border-color 0.18s ease, background 0.18s ease;
        }

        .chip:active {
          transform: scale(0.98);
        }

        .chipGlow {
          position: absolute;
          inset: -30px;
          background: radial-gradient(circle at 40% 30%, rgba(16, 185, 129, 0.18), transparent 55%);
          opacity: 0;
          transition: opacity 0.18s ease;
        }

        .chipOn {
          border-color: rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        .chipOn .chipGlow {
          opacity: 1;
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
          opacity: 0.9;
        }

        .count {
          font-size: 12px;
          opacity: 0.65;
          font-weight: 950;
        }

        .err {
          padding: 0 12px 10px;
          color: #f87171;
          font-weight: 800;
        }

        .loading {
          padding: 0 12px 10px;
          opacity: 0.75;
          font-weight: 800;
        }

        /* sheet */
        .sheetBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.62);
          z-index: 9998;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 12px;
        }

        .sheet {
          width: min(720px, 100%);
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(10, 10, 10, 0.92);
          backdrop-filter: blur(18px);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.75);
          overflow: hidden;
        }

        .sheetTop {
          padding: 12px 12px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        }

        .sheetTitle {
          font-weight: 950;
          font-size: 14px;
          opacity: 0.9;
        }

        .sheetClose {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          cursor: pointer;
          font-weight: 950;
        }

        .sheetGrid {
          padding: 12px;
          display: grid;
          gap: 12px;
        }

        .sheetBlock {
          border: 1px solid rgba(148, 163, 184, 0.12);
          background: rgba(255, 255, 255, 0.03);
          border-radius: 16px;
          padding: 12px;
        }

        .sheetLabel {
          font-size: 12px;
          font-weight: 950;
          opacity: 0.72;
          margin-bottom: 10px;
        }

        .togRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .tog {
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.84);
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
        }

        .togOn {
          border-color: rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        .sheetActions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .ghost {
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.86);
          font-weight: 950;
          cursor: pointer;
        }

        .primary {
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(52, 211, 153, 0.25);
          background: rgba(16, 185, 129, 0.22);
          color: #fff;
          font-weight: 950;
          cursor: pointer;
        }

        /* ========= MAIN GRID ========= */
        .main {
          padding: 14px 12px 120px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }

        @media (min-width: 720px) {
          .main {
            padding: 16px 16px 120px;
            max-width: 1100px;
            margin: 0 auto;
          }
          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }
        }

        .card {
          position: relative;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.15);
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
          transform: translateZ(0);
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }

        .card:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
          border-color: rgba(52, 211, 153, 0.18);
        }

        .cardRequest {
          border: 1px solid rgba(34, 197, 94, 0.22);
        }

        .media {
          position: relative;
          height: 210px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25));
        }

        .mediaBtn {
          width: 100%;
          height: 100%;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          position: relative;
        }

        .mediaImg {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transform: scale(1);
          transition: transform 0.22s ease;
        }

        .card:hover .mediaImg {
          transform: scale(1.03);
        }

        .mediaOverlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(800px 280px at 50% 100%, rgba(16, 185, 129, 0.14), transparent 55%);
          opacity: 0.8;
          pointer-events: none;
        }

        .noPhoto {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          color: rgba(255, 255, 255, 0.55);
          font-weight: 900;
          gap: 6px;
        }

        .noIcon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.03);
          display: grid;
          place-items: center;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35);
        }

        .noText {
          font-size: 12px;
          opacity: 0.8;
        }

        .reqHero {
          position: relative;
          height: 210px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          background: radial-gradient(800px 260px at 40% 20%, rgba(34, 197, 94, 0.18), transparent 55%),
            linear-gradient(180deg, rgba(34, 197, 94, 0.12), rgba(0, 0, 0, 0.25));
        }

        .reqTop {
          position: absolute;
          top: 12px;
          left: 12px;
          right: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .badge {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid rgba(148, 163, 184, 0.25);
          background: rgba(0, 0, 0, 0.35);
          color: rgba(255, 255, 255, 0.85);
        }

        .badgeRequest {
          border: 1px solid rgba(34, 197, 94, 0.28);
          background: rgba(34, 197, 94, 0.12);
          color: rgba(209, 250, 229, 0.92);
        }

        .badgeItem {
          position: absolute;
          top: 12px;
          left: 12px;
          border: 1px solid rgba(52, 211, 153, 0.28);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.92);
        }

        .ago {
          position: absolute;
          top: 12px;
          right: 12px;
          font-size: 12px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid rgba(148, 163, 184, 0.14);
          padding: 6px 10px;
          border-radius: 999px;
        }

        .reqMeta {
          font-size: 13px;
          font-weight: 900;
          opacity: 0.92;
          margin-bottom: 8px;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(0, 0, 0, 0.25);
          font-weight: 900;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.8);
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
          opacity: 0.72;
          font-weight: 800;
        }

        .mine {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          opacity: 0.9;
          font-weight: 900;
        }

        .title {
          margin-top: 8px;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: -0.2px;
        }

        .hint {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 900;
          opacity: 0.85;
          color: rgba(209, 250, 229, 0.9);
        }

        .desc {
          margin-top: 10px;
          opacity: 0.8;
          font-size: 14px;
          min-height: 40px;
        }

        .footerRow {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          opacity: 0.75;
          font-weight: 900;
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
          border: 1px solid rgba(148, 163, 184, 0.25);
          transition: transform 0.12s ease, border-color 0.18s ease, background 0.18s ease;
        }

        .btn:active {
          transform: scale(0.99);
        }

        .btnGhost {
          background: rgba(255, 255, 255, 0.03);
          color: rgba(255, 255, 255, 0.86);
        }

        .btnPrimary {
          border: 1px solid rgba(52, 211, 153, 0.25);
          background: rgba(16, 185, 129, 0.22);
          color: #fff;
        }

        .btnOn {
          border-color: rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.28);
        }

        .btnDisabled {
          opacity: 0.7;
          cursor: not-allowed;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(148, 163, 184, 0.2);
        }

        .clamp2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* skeleton */
        .skel {
          border: 1px solid rgba(148, 163, 184, 0.12);
        }
        .skMedia {
          height: 210px;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.04));
          background-size: 200% 100%;
          animation: shimmer 1.1s linear infinite;
        }
        .skBody {
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .skLine,
        .skBtn {
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.04));
          background-size: 200% 100%;
          animation: shimmer 1.1s linear infinite;
        }
        .w70 {
          width: 70%;
        }
        .w90 {
          width: 90%;
        }
        .w55 {
          width: 55%;
        }
        .skBtns {
          margin-top: 6px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .skBtn {
          height: 42px;
          border-radius: 14px;
        }
        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }

        /* FAB */
        .fab {
          position: fixed;
          right: 14px;
          bottom: 18px;
          z-index: 40;
          border-radius: 999px;
          border: 1px solid rgba(52, 211, 153, 0.28);
          background: rgba(16, 185, 129, 0.22);
          color: #fff;
          padding: 12px 14px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.7);
          transition: transform 0.12s ease, background 0.18s ease;
        }
        .fab:active {
          transform: scale(0.98);
        }
        .fabPlus {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          background: rgba(0, 0, 0, 0.25);
          display: grid;
          place-items: center;
          font-size: 18px;
          line-height: 1;
        }
        .fabText {
          font-size: 13px;
        }

        /* modal */
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
        }

        .modalInner {
          width: min(1000px, 95vw);
          max-height: 90vh;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 16px;
          overflow: hidden;
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }

        .modalTitle {
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .modalClose {
          background: transparent;
          color: #fff;
          border: 1px solid rgba(148, 163, 184, 0.25);
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
          background: #000;
        }
      `}</style>
    </div>
  );
}