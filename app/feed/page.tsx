"use client";

import Image from "next/image";
import { Outfit } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
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

// Show AVAILABLE even if reserved/in talk, to keep waitlist open.
// Hide ONLY when claimed/completed.
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

  // UI
  const [tab, setTab] = useState<"items" | "requests">("items");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");
  const [query, setQuery] = useState<string>("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);

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

    // Hide ONLY completed/claimed
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

    // Requests -> detail
    if (postType === "request") {
      router.push(`/item/${item.id}`);
      return;
    }

    // Give -> toggle interest
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
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

      if (pt !== "request") {
        if (categoryFilter !== "all" && (x.category ?? "") !== categoryFilter) return false;
      }

      if (roleFilter !== "all") {
        const r = (x.owner_role ?? null) as OwnerRole;
        if (!r) return false;
        if (r !== roleFilter) return false;
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
  }, [tabbed, categoryFilter, roleFilter, query, sort]);

  return (
    <div className={`${brandFont.className} page`}>
      <header className="topbar">
        {/* Row 1: logo + brand + create */}
        <div className="topRow">
          <button className="iconBtn" onClick={() => router.push("/feed")} aria-label="Home" type="button">
            <Image src="/scholarswap-logo.png" alt="ScholarSwap" width={36} height={36} priority className="logoImg" />
          </button>

          <div className="brand">
            <div className="brandName">ScholarSwap</div>
            <Image
              src="/Ashland_Eagles_logo.svg.png"
              alt="Ashland University"
              width={18}
              height={18}
              priority
              className="brandMark"
            />
          </div>

          <button className="createBtn" onClick={() => router.push("/create")} aria-label="Create" type="button">
            +
          </button>
        </div>

        {/* Row 2: Items/Requests (kept) */}
        <div className="segTabs" role="tablist" aria-label="Feed tabs">
          <button
            className={`segTab ${tab === "items" ? "active" : ""}`}
            onClick={() => setTab("items")}
            type="button"
            role="tab"
            aria-selected={tab === "items"}
          >
            <span className="segTxt">Items</span>
          </button>

          <button
            className={`segTab ${tab === "requests" ? "active" : ""}`}
            onClick={() => setTab("requests")}
            type="button"
            role="tab"
            aria-selected={tab === "requests"}
          >
            <span className="segTxt">Requests</span>
          </button>
        </div>

        {/* Row 3: ONE row = Newest + All + Filters + Search (no extra row) */}
        <div className="oneRow">
          <label className="pill" aria-label="Sort">
            <span className="ico">↕️</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="newest">Newest</option>
              <option value="popular">Popular</option>
            </select>
          </label>

          <label className="pill" aria-label="Role filter">
            <span className="ico">👤</span>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
              <option value="all">All</option>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
            </select>
          </label>

          <button className="pillBtn" onClick={() => setFiltersOpen((v) => !v)} type="button" aria-label="Filters">
            <span className="ico">≡</span>
          </button>

          <div className="searchInline" aria-label="Search">
            <span className="sIco">🔎</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "items" ? "Search…" : "Search…"}
            />
            {query ? (
              <button className="xBtn" onClick={() => setQuery("")} type="button" aria-label="Clear">
                ✕
              </button>
            ) : null}
          </div>
        </div>

        {/* Row 4: category chips only when Filters open */}
        {tab === "items" && filtersOpen && (
          <div className="chips">
            {categories.map((c) => {
              const active = categoryFilter === c;
              const label = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);
              return (
                <button
                  key={c}
                  className={`chip ${active ? "chipActive" : ""}`}
                  onClick={() => setCategoryFilter(c)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="subline">
          <div className="subTitle">{tab === "items" ? "Public Items" : "Public Requests"}</div>
          <div className="count">
            Showing <b>{filtered.length}</b>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        {loading && <div className="loading">Loading…</div>}
      </header>

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

        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        /* Row 1 */
        .topRow {
          padding: 12px 14px 6px;
          display: grid;
          grid-template-columns: 40px 1fr 40px;
          align-items: center;
          gap: 10px;
        }

        .iconBtn {
          width: 40px;
          height: 40px;
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
        }

        .logoImg {
          width: 100%;
          height: 100%;
          object-fit: contain;
          padding: 5px;
        }

        .brand {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 0;
        }

        .brandName {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.6px;
          white-space: nowrap;
        }

        .brandMark {
          opacity: 0.9;
        }

        .createBtn {
          width: 40px;
          height: 40px;
          border-radius: 14px;
          border: 1px solid rgba(52, 211, 153, 0.35);
          background: rgba(16, 185, 129, 0.18);
          color: #fff;
          font-size: 22px;
          font-weight: 800;
          display: grid;
          place-items: center;
          cursor: pointer;
        }

        /* Row 2: Tabs */
        .segTabs {
          padding: 6px 14px 8px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .segTab {
          width: 100%;
          padding: 10px 12px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.86);
          font-weight: 950;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 0;
        }

        .segTab.active {
          border: 1px solid rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        /* Row 3: ONE row for pills + search */
        .oneRow {
          padding: 0 14px 10px;
          display: grid;
          grid-template-columns: 1.05fr 0.85fr 52px 1.25fr;
          gap: 10px;
          align-items: center;
        }

        .pill {
          height: 44px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.86);
          padding: 0 12px;
          font-weight: 950;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .ico {
          opacity: 0.9;
          font-size: 16px;
          width: 20px;
          display: inline-flex;
          justify-content: center;
        }

        .pill select {
          width: 100%;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: #fff;
          font-weight: 950;
          cursor: pointer;
        }

        .pillBtn {
          height: 44px;
          width: 52px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.9);
          font-weight: 950;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .searchInline {
          height: 44px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          min-width: 0;
        }

        .sIco {
          opacity: 0.7;
          font-size: 15px;
        }

        .searchInline input {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #fff;
          font-weight: 950;
          font-size: 13px;
        }

        .searchInline input::placeholder {
          color: rgba(255, 255, 255, 0.45);
          font-weight: 900;
        }

        .xBtn {
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: #fff;
          border-radius: 999px;
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          cursor: pointer;
          font-weight: 950;
          opacity: 0.9;
        }

        /* Chips */
        .chips {
          padding: 0 14px 10px;
          display: flex;
          gap: 10px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .chip {
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.86);
          padding: 10px 14px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }

        .chipActive {
          border: 1px solid rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        .subline {
          padding: 0 14px 12px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .subTitle {
          font-size: 13px;
          font-weight: 900;
          opacity: 0.9;
        }

        .count {
          font-size: 12px;
          opacity: 0.65;
          font-weight: 900;
        }

        .err {
          padding: 0 14px 10px;
          color: #f87171;
          font-weight: 800;
        }

        .loading {
          padding: 0 14px 10px;
          opacity: 0.7;
          font-weight: 800;
        }

        /* Main */
        .main {
          padding: 14px 14px 96px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
          gap: 16px;
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

        /* Modal */
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

        /* Tiny phones: keep everything on one row by shrinking text */
        @media (max-width: 380px) {
          .oneRow {
            grid-template-columns: 1.1fr 0.9fr 48px 1.1fr;
            gap: 8px;
          }
          .brandName {
            font-size: 18px;
          }
          .pill select {
            font-size: 13px;
          }
          .searchInline input {
            font-size: 12px;
          }
        }

        /* Desktop */
        @media (min-width: 900px) {
          .topRow {
            padding: 16px 16px 8px;
            grid-template-columns: 52px 1fr 52px;
          }
          .iconBtn,
          .createBtn {
            width: 52px;
            height: 52px;
            border-radius: 16px;
          }
          .brandName {
            font-size: 28px;
          }
          .segTabs,
          .oneRow,
          .subline,
          .err,
          .loading,
          .chips {
            max-width: 1100px;
            margin: 0 auto;
          }
          .main {
            max-width: 1100px;
            margin: 0 auto;
            padding: 16px 16px 96px;
          }
        }
      `}</style>
    </div>
  );
}