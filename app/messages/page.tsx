"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InboxCard = {
  threadId: string;
  itemId: string;
  itemTitle: string;
  itemPhotoUrl: string | null;
  itemStatus: string | null;
  otherId: string;
  otherName: string;
  otherRole: string | null;
  lastBody: string;
  lastAt: string | null;
};

function fmtTime(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MessagesPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<InboxCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    setUserId(s?.user?.id ?? null);
    setUserEmail(s?.user?.email ?? null);
  }

  async function loadInbox(uid: string) {
    setLoading(true);
    setErr(null);

    try {
      // 1) threads with item info
      // NOTE: we deliberately treat join payload as "any" then map it to stable UI types.
      const { data: tData, error: tErr } = await supabase
        .from("threads")
        .select("id,item_id,owner_id,requester_id,created_at,items:items(id,title,photo_url,status)")
        .or(`owner_id.eq.${uid},requester_id.eq.${uid}`)
        .order("created_at", { ascending: false });

      if (tErr) throw tErr;

      const threads = (tData as any[]) || [];
      const threadIds = threads.map((t) => t.id);

      if (threadIds.length === 0) {
        setCards([]);
        setLoading(false);
        return;
      }

      // 2) last message per thread (we pull all messages for those threads, newest first, then keep first per thread)
      const { data: mData, error: mErr } = await supabase
        .from("messages")
        .select("id,thread_id,body,created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false });

      if (mErr) throw mErr;

      const lastByThread: Record<string, { body: string; created_at: string }> = {};
      for (const m of (mData as any[]) || []) {
        const tid = String(m.thread_id);
        if (!lastByThread[tid]) {
          lastByThread[tid] = { body: String(m.body ?? ""), created_at: String(m.created_at ?? "") };
        }
      }

      // 3) fetch profiles for "other person" ids (one query)
      const otherIds = Array.from(
        new Set(
          threads.map((t) => (t.owner_id === uid ? t.requester_id : t.owner_id)).filter(Boolean).map((x) => String(x))
        )
      );

      const profileMap: Record<string, { name: string; role: string | null }> = {};

      if (otherIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from("profiles")
          .select("id,full_name,user_role")
          .in("id", otherIds);

        if (pErr) throw pErr;

        for (const p of (pData as any[]) || []) {
          const id = String(p.id);
          const nm = (p.full_name ?? "Campus user") as string;
          const role = (p.user_role ?? null) as string | null;
          profileMap[id] = { name: String(nm), role: role ? String(role) : null };
        }
      }

      // 4) map -> cards
      const mapped: InboxCard[] = threads.map((t) => {
        const itemsObj = t.items ?? null; // joined item object (not array)
        const itemTitle = itemsObj?.title ? String(itemsObj.title) : "Listing";
        const itemPhotoUrl = itemsObj?.photo_url ? String(itemsObj.photo_url) : null;
        const itemStatus = itemsObj?.status ? String(itemsObj.status) : null;

        const otherId = String(t.owner_id === uid ? t.requester_id : t.owner_id);
        const other = profileMap[otherId];

        const last = lastByThread[String(t.id)] ?? null;

        return {
          threadId: String(t.id),
          itemId: String(t.item_id),
          itemTitle,
          itemPhotoUrl,
          itemStatus,
          otherId,
          otherName: other?.name ?? "Campus user",
          otherRole: other?.role ?? null,
          lastBody: last?.body ?? "No messages yet.",
          lastAt: last?.created_at ?? null,
        };
      });

      // Sort by last message time, fallback to thread created_at
      mapped.sort((a, b) => {
        const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
        const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
        return bt - at;
      });

      setCards(mapped);
    } catch (e: any) {
      setErr(e?.message || "Error loading inbox.");
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await syncAuth();
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      const uid = s?.user?.id ?? null;
      const email = s?.user?.email ?? null;

      if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
        setLoading(false);
        return;
      }
      await loadInbox(uid);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      await syncAuth();
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      const uid = s?.user?.id ?? null;
      const email = s?.user?.email ?? null;

      if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
        setCards([]);
        setLoading(false);
        return;
      }
      await loadInbox(uid);
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 950, margin: 0 }}>Messages</h1>
        <p style={{ opacity: 0.75, marginTop: 10 }}>Login with your @ashland.edu email to view conversations.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
      <h1 style={{ fontSize: 28, fontWeight: 950, margin: 0 }}>Messages</h1>
      <p style={{ opacity: 0.75, marginTop: 10 }}>Conversations appear here only after a seller accepts a request.</p>

      {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}
      {loading && <p style={{ opacity: 0.75, marginTop: 12 }}>Loading…</p>}

      {!loading && cards.length === 0 && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #0f223f",
            background: "rgba(11,23,48,0.6)",
            borderRadius: 16,
            padding: 14,
          }}
        >
          <div style={{ fontWeight: 950 }}>No conversations yet.</div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Once a seller accepts your request (or you accept a requester on your listing), a chat will appear here.
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((c) => (
          <button
            key={c.threadId}
            onClick={() => router.push(`/messages/${c.threadId}`)}
            style={{
              textAlign: "left",
              border: "1px solid #0f223f",
              background: "rgba(11,23,48,0.55)",
              borderRadius: 18,
              padding: 14,
              cursor: "pointer",
              color: "white",
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.25)",
                overflow: "hidden",
                background: "#0b1730",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
                flexShrink: 0,
              }}
            >
              {c.itemPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.itemPhotoUrl} alt="Item" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontWeight: 900 }}>No</span>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.itemTitle}
                </div>
                <div style={{ opacity: 0.6, fontSize: 12, whiteSpace: "nowrap" }}>{fmtTime(c.lastAt)}</div>
              </div>

              <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
                With: <b>{c.otherName}</b>
                {c.otherRole ? <span style={{ opacity: 0.75 }}> • {c.otherRole}</span> : null}
                {c.itemStatus ? <span style={{ opacity: 0.75 }}> • {c.itemStatus}</span> : null}
              </div>

              <div
                style={{
                  marginTop: 6,
                  opacity: 0.75,
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.lastBody}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}