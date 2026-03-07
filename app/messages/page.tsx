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

type ThreadReadRow = {
  thread_id: string;
  user_id: string;
  last_seen_at: string;
};

type ThreadCard = {
  thread: ThreadRow;
  other: ProfileRow | null;
  last: MessageRow | null;
  unread: number;
};

function isoToMs(iso?: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function fmtWhen(ts: string) {
  const d = new Date(ts);
  const now = new Date();

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (isYesterday) return "Yesterday";

  const diff = now.getTime() - d.getTime();
  const withinWeek = diff < 1000 * 60 * 60 * 24 * 7;

  if (withinWeek) {
    return d.toLocaleDateString([], { weekday: "short" });
  }

  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

function statusMeta(status: string | null | undefined) {
  const st = normStatus(status);

  if (!st) return { label: "Active", tone: "neutral" as const };
  if (st.includes("complete") || st === "completed")
    return { label: "Completed", tone: "done" as const };
  if (st.includes("claim") || st === "claimed")
    return { label: "Claimed", tone: "done" as const };
  if (st.includes("reserve") || st === "reserved")
    return { label: "Reserved", tone: "warn" as const };
  if (st.includes("available"))
    return { label: "Available", tone: "good" as const };

  return { label: "Active", tone: "neutral" as const };
}

function initialsOf(name?: string | null) {
  const clean = (name || "").trim();
  if (!clean) return "AU";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "AU";
}

function safeName(profile: ProfileRow | null) {
  const n = (profile?.full_name ?? "").trim();
  return n || "Campus user";
}

function cleanRole(role?: string | null) {
  const v = (role || "").trim().toLowerCase();
  if (!v) return "";
  return v;
}

function messagePreview(last: MessageRow | null, currentUserId?: string | null) {
  if (!last) return "Start the conversation";
  if (last.deleted_at) return "Message deleted";

  const clean = (last.body || "").trim() || "Sent an attachment";
  if (currentUserId && last.sender_id === currentUserId) return `You: ${clean}`;
  return clean;
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
  const [tab, setTab] = useState<"all" | "unread" | "active">("all");

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

    return {
      uid: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    };
  }

  async function loadInbox(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;

    if (!silent) setLoading(true);
    else setRefreshing(true);

    setErr(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id ?? null;
    const email = sessionData.session?.user?.email ?? null;

    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    const { data: threadData, error: threadErr } = await supabase
      .from("threads")
      .select("id,item_id,owner_id,requester_id,created_at, items:items(id,title,photo_url,status)")
      .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
      .order("created_at", { ascending: false });

    if (threadErr) {
      setErr(threadErr.message || "Error loading conversations.");
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const threads = ((threadData as unknown as ThreadRow[]) || []).filter(Boolean);

    if (threads.length === 0) {
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const threadIds = threads.map((t) => t.id);

    const { data: messageData, error: messageErr } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at,deleted_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    if (messageErr) {
      setErr(messageErr.message || "Error loading messages.");
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const msgs = (messageData as MessageRow[]) || [];
    const lastByThread: Record<string, MessageRow> = {};

    for (const m of msgs) {
      if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m;
    }

    const { data: readData } = await supabase
      .from("thread_reads")
      .select("thread_id,user_id,last_seen_at")
      .in("thread_id", threadIds)
      .eq("user_id", uid);

    const reads = (readData as ThreadReadRow[]) || [];
    const readMap: Record<string, string> = {};
    for (const r of reads) readMap[r.thread_id] = r.last_seen_at;

    const otherIds = Array.from(
      new Set(threads.map((t) => (t.owner_id === uid ? t.requester_id : t.owner_id)).filter(Boolean)),
    );

    const { data: profileData } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .in("id", otherIds);

    const profiles = (profileData as ProfileRow[]) || [];
    const profileMap: Record<string, ProfileRow> = {};
    for (const p of profiles) profileMap[p.id] = p;

    const unreadByThread: Record<string, number> = {};
    for (const tId of threadIds) unreadByThread[tId] = 0;

    for (const m of msgs) {
      if (m.sender_id === uid) continue;
      if (m.deleted_at) continue;

      const seenAt = readMap[m.thread_id] || null;
      if (!seenAt) unreadByThread[m.thread_id] += 1;
      else if (isoToMs(m.created_at) > isoToMs(seenAt)) unreadByThread[m.thread_id] += 1;
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
      if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
      const at = isoToMs(a.last?.created_at || a.thread.created_at);
      const bt = isoToMs(b.last?.created_at || b.thread.created_at);
      return bt - at;
    });

    setCards(built);
    setLoading(false);
    setRefreshing(false);
  }

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

  useEffect(() => {
    if (!userId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel(`inbox-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        loadInbox({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_reads" }, () => {
        loadInbox({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "threads" }, () => {
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (window.innerWidth < 768) return;
      if (e.key !== "/") return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName?.toLowerCase();

      if (tag === "input" || tag === "textarea") return;

      e.preventDefault();
      searchRef.current?.focus();
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
        if (st.includes("complete") || st === "completed" || st.includes("claim") || st === "claimed") {
          return false;
        }
      }

      if (!q) return true;

      const person = safeName(c.other);
      const role = c.other?.user_role ?? "";
      const itemTitle = c.thread.items?.title ?? "";
      const preview = messagePreview(c.last, userId);

      const blob = `${person} ${role} ${itemTitle} ${preview}`.toLowerCase();
      return blob.includes(q);
    });

    list = [...list].sort((a, b) => {
      if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
      const at = isoToMs(a.last?.created_at || a.thread.created_at);
      const bt = isoToMs(b.last?.created_at || b.thread.created_at);
      return bt - at;
    });

    return list;
  }, [cards, query, tab, userId]);

  const unreadTotal = useMemo(() => cards.reduce((sum, c) => sum + c.unread, 0), [cards]);

  if (!isAshland) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
          color: "#0f172a",
          padding: 18,
          fontWeight: 700,
        }}
      >
        Checking access…
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div className="topBar">
          <button
            className="topIconBtn"
            onClick={() => router.push("/feed")}
            type="button"
            aria-label="Back to feed"
          >
            ←
          </button>

          <div className="titleBlock">
            <div className="title">Messages</div>
            <div className="subtitle">{unreadTotal > 0 ? `${unreadTotal} unread` : "All caught up"}</div>
          </div>

          <button
            className="topIconBtn"
            type="button"
            onClick={() => loadInbox({ silent: true })}
            aria-label="Refresh messages"
          >
            {refreshing ? "…" : "↻"}
          </button>
        </div>

        <div className="searchWrap">
          <div className="search">
            <span className="searchIcon">⌕</span>

            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            {query ? (
              <button className="clearBtn" type="button" onClick={() => setQuery("")} aria-label="Clear search">
                ✕
              </button>
            ) : (
              <span className="searchHint">/</span>
            )}
          </div>
        </div>

        <div className="segmentedWrap" aria-label="Conversation filters">
          <button
            className={`segment ${tab === "all" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("all")}
          >
            All
          </button>

          <button
            className={`segment ${tab === "unread" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("unread")}
          >
            Unread
            {unreadTotal > 0 ? <span className="segmentCount">{unreadTotal}</span> : null}
          </button>

          <button
            className={`segment ${tab === "active" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("active")}
          >
            Active
          </button>
        </div>

        {err ? <div className="errorBox">{err}</div> : null}
      </header>

      <main className="main">
        {!loading && filtered.length === 0 ? (
          <div className="emptyState">
            <div className="emptyBubble">💬</div>
            <div className="emptyTitle">No conversations yet</div>
            <div className="emptyText">
              When someone replies to your listing or request, your chats will appear here.
            </div>

            <button className="emptyPrimaryBtn" type="button" onClick={() => router.push("/feed")}>
              Browse feed
            </button>
          </div>
        ) : (
          <div className="threadList">
            {loading &&
              Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="skeletonRow">
                  <div className="skAvatar" />
                  <div className="skContent">
                    <div className="skLine skLineName" />
                    <div className="skLine skLineMessage" />
                    <div className="skLine skLineMeta" />
                  </div>
                </div>
              ))}

            {!loading &&
              filtered.map((c) => {
                const otherName = safeName(c.other);
                const role = cleanRole(c.other?.user_role);
                const item = c.thread.items;
                const unread = c.unread > 0;
                const preview = messagePreview(c.last, userId);
                const time = c.last?.created_at ? fmtWhen(c.last.created_at) : fmtWhen(c.thread.created_at);
                const status = statusMeta(item?.status);

                return (
                  <button
                    key={c.thread.id}
                    type="button"
                    className={`threadRow ${unread ? "unread" : ""}`}
                    onClick={() => router.push(`/messages/${c.thread.id}`)}
                  >
                    <div className="avatarWrap">
                      <div className="avatar">{initialsOf(otherName)}</div>
                    </div>

                    <div className="threadMain">
                      <div className="rowTop">
                        <div className="nameWrap">
                          <span className={`nameText ${unread ? "strong" : ""}`}>{otherName}</span>
                          {role ? <span className="roleText">{role}</span> : null}
                        </div>

                        <div className={`timeText ${unread ? "strong" : ""}`}>{time}</div>
                      </div>

                      <div className="rowMiddle">
                        <div className={`messageText ${unread ? "strong" : ""}`}>{preview}</div>
                        {unread ? <div className="unreadBadge">{c.unread}</div> : null}
                      </div>

                      <div className="rowBottom">
                        {item?.photo_url ? (
                          <span className="itemThumb">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.photo_url} alt={item.title || "Listing"} />
                          </span>
                        ) : (
                          <span className="itemThumb fallback">📦</span>
                        )}

                        <span className="itemMetaText">{item?.title || "Listing"}</span>
                        <span className={`itemStatus ${status.tone}`}>{status.label}</span>
                      </div>
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
          background: #f8fafc;
          color: #0f172a;
          padding-bottom: 110px;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 30;
          padding: 10px 12px 12px;
          background: rgba(248, 250, 252, 0.9);
          backdrop-filter: blur(18px);
          border-bottom: 1px solid rgba(15, 23, 42, 0.05);
        }

        .topBar {
          display: grid;
          grid-template-columns: 44px 1fr 44px;
          align-items: center;
          gap: 10px;
        }

        .topIconBtn {
          width: 44px;
          height: 44px;
          border: none;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.82);
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          display: grid;
          place-items: center;
          cursor: pointer;
          transition: transform 0.12s ease, background 0.12s ease;
        }

        .topIconBtn:active {
          transform: scale(0.96);
        }

        .titleBlock {
          min-width: 0;
          text-align: center;
        }

        .title {
          font-size: 21px;
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .subtitle {
          margin-top: 3px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
        }

        .searchWrap {
          margin-top: 12px;
        }

        .search {
          height: 46px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.045);
          display: grid;
          grid-template-columns: 38px 1fr 38px;
          align-items: center;
          gap: 4px;
          padding: 0 8px;
        }

        .searchIcon,
        .searchHint {
          display: grid;
          place-items: center;
          color: #94a3b8;
          font-size: 13px;
          font-weight: 900;
        }

        .search input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-size: 14px;
          font-weight: 700;
        }

        .search input::placeholder {
          color: #94a3b8;
        }

        .clearBtn {
          width: 30px;
          height: 30px;
          border: none;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.08);
          color: #475569;
          font-size: 12px;
          font-weight: 900;
          display: grid;
          place-items: center;
          cursor: pointer;
        }

        .segmentedWrap {
          margin-top: 12px;
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          padding: 4px;
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.045);
        }

        .segment {
          height: 38px;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.14s ease;
        }

        .segment.active {
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
        }

        .segmentCount {
          min-width: 18px;
          height: 18px;
          border-radius: 999px;
          padding: 0 5px;
          background: #10b981;
          color: #ffffff;
          font-size: 10px;
          font-weight: 900;
          display: grid;
          place-items: center;
        }

        .errorBox {
          margin-top: 10px;
          padding: 11px 12px;
          border-radius: 14px;
          background: rgba(239, 68, 68, 0.08);
          color: #b91c1c;
          font-size: 13px;
          font-weight: 800;
        }

        .main {
          max-width: 820px;
          margin: 0 auto;
          padding: 6px 10px 0;
        }

        .threadList {
          display: flex;
          flex-direction: column;
        }

        .threadRow {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          display: grid;
          grid-template-columns: 60px 1fr;
          gap: 12px;
          padding: 14px 8px;
          border-radius: 18px;
          cursor: pointer;
          transition: background 0.14s ease, transform 0.12s ease;
        }

        .threadRow:active {
          transform: scale(0.995);
        }

        .threadRow:hover {
          background: rgba(255, 255, 255, 0.72);
        }

        .threadRow.unread {
          background: rgba(255, 255, 255, 0.82);
        }

        .avatarWrap {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 2px;
        }

        .avatar {
          width: 52px;
          height: 52px;
          border-radius: 999px;
          background: linear-gradient(135deg, #0f172a, #334155);
          color: white;
          display: grid;
          place-items: center;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.02em;
        }

        .threadMain {
          min-width: 0;
          padding-top: 1px;
        }

        .rowTop {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }

        .nameWrap {
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 7px;
          flex-wrap: wrap;
        }

        .nameText {
          min-width: 0;
          font-size: 15px;
          color: #0f172a;
          font-weight: 800;
          letter-spacing: -0.01em;
        }

        .nameText.strong,
        .messageText.strong,
        .timeText.strong {
          font-weight: 900;
        }

        .roleText {
          font-size: 12px;
          color: #94a3b8;
          font-weight: 700;
          text-transform: capitalize;
        }

        .timeText {
          flex-shrink: 0;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
          white-space: nowrap;
        }

        .rowMiddle {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .messageText {
          min-width: 0;
          flex: 1;
          color: #475569;
          font-size: 14px;
          font-weight: 700;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .unreadBadge {
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          border-radius: 999px;
          background: #10b981;
          color: #ffffff;
          font-size: 11px;
          font-weight: 900;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .rowBottom {
          margin-top: 7px;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .itemThumb {
          width: 20px;
          height: 20px;
          border-radius: 6px;
          overflow: hidden;
          background: #e2e8f0;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          font-size: 10px;
        }

        .itemThumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .fallback {
          color: #64748b;
        }

        .itemMetaText {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .itemStatus {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 800;
          padding: 0 0 0 2px;
        }

        .itemStatus.neutral {
          color: #64748b;
        }

        .itemStatus.good {
          color: #047857;
        }

        .itemStatus.warn {
          color: #b45309;
        }

        .itemStatus.done {
          color: #2563eb;
        }

        .emptyState {
          margin-top: 22px;
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.82);
          padding: 34px 20px 28px;
          text-align: center;
          box-shadow: 0 12px 40px rgba(15, 23, 42, 0.05);
        }

        .emptyBubble {
          width: 68px;
          height: 68px;
          border-radius: 999px;
          margin: 0 auto;
          display: grid;
          place-items: center;
          font-size: 30px;
          background: rgba(15, 23, 42, 0.05);
        }

        .emptyTitle {
          margin-top: 14px;
          font-size: 22px;
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.03em;
          color: #0f172a;
        }

        .emptyText {
          margin: 8px auto 0;
          max-width: 420px;
          font-size: 14px;
          line-height: 1.5;
          color: #64748b;
          font-weight: 700;
        }

        .emptyPrimaryBtn {
          margin-top: 18px;
          height: 48px;
          border: none;
          border-radius: 16px;
          padding: 0 18px;
          background: #0f172a;
          color: #ffffff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .skeletonRow {
          display: grid;
          grid-template-columns: 60px 1fr;
          gap: 12px;
          padding: 14px 8px;
        }

        .skAvatar,
        .skLine {
          background: linear-gradient(
            90deg,
            rgba(226, 232, 240, 0.8),
            rgba(241, 245, 249, 1),
            rgba(226, 232, 240, 0.8)
          );
          background-size: 200% 100%;
          animation: shimmer 1.35s linear infinite;
        }

        .skAvatar {
          width: 52px;
          height: 52px;
          border-radius: 999px;
        }

        .skContent {
          display: grid;
          gap: 9px;
          align-content: center;
        }

        .skLine {
          height: 12px;
          border-radius: 999px;
        }

        .skLineName {
          width: 38%;
        }

        .skLineMessage {
          width: 72%;
        }

        .skLineMeta {
          width: 46%;
        }

        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }

        @media (max-width: 767px) {
          .searchHint {
            display: none;
          }

          .main {
            padding-left: 8px;
            padding-right: 8px;
          }

          .threadRow {
            padding-left: 8px;
            padding-right: 8px;
          }
        }

        @media (min-width: 768px) {
          .header {
            padding-left: 18px;
            padding-right: 18px;
          }

          .main {
            padding-left: 18px;
            padding-right: 18px;
          }

          .title {
            font-size: 24px;
          }

          .threadRow {
            grid-template-columns: 64px 1fr;
            padding: 15px 10px;
          }

          .avatar {
            width: 56px;
            height: 56px;
          }
        }
      `}</style>
    </div>
  );
}