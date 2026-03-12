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

type HiddenThreadRow = {
  thread_id: string;
};

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
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
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
  if (st.includes("reserve") || st === "reserved") return { label: "Reserved", tone: "warn" as const };
  if (st.includes("available")) return { label: "Available", tone: "good" as const };

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

function messagePreview(last: MessageRow | null) {
  if (!last) return "No messages yet.";
  if (last.deleted_at) return "Message deleted";

  const clean = (last.body || "").trim();
  return clean || "Sent an attachment";
}

export default function MessagesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "unread" | "active">("all");

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const uid = session?.user?.id ?? null;
    const email = session?.user?.email ?? null;

    setUserId(uid);
    setUserEmail(email);

    return { uid, email };
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

    const { data: hiddenData, error: hiddenErr } = await supabase
      .from("user_hidden_threads")
      .select("thread_id")
      .eq("user_id", uid);

    if (hiddenErr) {
      setErr(hiddenErr.message || "Could not load hidden conversations.");
      setCards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const hiddenIds = new Set(((hiddenData as HiddenThreadRow[]) || []).map((x) => x.thread_id));

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

    let threads = ((tData as unknown as ThreadRow[]) || []).filter(Boolean);
    threads = threads.filter((t) => !hiddenIds.has(t.id));

    if (threads.length === 0) {
      setCards([]);
      setSelectedIds([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const threadIds = threads.map((t) => t.id);

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

    const { data: rData } = await supabase
      .from("thread_reads")
      .select("thread_id,user_id,last_seen_at")
      .in("thread_id", threadIds)
      .eq("user_id", uid);

    const reads = (rData as ThreadReadRow[]) || [];
    const readMap: Record<string, string> = {};
    for (const r of reads) readMap[r.thread_id] = r.last_seen_at;

    const otherIds = Array.from(
      new Set(threads.map((t) => (t.owner_id === uid ? t.requester_id : t.owner_id)))
    );

    const { data: pData } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .in("id", otherIds);

    const profiles = (pData as ProfileRow[]) || [];
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
    setSelectedIds((prev) => prev.filter((id) => built.some((c) => c.thread.id === id)));
    setLoading(false);
    setRefreshing(false);
  }

  function openThread(threadId: string) {
    router.push(`/messages/${threadId}`);
  }

  function enterSelectMode() {
    setSelectMode(true);
    setSelectedIds([]);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }

  function toggleThreadSelected(threadId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(threadId)) return prev.filter((id) => id !== threadId);
      return [...prev, threadId];
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = filtered.map((c) => c.thread.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }

    setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
  }

  async function deleteSelectedThreads() {
    if (!userId || selectedIds.length === 0) return;

    const ok = window.confirm(
      selectedIds.length === 1
        ? "Delete this conversation from your inbox?"
        : `Delete ${selectedIds.length} conversations from your inbox?`
    );

    if (!ok) return;

    setDeleting(true);
    setErr(null);

    const payload = selectedIds.map((threadId) => ({
      user_id: userId,
      thread_id: threadId,
    }));

    const { error } = await supabase
      .from("user_hidden_threads")
      .upsert(payload, { onConflict: "user_id,thread_id" });

    if (error) {
      setErr(error.message || "Could not delete selected conversations.");
      setDeleting(false);
      return;
    }

    setCards((prev) => prev.filter((c) => !selectedIds.includes(c.thread.id)));
    setSelectedIds([]);
    setSelectMode(false);
    setDeleting(false);
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
      .channel(`inbox:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        loadInbox({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_reads" }, () => {
        loadInbox({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_hidden_threads" }, () => {
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
      if (e.key === "/") {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;

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
        if (st.includes("complete") || st === "completed" || st.includes("claim") || st === "claimed") {
          return false;
        }
      }

      if (!q) return true;

      const person = safeName(c.other);
      const role = c.other?.user_role ?? "";
      const itemTitle = c.thread.items?.title ?? "";
      const preview = messagePreview(c.last);

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
  }, [cards, query, tab]);

  const unreadTotal = useMemo(() => cards.reduce((sum, c) => sum + (c.unread || 0), 0), [cards]);

  const visibleSelectedCount = useMemo(() => {
    const visibleIds = new Set(filtered.map((c) => c.thread.id));
    return selectedIds.filter((id) => visibleIds.has(id)).length;
  }, [filtered, selectedIds]);

  const allVisibleSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((c) => selectedIds.includes(c.thread.id));
  }, [filtered, selectedIds]);

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", padding: 18 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div className="headerRow">
          <div className="headingBlock">
            <div className="heading">{selectMode ? "Select Conversations" : "Messages"}</div>
            <div className="subheading">
              {selectMode
                ? `${selectedIds.length} selected`
                : unreadTotal > 0
                ? `${unreadTotal} unread`
                : "All caught up"}
            </div>
          </div>

          <div className="headerActions">
            {!selectMode ? (
              <>
                <button
                  className="iconBtn"
                  onClick={() => router.push("/feed")}
                  type="button"
                  aria-label="Back to feed"
                >
                  ←
                </button>

                <button className="iconBtn" type="button" onClick={() => loadInbox()} aria-label="Refresh">
                  {refreshing ? "…" : "↻"}
                </button>

                <button className="textBtn" type="button" onClick={enterSelectMode} aria-label="Select threads">
                  Select
                </button>
              </>
            ) : (
              <>
                <button className="textBtn" type="button" onClick={exitSelectMode} aria-label="Cancel selecting">
                  Cancel
                </button>

                <button
                  className="textBtn"
                  type="button"
                  onClick={toggleSelectAllVisible}
                  aria-label={allVisibleSelected ? "Deselect all" : "Select all"}
                >
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="searchWrap">
          <div className="search">
            <span className="searchIcon">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, item, or message text…"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={selectMode}
            />
            {query ? (
              <button className="clearBtn" type="button" onClick={() => setQuery("")} aria-label="Clear search">
                ✕
              </button>
            ) : (
              <div className="searchHint">/</div>
            )}
          </div>
        </div>

        <div className="tabsWrap">
          <button
            className={`tab ${tab === "all" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("all")}
            disabled={selectMode}
          >
            All
          </button>

          <button
            className={`tab ${tab === "unread" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("unread")}
            disabled={selectMode}
          >
            Unread
            {unreadTotal > 0 ? <span className="tabCount">{unreadTotal}</span> : null}
          </button>

          <button
            className={`tab ${tab === "active" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("active")}
            disabled={selectMode}
          >
            Active
          </button>
        </div>

        {selectMode ? (
          <div className="selectionBar">
            <div className="selectionMeta">
              {visibleSelectedCount} of {filtered.length} visible selected
            </div>

            <button
              className="deleteBtn"
              type="button"
              onClick={deleteSelectedThreads}
              disabled={selectedIds.length === 0 || deleting}
            >
              {deleting ? "Deleting…" : selectedIds.length > 0 ? `Delete (${selectedIds.length})` : "Delete"}
            </button>
          </div>
        ) : null}

        {err ? <div className="errorBox">{err}</div> : null}
      </header>

      <main className="main">
        {!loading && filtered.length === 0 ? (
          <div className="emptyState">
            <div className="emptyIcon">💬</div>
            <div className="emptyTitle">No conversations yet</div>
            <div className="emptySub">Chats appear here once a request is accepted and a thread is opened.</div>

            <div className="emptyActions">
              <button className="ghostBtn" type="button" onClick={() => router.push("/feed")}>
                Browse feed
              </button>
              <button className="primaryBtn" type="button" onClick={() => router.push("/create")}>
                Create post
              </button>
            </div>
          </div>
        ) : (
          <div className="list">
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeletonRow">
                  <div className="skAvatar" />
                  <div className="skBody">
                    <div className="skLine short" />
                    <div className="skLine" />
                    <div className="skLine tiny" />
                  </div>
                </div>
              ))}

            {!loading &&
              filtered.map((c) => {
                const otherName = safeName(c.other);
                const role = c.other?.user_role || "student";
                const item = c.thread.items;
                const preview = messagePreview(c.last);
                const when = c.last?.created_at ? fmtWhen(c.last.created_at) : fmtWhen(c.thread.created_at);
                const pill = statusPill(item?.status);
                const unread = c.unread > 0;
                const checked = selectedIds.includes(c.thread.id);

                return (
                  <button
                    key={c.thread.id}
                    className={`chatRow ${unread ? "unread" : ""} ${selectMode ? "selecting" : ""} ${
                      checked ? "checked" : ""
                    }`}
                    type="button"
                    onClick={() => {
                      if (selectMode) {
                        toggleThreadSelected(c.thread.id);
                        return;
                      }
                      openThread(c.thread.id);
                    }}
                    aria-pressed={selectMode ? checked : undefined}
                  >
                    {selectMode ? (
                      <div className="checkCol" aria-hidden="true">
                        <span className={`checkCircle ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</span>
                      </div>
                    ) : null}

                    <div className="avatarWrap">
                      <div className="avatar">{initialsOf(otherName)}</div>
                      {!selectMode && unread ? <span className="presenceDot" /> : null}
                    </div>

                    <div className="rowMain">
                      <div className="topLine">
                        <div className="personBlock">
                          <span className={`personName ${unread ? "bold" : ""}`}>{otherName}</span>
                          <span className="roleText">{role}</span>
                        </div>

                        <div className={`timeText ${unread ? "bold" : ""}`}>{when}</div>
                      </div>

                      <div className="previewLine">
                        <span className={`previewText ${unread ? "bold" : ""}`}>{preview}</span>
                        {!selectMode && unread ? <span className="unreadBadge">{c.unread}</span> : null}
                      </div>

                      <div className="metaLine">
                        {item?.photo_url ? (
                          <span className="miniThumb">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.photo_url} alt={item.title || "Listing"} />
                          </span>
                        ) : (
                          <span className="miniThumb fallback">📦</span>
                        )}

                        <span className="itemTitle">{item?.title || "Listing"}</span>
                        <span className={`statusPill ${pill.tone}`}>{pill.label}</span>
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
          background:
            radial-gradient(circle at top, rgba(16, 185, 129, 0.06), transparent 22%),
            #f8fafc;
          color: #0f172a;
          padding-bottom: 118px;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 20;
          background: rgba(248, 250, 252, 0.94);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          padding: 14px 14px 12px;
        }

        .headerRow {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .headingBlock {
          min-width: 0;
        }

        .heading {
          font-size: 28px;
          line-height: 1;
          font-weight: 1000;
          letter-spacing: -0.04em;
          color: #0f172a;
        }

        .subheading {
          margin-top: 4px;
          font-size: 13px;
          font-weight: 800;
          color: #64748b;
        }

        .headerActions {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .iconBtn,
        .textBtn {
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.95);
          color: #0f172a;
          font-weight: 950;
          cursor: pointer;
        }

        .iconBtn {
          width: 44px;
          font-size: 18px;
        }

        .textBtn {
          padding: 0 14px;
          font-size: 13px;
        }

        .searchWrap {
          margin-top: 14px;
        }

        .search {
          height: 48px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.96);
          display: grid;
          grid-template-columns: 40px 1fr 40px;
          align-items: center;
          gap: 6px;
          padding: 0 8px;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
        }

        .searchIcon,
        .searchHint {
          display: grid;
          place-items: center;
          color: #94a3b8;
          font-size: 14px;
          font-weight: 900;
        }

        .search input {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-size: 14px;
          font-weight: 800;
          min-width: 0;
        }

        .search input:disabled {
          color: #94a3b8;
          cursor: not-allowed;
        }

        .search input::placeholder {
          color: #94a3b8;
        }

        .clearBtn {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
          color: #0f172a;
          font-weight: 950;
          cursor: pointer;
        }

        .tabsWrap {
          margin-top: 12px;
          display: inline-flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .tab {
          height: 36px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.9);
          color: #475569;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .tab:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .tab.active {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.22);
          color: #047857;
        }

        .tabCount {
          min-width: 18px;
          height: 18px;
          border-radius: 999px;
          background: #ef4444;
          color: white;
          font-size: 10px;
          font-weight: 950;
          display: grid;
          place-items: center;
          padding: 0 5px;
        }

        .selectionBar {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .selectionMeta {
          font-size: 13px;
          font-weight: 850;
          color: #475569;
        }

        .deleteBtn {
          height: 40px;
          border-radius: 12px;
          padding: 0 14px;
          border: 1px solid rgba(239, 68, 68, 0.18);
          background: rgba(239, 68, 68, 0.1);
          color: #b91c1c;
          font-size: 13px;
          font-weight: 950;
          cursor: pointer;
        }

        .deleteBtn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .errorBox {
          margin-top: 10px;
          border-radius: 16px;
          padding: 10px 12px;
          background: rgba(239, 68, 68, 0.08);
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
          border: 1px solid rgba(239, 68, 68, 0.16);
        }

        .main {
          max-width: 860px;
          margin: 0 auto;
          padding: 12px 14px 0;
        }

        .list {
          display: flex;
          flex-direction: column;
        }

        .chatRow {
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          display: grid;
          grid-template-columns: 56px 1fr;
          gap: 12px;
          padding: 12px 2px;
          cursor: pointer;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          transition: background 120ms ease, box-shadow 120ms ease;
        }

        .chatRow.selecting {
          grid-template-columns: 28px 56px 1fr;
          padding-left: 0;
        }

        .chatRow:hover {
          background: rgba(255, 255, 255, 0.45);
        }

        .chatRow.unread {
          background: rgba(16, 185, 129, 0.035);
        }

        .chatRow.checked {
          background: rgba(16, 185, 129, 0.08);
        }

        .checkCol {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .checkCircle {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 2px solid #cbd5e1;
          background: white;
          color: white;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 1000;
          flex-shrink: 0;
        }

        .checkCircle.checked {
          border-color: #10b981;
          background: #10b981;
          color: white;
        }

        .avatarWrap {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 2px;
        }

        .avatar {
          width: 48px;
          height: 48px;
          border-radius: 999px;
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          display: grid;
          place-items: center;
          font-size: 13px;
          font-weight: 950;
          box-shadow: 0 10px 22px rgba(16, 185, 129, 0.18);
        }

        .presenceDot {
          position: absolute;
          right: 1px;
          bottom: 2px;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: #10b981;
          border: 2px solid #f8fafc;
        }

        .rowMain {
          min-width: 0;
        }

        .topLine {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .personBlock {
          min-width: 0;
          display: flex;
          gap: 8px;
          align-items: baseline;
          flex-wrap: wrap;
        }

        .personName {
          font-size: 15px;
          color: #0f172a;
          font-weight: 850;
          letter-spacing: -0.01em;
        }

        .personName.bold,
        .previewText.bold,
        .timeText.bold {
          font-weight: 950;
        }

        .roleText {
          font-size: 12px;
          color: #94a3b8;
          font-weight: 800;
          text-transform: capitalize;
        }

        .timeText {
          font-size: 12px;
          color: #64748b;
          white-space: nowrap;
          font-weight: 800;
        }

        .previewLine {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .previewText {
          min-width: 0;
          flex: 1;
          font-size: 13px;
          color: #475569;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .unreadBadge {
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          border-radius: 999px;
          background: #10b981;
          color: white;
          font-size: 11px;
          font-weight: 950;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .metaLine {
          margin-top: 7px;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .miniThumb {
          width: 20px;
          height: 20px;
          border-radius: 6px;
          overflow: hidden;
          background: #eef2f7;
          border: 1px solid rgba(15, 23, 42, 0.06);
          flex-shrink: 0;
          display: grid;
          place-items: center;
          font-size: 10px;
          color: #64748b;
        }

        .miniThumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .itemTitle {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          color: #64748b;
          font-weight: 800;
        }

        .statusPill {
          flex-shrink: 0;
          height: 22px;
          border-radius: 999px;
          padding: 0 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 950;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(15, 23, 42, 0.04);
          color: #475569;
        }

        .statusPill.good {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.24);
          color: #047857;
        }

        .statusPill.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.24);
          color: #92400e;
        }

        .statusPill.done {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.24);
          color: #1d4ed8;
        }

        .emptyState {
          margin-top: 10px;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 24px;
          padding: 24px 18px;
          text-align: center;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.06);
        }

        .emptyIcon {
          font-size: 36px;
        }

        .emptyTitle {
          margin-top: 10px;
          font-size: 20px;
          font-weight: 950;
          color: #0f172a;
        }

        .emptySub {
          margin-top: 6px;
          font-size: 14px;
          line-height: 1.4;
          color: #64748b;
          font-weight: 700;
          max-width: 460px;
          margin-left: auto;
          margin-right: auto;
        }

        .emptyActions {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .ghostBtn,
        .primaryBtn {
          height: 46px;
          border-radius: 16px;
          font-weight: 950;
          cursor: pointer;
        }

        .ghostBtn {
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
          color: #0f172a;
        }

        .primaryBtn {
          border: 1px solid rgba(16, 185, 129, 0.24);
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
        }

        .skeletonRow {
          display: grid;
          grid-template-columns: 56px 1fr;
          gap: 12px;
          padding: 14px 2px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
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
          animation: shimmer 1.4s infinite linear;
        }

        .skAvatar {
          width: 48px;
          height: 48px;
          border-radius: 999px;
        }

        .skBody {
          display: grid;
          gap: 8px;
          align-content: center;
        }

        .skLine {
          height: 12px;
          border-radius: 999px;
        }

        .skLine.short {
          width: 42%;
        }

        .skLine.tiny {
          width: 26%;
        }

        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }

        @media (min-width: 860px) {
          .header {
            padding-left: 18px;
            padding-right: 18px;
          }

          .main {
            padding-left: 18px;
            padding-right: 18px;
          }
        }
      `}</style>
    </div>
  );
}