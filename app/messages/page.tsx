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

export default function MessagesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

  async function loadInbox() {
    setLoading(true);
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
      return;
    }

    const threads = ((tData as unknown as ThreadRow[]) || []).filter(Boolean);

    if (threads.length === 0) {
      setCards([]);
      setLoading(false);
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

    // unread counts (cheap: compute from already fetched msgs)
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
        loadInbox();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_reads" }, () => {
        loadInbox();
      })
      .subscribe();

    channelRef.current = ch;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!isAshland) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Checking access…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0 }}>Messages</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>Conversations appear here only after a seller accepts a request.</p>

      {err && <p style={{ color: "#f87171", marginTop: 10 }}>{err}</p>}
      {loading && <p style={{ marginTop: 10, opacity: 0.8 }}>Loading…</p>}

      {!loading && cards.length === 0 && (
        <div
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(148,163,184,0.18)",
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18 }}>No conversations yet.</div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            Once a seller accepts your request (or you accept a requester on your listing), a chat will appear here.
          </div>
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((c) => {
          const item = c.thread.items;
          const otherName = c.other?.full_name || "Campus user";
          const otherRole = c.other?.user_role || "student";

          const lastText = c.last?.deleted_at ? "Message deleted" : (c.last?.body || "No messages yet.");
          const when = c.last?.created_at ? fmtWhen(c.last.created_at) : fmtWhen(c.thread.created_at);

          return (
            <button
              key={c.thread.id}
              type="button"
              onClick={() => router.push(`/messages/${c.thread.id}`)}
              style={{
                textAlign: "left",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 16,
                padding: 14,
                cursor: "pointer",
                color: "white",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              {item?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.photo_url}
                  alt={item.title}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    objectFit: "cover",
                    border: "1px solid rgba(148,163,184,0.18)",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    border: "1px dashed rgba(148,163,184,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(148,163,184,0.9)",
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  No photo
                </div>
              )}

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 950, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item?.title || "Listing"}
                    </div>
                    <div style={{ marginTop: 2, opacity: 0.85, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      With: <b>{otherName}</b> <span style={{ opacity: 0.7 }}>• {otherRole}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {c.unread > 0 && (
                      <span
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "rgba(239,68,68,0.15)",
                          border: "1px solid rgba(239,68,68,0.35)",
                          fontWeight: 950,
                          fontSize: 12,
                        }}
                      >
                        {c.unread}
                      </span>
                    )}
                    <div style={{ opacity: 0.7, fontSize: 12, whiteSpace: "nowrap" }}>{when}</div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    opacity: 0.85,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 14,
                  }}
                >
                  {lastText}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}