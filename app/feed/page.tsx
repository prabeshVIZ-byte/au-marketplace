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

  // optional if present in your view
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
};

type FeedRow = FeedRowFromView & {
  owner_id?: string | null;
  is_claimed?: boolean | null;
};

function formatShortDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusLabel(status: string | null, postType: PostType) {
  if ((postType ?? "give") === "request") return "REQUEST";
  const st = (status ?? "available").toLowerCase();
  if (st === "reserved") return "RESERVED";
  if (st === "available") return "AVAILABLE";
  if (st === "claimed") return "CLAIMED";
  if (st === "expired") return "EXPIRED";
  return st.toUpperCase();
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

  // UI filters
  const [tab, setTab] = useState<"items" | "requests">("items");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");

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
      .select("id,owner_id,is_claimed,post_type,request_group,request_timeframe,request_location")
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
      };
    });

    // Hide claimed
    const visible = merged.filter((x) => {
      const st = (x.status ?? "available").toLowerCase();
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

    // Requests = Offer help (for now route to detail)
    if (postType === "request") {
      router.push(`/item/${item.id}`);
      return;
    }

    // Give = toggle interest
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
    return tabbed.filter((x) => {
      const pt = (x.post_type ?? "give") as PostType;

      // category only for items
      if (pt !== "request") {
        if (categoryFilter !== "all" && (x.category ?? "") !== categoryFilter) return false;
      }

      if (roleFilter !== "all") {
        const r = (x.owner_role ?? null) as OwnerRole;
        if (!r) return false;
        if (r !== roleFilter) return false;
      }

      return true;
    });
  }, [tabbed, categoryFilter, roleFilter]);

  return (
    <div className={`${brandFont.className} page`}>
      {/* Top bar */}
      <header className="topbar">
        <div className="topbarInner">
          <button className="logoBtn" onClick={() => router.push("/feed")} aria-label="Home">
            <Image src="/scholarswap-logo.png" alt="ScholarSwap" width={52} height={52} priority className="logoImg" />
          </button>

          <div className="brand">
            <div className="brandName">ScholarSwap</div>
            <Image
              src="/Ashland_Eagles_logo.svg.png"
              alt="Ashland University"
              width={26}
              height={26}
              priority
              className="brandMark"
            />
          </div>

          <button className="createBtn" onClick={() => router.push("/create")} aria-label="Create">
            +
          </button>
        </div>

        {/* Tabs + filters */}
        <div className="controls">
          <div className="tabs">
            <button className={`tab ${tab === "items" ? "active" : ""}`} onClick={() => setTab("items")}>
              Items
            </button>
            <button className={`tab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>
              Requests
            </button>
          </div>

          <div className="filters">
            <div className="pill selectPill" aria-label="Filter by lister">
              <span className="pillIcon">👤</span>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
              </select>
            </div>

            {tab === "items" && (
              <div className="chipRow">
                {categories.map((c) => {
                  const active = categoryFilter === c;
                  const label = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);
                  return (
                    <button
                      key={c}
                      className={`pill chip ${active ? "chipActive" : ""}`}
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
            <div className="subTitle">{tab === "items" ? "Public Items" : "Public Requests"}</div>
            <div className="count">
              Showing <b>{filtered.length}</b>
            </div>
          </div>

          {err && <div className="err">{err}</div>}
          {loading && <div className="loading">Loading…</div>}
        </div>
      </header>

      {/* Grid */}
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
                {/* Media / Header */}
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

                {/* Body */}
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

                  <div className="desc clamp2">{item.description || "—"}</div>

                  <div className="footerRow">
                    {postType === "request" ? (
                      <span className="small">Tap to offer help</span>
                    ) : (
                      <span className="small">{item.interest_count || 0} requests</span>
                    )}

                    {/* only show end date if it exists */}
                    {item.expires_at ? <span className="small">Ends: {formatShortDate(item.expires_at)}</span> : null}
                  </div>

                  <div className="actions">
                    <button className="btn btnGhost" onClick={() => router.push(`/item/${item.id}`)}>
                      View
                    </button>

                    <button
                      className={`btn btnPrimary ${isMine ? "btnDisabled" : ""}`}
                      onClick={() => onPrimaryAction(item)}
                      disabled={savingId === item.id || isMine}
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

      {/* Image Modal */}
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

        /* Topbar */
        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .topbarInner {
          padding: 16px 16px 10px;
          display: grid;
          grid-template-columns: 52px 1fr 52px;
          align-items: center;
          gap: 10px;
        }

        .logoBtn {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          overflow: hidden;
          background: #fff;
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
          padding: 6px;
        }

        .brand {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-width: 0;
        }

        .brandName {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.6px;
          white-space: nowrap;
        }

        .brandMark {
          opacity: 0.85;
        }

        .createBtn {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          border: 1px solid rgba(52, 211, 153, 0.35);
          background: rgba(16, 185, 129, 0.18);
          color: #fff;
          font-size: 26px;
          font-weight: 700;
          display: grid;
          place-items: center;
          cursor: pointer;
        }

        .controls {
          padding: 0 16px 14px;
        }

        .tabs {
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }

        .tab {
          flex: 0 0 auto;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.86);
          font-weight: 800;
          cursor: pointer;
        }

        .tab.active {
          border: 1px solid rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        .filters {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 10px;
          overflow: hidden;
        }

        .pill {
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.86);
          padding: 10px 14px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }

        .selectPill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
        }

        .pillIcon {
          font-size: 14px;
          opacity: 0.9;
        }

        .selectPill select {
          background: transparent;
          border: none;
          outline: none;
          color: #fff;
          font-weight: 900;
          cursor: pointer;
          padding: 10px 0;
        }

        .chipRow {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding-bottom: 6px;
          -webkit-overflow-scrolling: touch;
        }

        .chipActive {
          border: 1px solid rgba(52, 211, 153, 0.45);
          background: rgba(16, 185, 129, 0.14);
          color: rgba(209, 250, 229, 0.95);
        }

        .subline {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .subTitle {
          font-size: 14px;
          font-weight: 900;
          opacity: 0.9;
        }

        .count {
          font-size: 13px;
          opacity: 0.65;
          font-weight: 900;
        }

        .err {
          margin-top: 10px;
          color: #f87171;
          font-weight: 700;
        }

        .loading {
          margin-top: 10px;
          opacity: 0.7;
          font-weight: 700;
        }

        /* Main grid */
        .main {
          padding: 14px 16px 96px;
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

        .small {
          opacity: 0.72;
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

        /* Mobile tweaks */
        @media (max-width: 520px) {
          .brandName {
            font-size: 22px;
          }
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}