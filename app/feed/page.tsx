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

// Keep waitlist alive: show AVAILABLE unless truly completed.
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

  // compact UI state
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
    const { data, error } = await supabase.from("interests").select("item_id").eq("user_id", uid).in("item_id", itemIds);
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

    // Hide ONLY confirmed/completed
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

      if (pt !== "request" && tab === "items") {
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

  return (
    <div className={`${brandFont.className} page`}>
      {/* TOP (MAX 3 ROWS total) */}
      <header className="topbar">
        {/* Row 1: Brand */}
        <div className="row brandRow">
          <button className="logoBtn" onClick={() => router.push("/feed")} aria-label="Home" type="button">
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

        {/* Row 2: Tabs + ONE smart controls button */}
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
            <span className="segGlow" aria-hidden="true" />
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

        {/* Row 3: Search (interactive) */}
        <div className={`row searchRow ${searchFocused ? "searchFocused" : ""} ${searchPulse ? "searchPulse" : ""}`}>
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

        {/* Minimal subline (still within the same sticky header block, not a new “row” visually tall) */}
        <div className="subline">
          <div className="subTitle">{tab === "items" ? "Public Items" : "Public Requests"}</div>
          <div className="count">
            Showing <b>{filtered.length}</b>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        {loading && <div className="loading">Loading…</div>}
      </header>

      {/* FILTER SHEET (opens from the single control button) */}
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
                  <button
                    className={`tog ${sort === "newest" ? "togOn" : ""}`}
                    onClick={() => setSort("newest")}
                    type="button"
                  >
                    ↕️ Newest
                  </button>
                  <button
                    className={`tog ${sort === "popular" ? "togOn" : ""}`}
                    onClick={() => setSort("popular")}
                    type="button"
                  >
                    🔥 Popular
                  </button>
                </div>
              </div>

              <div className="sheetBlock">
                <div className="sheetLabel">Lister</div>
                <div className="togRow">
                  <button
                    className={`tog ${roleFilter === "all" ? "togOn" : ""}`}
                    onClick={() => setRoleFilter("all")}
                    type="button"
                  >
                    👤 All
                  </button>
                  <button
                    className={`tog ${roleFilter === "student" ? "togOn" : ""}`}
                    onClick={() => setRoleFilter("student")}
                    type="button"
                  >
                    🎓 Student
                  </button>
                  <button
                    className={`tog ${roleFilter === "faculty" ? "togOn" : ""}`}
                    onClick={() => setRoleFilter("faculty")}
                    type="button"
                  >
                    🧑‍🏫 Faculty
                  </button>
                </div>
              </div>

              {tab === "items" && (
                <div className="sheetBlock">
                  <div className="sheetLabel">Category</div>
                  <div className="chipRow">
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

      {/* GRID */}
      <main className="main">
        <div className="grid">
          {filtered.map((item) => {
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
                    <div className="badge badgeRequest">{statusLabel(item.status, postType)}</div>
                    <div className="reqMeta">
                      {group}
                      {tf ? ` • ${tf}` : ""}
                      {loc ? ` • ${loc}` : ""}
                    </div>
                    <div className="title clamp2">{item.title}</div>
                  </div>
                ) : (
                  <div className="media">
                    <div className="badge badgeItem">{statusLabel(item.status, postType)}</div>

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

                  {postType !== "request" && statusHint(item.status, postType) ? (
                    <div className="hint">{statusHint(item.status, postType)}</div>
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
                      className={`btn btnPrimary ${isMine ? "btnDisabled" : ""}`}
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
          background: #000;
          color: #fff;
        }

        /* ========= TOPBAR (3 rows max) ========= */
        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(16px);
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
          padding-bottom: 8px;
        }

        .logoBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.10);
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
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
          gap: 8px;
          min-width: 0;
        }

        .brandName {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.6px;
          white-space: nowrap;
          text-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
        }

        .brandMark {
          opacity: 0.9;
          transform: translateY(1px);
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
          padding-top: 6px;
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

        .segGlow {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(circle at 20% 0%, rgba(16, 185, 129, 0.18), transparent 55%);
          opacity: 0.8;
        }

        .segBtn {
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.74);
          font-weight: 950;
          cursor: pointer;
          transition: color 0.18s ease;
          z-index: 1;
        }

        .segBtn.active {
          color: rgba(209, 250, 229, 0.98);
        }

        .segBtn.active:first-child {
          background: rgba(16, 185, 129, 0.14);
          box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.35);
        }

        .segBtn.active:last-child {
          background: rgba(16, 185, 129, 0.14);
          box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.35);
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
          margin: 8px 12px 10px;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .searchFocused {
          border-color: rgba(52, 211, 153, 0.45);
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14), 0 14px 40px rgba(0, 0, 0, 0.45);
        }

        .searchPulse::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 999px;
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.0);
          animation: pulse 0.22s ease-out;
          pointer-events: none;
        }

        @keyframes pulse {
          from {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.22);
            opacity: 0.9;
          }
          to {
            box-shadow: 0 0 0 10px rgba(16, 185, 129, 0);
            opacity: 0;
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

        .clearBtn {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          cursor: pointer;
          font-weight: 950;
          display: grid;
          place-items: center;
          transition: transform 0.12s ease;
        }
        .clearBtn:active {
          transform: scale(0.98);
        }

        .kbdHint {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.55);
          display: grid;
          place-items: center;
          font-weight: 950;
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

        /* ========= FILTER SHEET ========= */
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

        .chipRow {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding-bottom: 6px;
          -webkit-overflow-scrolling: touch;
        }

        .chip {
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(0, 0, 0, 0.22);
          color: rgba(255, 255, 255, 0.82);
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }

        .chipOn {
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
          padding: 14px 12px 96px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }

        @media (min-width: 720px) {
          .main {
            padding: 16px 16px 96px;
            max-width: 1100px;
            margin: 0 auto;
          }
          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }
        }

        .card {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.15);
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
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
          color: rgba(255, 255, 255, 0.45);
          font-weight: 800;
        }

        .reqHero {
          position: relative;
          height: 210px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          background: linear-gradient(180deg, rgba(34, 197, 94, 0.12), rgba(0, 0, 0, 0.25));
        }

        .badge {
          position: absolute;
          top: 12px;
          left: 12px;
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
          border: 1px solid rgba(52, 211, 153, 0.28);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.92);
        }

        .reqMeta {
          font-size: 13px;
          font-weight: 900;
          opacity: 0.9;
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
          opacity: 0.8;
          color: rgba(209, 250, 229, 0.9);
        }

        .desc {
          margin-top: 10px;
          opacity: 0.78;
          font-size: 14px;
          min-height: 40px;
        }

        .footerRow {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          opacity: 0.72;
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

        /* ========= MODAL ========= */
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