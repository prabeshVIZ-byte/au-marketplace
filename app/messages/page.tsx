"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  user_role: string | null; // text in DB: "student" | "faculty"
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
  items: ItemRow | null; // joined via items:items(...)
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ThreadCard = {
  thread: ThreadRow;
  other: ProfileRow | null;
  last: MessageRow | null;
};

function fmtWhen(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function MessagesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<ThreadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
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

    // 1) Threads where I'm either owner or requester + include item
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

    // 2) Load last messages for those threads (one query)
    const threadIds = threads.map((t) => t.id);

    const { data: mData, error: mErr } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at")
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
      if (!lastByThread[m.thread_id]) lastByThread[m.thread_id] = m; // first is latest because desc order
    }

    // 3) Load "other person" profiles (one query)
    const otherIds = Array.from(
      new Set(
        threads.map((t) => (t.owner_id === uid ? t.requester_id : t.owner_id))
      )
    );

    const { data: pData, error: pErr } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .in("id", otherIds);

    // if profiles query fails, we still show threads
    const profiles = (pErr ? [] : ((pData as ProfileRow[]) || []));
    const profileMap: Record<string, ProfileRow> = {};
    for (const p of profiles) profileMap[p.id] = p;

    // 4) Build cards
    const built: ThreadCard[] = threads.map((t) => {
      const otherId = t.owner_id === uid ? t.requester_id : t.owner_id;
      return {
        thread: t,
        other: profileMap[otherId] || null,
        last: lastByThread[t.id] || null,
      };
    });

    // Optional: sort by last message time, fallback to thread created_at
    built.sort((a, b) => {
      const at = new Date(a.last?.created_at || a.thread.created_at).getTime();
      const bt = new Date(b.last?.created_at || b.thread.created_at).getTime();
      return bt - at;
    });

    setCards(built);
    setLoading(false);
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

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0 }}>Messages</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Conversations appear here only after a seller accepts a request.
      </p>

      {err && <p style={{ color: "#f87171", marginTop: 10 }}>{err}</p>}
      {loading && <p style={{ marginTop: 10, opacity: 0.8 }}>Loading…</p>}

      {!loading && cards.length === 0 && (
        <div
          style={{
            marginTop: 16,
            background: "#0b1730",
            border: "1px solid #0f223f",
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
          const lastText = c.last?.body || "No messages yet.";
          const when = c.last?.created_at ? fmtWhen(c.last.created_at) : fmtWhen(c.thread.created_at);

          return (
            <button
              key={c.thread.id}
              type="button"
              onClick={() => router.push(`/messages/${c.thread.id}`)}
              style={{
                textAlign: "left",
                background: "#0b1730",
                border: "1px solid #0f223f",
                borderRadius: 16,
                padding: 14,
                cursor: "pointer",
                color: "white",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* Item photo */}
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
                    border: "1px solid #0f223f",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    border: "1px dashed #334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  No photo
                </div>
              )}

              {/* Content */}
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

                  <div style={{ opacity: 0.7, fontSize: 12, whiteSpace: "nowrap" }}>{when}</div>
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