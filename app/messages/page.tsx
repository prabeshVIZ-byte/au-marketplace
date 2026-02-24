"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ThreadRow = {
  id: string;
  item_id: string;
  owner_id: string;
  requester_id: string;
  created_at: string;
  items?: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
  } | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export default function MessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [lastByThread, setLastByThread] = useState<Record<string, MessageRow | undefined>>({});

  const isAshland = !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
    setUserEmail(data.session?.user?.email ?? null);
  }

  async function loadInbox(uid: string) {
    setErr(null);

    // 1) Load threads + item info
    const { data: tData, error: tErr } = await supabase
      .from("threads")
      // join items through the FK threads.item_id -> items.id
      .select("id,item_id,owner_id,requester_id,created_at,items:items(id,title,photo_url,status)")
      .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
      .order("created_at", { ascending: false });

    if (tErr) throw tErr;

    const tRows = (tData as ThreadRow[]) || [];
    setThreads(tRows);

    // 2) Load last messages for those threads (one query)
    const threadIds = tRows.map((t) => t.id);
    if (threadIds.length === 0) {
      setLastByThread({});
      return;
    }

    const { data: mData, error: mErr } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false });

    if (mErr) throw mErr;

    const latest: Record<string, MessageRow | undefined> = {};
    for (const m of (mData as MessageRow[]) || []) {
      // because it's ordered DESC, first time we see a thread_id is the newest message
      if (!latest[m.thread_id]) latest[m.thread_id] = m;
    }
    setLastByThread(latest);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await syncAuth();

      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      const email = data.session?.user?.email ?? null;

      // if not logged in or not ashland, we just show the login prompt
      if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
        setLoading(false);
        return;
      }

      try {
        await loadInbox(uid);
      } catch (e: any) {
        setErr(e?.message || "Failed to load inbox.");
      } finally {
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      // reload inbox after auth changes
      supabase.auth.getSession().then(({ data }) => {
        const uid = data.session?.user?.id ?? null;
        const email = data.session?.user?.email ?? null;
        if (uid && email && email.toLowerCase().endsWith("@ashland.edu")) {
          loadInbox(uid).catch(() => {});
        } else {
          setThreads([]);
          setLastByThread({});
        }
      });
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const uid = userId;
    return threads.map((t) => {
      const otherId = uid ? (t.owner_id === uid ? t.requester_id : t.owner_id) : t.requester_id;
      const last = lastByThread[t.id];
      return { t, otherId, last };
    });
  }, [threads, lastByThread, userId]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <div style={{ opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  if (!isAshland || !userId) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Messages</h1>
        <p style={{ marginTop: 10, opacity: 0.75, maxWidth: 640 }}>
          Messaging is available after a seller accepts your request. Please log in with your <b>@ashland.edu</b> email to view conversations.
        </p>

        <button
          onClick={() => router.push("/me")}
          style={{
            marginTop: 12,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Go to Account
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Messages</h1>
      <p style={{ marginTop: 10, opacity: 0.75, maxWidth: 740 }}>
        Conversations appear here only after a seller accepts a request.
      </p>

      {err && <div style={{ marginTop: 12, color: "#f87171", fontWeight: 800 }}>{err}</div>}

      <div style={{ marginTop: 16 }}>
        {rows.length === 0 ? (
          <div
            style={{
              borderRadius: 18,
              border: "1px solid rgba(148,163,184,0.15)",
              background: "rgba(255,255,255,0.04)",
              padding: 14,
              opacity: 0.8,
            }}
          >
            No conversations yet.
            <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>
              Once a seller accepts your request (or you accept a requester on your listing), a chat will appear here.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map(({ t, otherId, last }) => {
              const itemTitle = t.items?.title ?? "Item";
              const itemPhoto = t.items?.photo_url ?? null;
              const lastPreview = last?.body ? (last.body.length > 70 ? last.body.slice(0, 70) + "…" : last.body) : "No messages yet";
              const when = last?.created_at ? new Date(last.created_at).toLocaleString() : new Date(t.created_at).toLocaleString();

              return (
                <button
                  key={t.id}
                  onClick={() => router.push(`/messages/${t.id}`)} // chat page next step
                  style={{
                    textAlign: "left",
                    borderRadius: 18,
                    border: "1px solid rgba(148,163,184,0.15)",
                    background: "rgba(255,255,255,0.04)",
                    padding: 12,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.15)",
                        background: "rgba(0,0,0,0.35)",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "rgba(255,255,255,0.55)",
                        flex: "0 0 auto",
                      }}
                    >
                      {itemPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={itemPhoto} alt={itemTitle} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        "📦"
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {itemTitle}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: "nowrap" }}>{when}</div>
                      </div>

                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                        With: <span style={{ opacity: 0.9, fontWeight: 900 }}>{shortId(otherId)}</span>
                      </div>

                      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.78, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {lastPreview}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}