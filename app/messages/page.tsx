"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  user_role: string | null;
};

type ItemRow = {
  id: string;
  title: string;
  photo_url: string | null;
  status: string | null;
};

type ThreadRow = {
  id: string;
  item_id: string;
  owner_id: string;
  requester_id: string;
  created_at: string;
  items: ItemRow | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at?: string | null;
};

type ThreadReadRow = { thread_id: string; user_id: string; last_seen_at: string };

type ThreadCard = {
  thread: ThreadRow;
  other: ProfileRow | null;
  last: MessageRow | null;
  unread: number;
};

function fmtWhen(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isoToMs(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

function statusPill(status: string | null | undefined) {
  const st = normStatus(status);
  if (!st) return { label: "Active", tone: "neutral" as const };
  if (st.includes("complete") || st === "completed") return { label: "Completed", tone: "done" as const };
  if (st.includes("claim") || st === "claimed") return { label: "Claimed", tone: "done" as const };
  if (st.includes("reserve") || st === "reserved") return { label: "In talks", tone: "warn" as const };
  if (st.includes("available")) return { label: "Available", tone: "good" as const };
  return { label: "Active", tone: "neutral" as const };
}

export default function MessagesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "all" | "unread">("active");

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
    return { uid: session?.user?.id ?? null, email: session?.user?.email ?? null };
  }

  async function loadInbox(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    else setRefreshing(true);

    setErr(null);

    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id ?? null;
    const email = s.session?.user?.email ?? null;

    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    const { data: tData, error: tErr } = await supabase
      .from("threads")
      .select("id,item_id,owner_id,requester_id,created_at, items:items(id,title,photo_url,status)")
      .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
      .order("created_at", { ascending: false });

    if (tErr) {
      setErr(tErr.message || "Error loading conversations.");
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const threads = ((tData as unknown as ThreadRow[]) || []).filter(Boolean);

    if (threads.length === 0) {
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const threadIds = threads.map((t) => t.id);

    // last messages
    const { data: mData, error: mErr } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at,deleted_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    if (mErr) {
      setErr(mErr.message || "Error loading messages.");
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const msgs = (mData as MessageRow[]) || [];
    const lastByThread: Record<string, MessageRow> = {};
    for (const m of msgs) {
      if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m;
    }

    // reads for me
    const { data: rData } = await supabase
      .from("thread_reads")
      .select("thread_id,user_id,last_seen_at")
      .in("thread_id", threadIds)
      .eq("user_id", uid);

    const reads = (rData as ThreadReadRow[]) || [];
    const readMap: Record<string, string> = {};
    for (const r of reads) readMap[r.thread_id] = r.last_seen_at;

    // profiles (other side)
    const otherIds = Array.from(new Set(threads.map((t) => (t.owner_id === uid ? t.requester_id : t.owner_id))));

    const { data: pData } = await supabase.from("profiles").select("id,full_name,user_role").in("id", otherIds);

    const profiles = ((pData as ProfileRow[]) || []);
    const profileMap: Record<string, ProfileRow> = {};
    for (const p of profiles) profileMap[p.id] = p;

    // unread counts (compute from already fetched msgs)
    const unreadByThread: Record<string, number> = {};
    for (const tId of threadIds) unreadByThread[tId] = 0;

    for (const m of msgs) {
      if (m.sender_id === uid) continue;
      if (m.deleted_at) continue;

      const seenAt = readMap[m.thread_id] || null;
      if (!seenAt) {
        unreadByThread[m.thread_id] += 1;
      } else {
        if (isoToMs(m.created_at) > isoToMs(seenAt)) unreadByThread[m.thread_id] += 1;
      }
    }

    const built: ThreadCard[] = threads.map((t) => {
      const otherId = t.owner_id === uid ? t.requester_id : t.owner_id;
      return {
        thread: t,
        other: profileMap[otherId] || null,
        last: lastByThread[t.id] || null,
        unread: unreadByThread[t.id] || 0,
      };
    });

    built.sort((a, b) => {
      const at = isoToMs(a.last?.created_at || a.thread.created_at);
      const bt = isoToMs(b.last?.created_at || b.thread.created_at);
      return bt - at;
    });

    setCards(built);
    setLoading(false);
    setRefreshing(false);
  }

  // Initial load
  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadInbox();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadInbox();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime refresh (lightweight)
  useEffect(() => {
    if (!userId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        loadInbox({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_reads" }, () => {
        loadInbox({ silent: true });
      })
      .subscribe();

    channelRef.current = ch;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // keyboard shortcut: "/" focuses search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = cards.filter((c) => {
      if (tab === "unread" && c.unread <= 0) return false;
      if (tab === "active") {
        const st = normStatus(c.thread.items?.status);
        if (st.includes("complete") || st === "completed" || st.includes("claim") || st === "claimed") return false;
      }

      if (!q) return true;

      const itemTitle = c.thread.items?.title ?? "";
      const otherName = c.other?.full_name ?? "";
      const otherRole = c.other?.user_role ?? "";
      const lastBody = c.last?.deleted_at ? "" : c.last?.body ?? "";

      const blob = `${itemTitle} ${otherName} ${otherRole} ${lastBody}`.toLowerCase();
      return blob.includes(q);
    });

    // keep unread at top, then recency
    list = [...list].sort((a, b) => {
      if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
      const at = isoToMs(a.last?.created_at || a.thread.created_at);
      const bt = isoToMs(b.last?.created_at || b.thread.created_at);
      return bt - at;
    });

    return list;
  }, [cards, query, tab]);

  const unreadTotal = useMemo(() => cards.reduce((s, c) => s + (c.unread || 0), 0), [cards]);

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f8", color: "#0f172a", padding: 18 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div className="page">
      {/* top header */}
      <header className="top">
        <div className="topRow">
          <button className="backBtn" onClick={() => router.push("/feed")} type="button">
            <span aria-hidden>←</span> Back
          </button>

          <div className="brand">
            <div className="brandName">ScholarSwap</div>
            <div className="brandSub">Messages</div>
          </div>

          <button className="refreshBtn" type="button" onClick={() => loadInbox()} aria-label="Refresh">
            {refreshing ? "…" : "↻"}
          </button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "active" ? "on" : ""}`} onClick={() => setTab("active")} type="button">
            Active
          </button>
          <button className={`tab ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")} type="button">
            All
          </button>
          <button className={`tab ${tab === "unread" ? "on" : ""}`} onClick={() => setTab("unread")} type="button">
            Unread {unreadTotal > 0 ? `(${unreadTotal})` : ""}
          </button>
          <span className={`tabIndicator ${tab}`} aria-hidden="true" />
        </div>

        <div className="searchWrap">
          <div className="search">
            <span className="searchIcon" aria-hidden>
              🔎
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search by item, person, or text… (press "/")'
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {query ? (
              <button className="clear" onClick={() => setQuery("")} type="button" aria-label="Clear search">
                ✕
              </button>
            ) : (
              <span className="kbd" aria-hidden>
                /
              </span>
            )}
          </div>
        </div>

        {err && <div className="err">{err}</div>}

        <div className="hintRow">
          <div className="hintText">
            Conversations appear after an accepted offer. This is your deal hub — not just chat.
          </div>
          {loading ? <div className="mini">Loading…</div> : <div className="mini">{filtered.length} chats</div>}
        </div>
      </header>

      {/* body */}
      <main className="main">
        {!loading && filtered.length === 0 ? (
          <div className="empty">
            <div className="emptyTitle">No conversations yet.</div>
            <div className="emptySub">
              Once a seller accepts your request (or you accept a requester), the chat shows here.
            </div>
            <div className="emptyActions">
              <button className="ghost" onClick={() => router.push("/feed")} type="button">
                Browse feed
              </button>
              <button className="primary" onClick={() => router.push("/create")} type="button">
                Create post
              </button>
            </div>
          </div>
        ) : (
          <div className="list">
            {filtered.map((c) => {
              const item = c.thread.items;
              const otherName = c.other?.full_name || "Campus user";
              const otherRole = c.other?.user_role || "student";

              const lastText = c.last?.deleted_at ? "Message deleted" : c.last?.body || "No messages yet.";
              const when = c.last?.created_at ? fmtWhen(c.last.created_at) : fmtWhen(c.thread.created_at);

              const pill = statusPill(item?.status);

              return (
                <button
                  key={c.thread.id}
                  className="card"
                  type="button"
                  onClick={() => router.push(`/messages/${c.thread.id}`)}
                >
                  <div className="thumb">
                    {item?.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.photo_url} alt={item.title || "Item"} />
                    ) : (
                      <div className="noThumb">
                        <span aria-hidden>📦</span>
                      </div>
                    )}
                    {c.unread > 0 && <span className="dot" aria-label={`${c.unread} unread`} />}
                  </div>

                  <div className="content">
                    <div className="topLine">
                      <div className="title">
                        <span className="titleText">{item?.title || "Listing"}</span>
                        <span className={`pill ${pill.tone}`}>{pill.label}</span>
                      </div>
                      <div className="when">{when}</div>
                    </div>

                    <div className="subLine">
                      <span className="with">
                        with <b>{otherName}</b>
                      </span>
                      <span className="sep">•</span>
                      <span className="role">{otherRole}</span>
                      {c.unread > 0 && (
                        <>
                          <span className="sep">•</span>
                          <span className="unreadText">{c.unread} new</span>
                        </>
                      )}
                    </div>

                    <div className="preview">{lastText}</div>
                  </div>

                  <div className="chev" aria-hidden>
                    ›
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f7f7f8;
          color: #0f172a;
          padding-bottom: 110px;
        }

        .top {
          position: sticky;
          top: 0;
          z-index: 20;
          background: rgba(247, 247, 248, 0.92);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid #e5e7eb;
        }

        .topRow {
          display: grid;
          grid-template-columns: 88px 1fr 44px;
          align-items: center;
          gap: 10px;
          padding: 14px 14px 10px;
        }

        .backBtn {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 999px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 950;
          color: #111827;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .brand {
          min-width: 0;
          text-align: center;
        }

        .brandName {
          font-weight: 950;
          letter-spacing: -0.4px;
          font-size: 16px;
          line-height: 1.1;
        }

        .brandSub {
          font-size: 12px;
          color: #6b7280;
          font-weight: 900;
          margin-top: 2px;
        }

        .refreshBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .tabs {
          position: relative;
          margin: 0 14px 10px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 999px;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          overflow: hidden;
        }

        .tab {
          border: none;
          background: transparent;
          padding: 12px 10px;
          cursor: pointer;
          font-weight: 950;
          color: #6b7280;
          z-index: 2;
        }

        .tab.on {
          color: #065f46;
        }

        .tabIndicator {
          position: absolute;
          top: 3px;
          bottom: 3px;
          width: calc(33.333% - 6px);
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
          z-index: 1;
          transition: transform 180ms ease;
        }

        .tabIndicator.active {
          transform: translateX(3px);
        }
        .tabIndicator.all {
          transform: translateX(calc(100% + 3px));
        }
        .tabIndicator.unread {
          transform: translateX(calc(200% + 3px));
        }

        .searchWrap {
          padding: 0 14px 12px;
        }

        .search {
          height: 46px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          display: grid;
          grid-template-columns: 40px 1fr 40px;
          align-items: center;
          padding: 0 6px;
          gap: 8px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .searchIcon {
          width: 40px;
          text-align: center;
          opacity: 0.8;
        }

        .search input {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          color: #111827;
          font-weight: 900;
          font-size: 14px;
          min-width: 0;
        }

        .search input::placeholder {
          color: #9ca3af;
          font-weight: 800;
        }

        .clear,
        .kbd {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          display: grid;
          place-items: center;
          font-weight: 950;
          color: #111827;
        }

        .clear {
          cursor: pointer;
        }

        .kbd {
          color: #9ca3af;
          background: #ffffff;
        }

        .err {
          padding: 0 14px 10px;
          color: #b91c1c;
          font-weight: 900;
        }

        .hintRow {
          padding: 0 14px 12px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
        }

        .hintText {
          font-size: 12px;
          color: #6b7280;
          font-weight: 800;
        }

        .mini {
          font-size: 12px;
          color: #6b7280;
          font-weight: 900;
          white-space: nowrap;
        }

        .main {
          padding: 14px;
          max-width: 860px;
          margin: 0 auto;
        }

        .empty {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
        }

        .emptyTitle {
          font-weight: 950;
          font-size: 18px;
          color: #111827;
        }

        .emptySub {
          margin-top: 6px;
          color: #6b7280;
          font-weight: 700;
          line-height: 1.35;
        }

        .emptyActions {
          margin-top: 12px;
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
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
          font-weight: 950;
          cursor: pointer;
        }

        .list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .card {
          width: 100%;
          text-align: left;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 12px;
          display: grid;
          grid-template-columns: 64px 1fr 16px;
          gap: 12px;
          align-items: center;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
          transition: transform 120ms ease, box-shadow 120ms ease;
        }

        .card:active {
          transform: translateY(1px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
        }

        .thumb {
          position: relative;
          width: 64px;
          height: 64px;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          flex-shrink: 0;
        }

        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .noThumb {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          color: #6b7280;
          font-weight: 950;
          font-size: 18px;
        }

        .dot {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #ef4444;
          box-shadow: 0 0 0 2px #ffffff;
        }

        .content {
          min-width: 0;
        }

        .topLine {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
        }

        .title {
          display: flex;
          gap: 8px;
          align-items: center;
          min-width: 0;
        }

        .titleText {
          font-weight: 950;
          font-size: 16px;
          color: #111827;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 520px;
        }

        .pill {
          flex-shrink: 0;
          font-size: 12px;
          font-weight: 950;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #6b7280;
        }

        .pill.good {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
          color: #065f46;
        }

        .pill.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.25);
          color: #92400e;
        }

        .pill.done {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.25);
          color: #1e3a8a;
        }

        .when {
          color: #6b7280;
          font-weight: 900;
          font-size: 12px;
          white-space: nowrap;
        }

        .subLine {
          margin-top: 4px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 800;
        }

        .sep {
          opacity: 0.6;
        }

        .unreadText {
          color: #b91c1c;
          font-weight: 950;
        }

        .preview {
          margin-top: 8px;
          color: #374151;
          font-weight: 700;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .chev {
          color: #9ca3af;
          font-weight: 950;
          font-size: 20px;
          text-align: right;
        }

        @media (min-width: 860px) {
          .topRow {
            padding-left: 18px;
            padding-right: 18px;
          }
          .searchWrap,
          .hintRow {
            padding-left: 18px;
            padding-right: 18px;
          }
          .tabs {
            margin-left: 18px;
            margin-right: 18px;
          }
          .main {
            padding: 16px 18px;
          }
        }
      `}</style>
    </div>
  );
}