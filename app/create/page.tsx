"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  pickup_location?: string | null;
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
};

type InterestRow = {
  id: string;
  status: string | null;
};

function safeName(name: string | null | undefined, fallback: string) {
  const s = (name ?? "").trim();
  return s.length ? s : fallback;
}

export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();
  const threadId = params?.threadId as string;

  // auth
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // data
  const [thread, setThread] = useState<ThreadRow | null>(null);
  const [otherProfile, setOtherProfile] = useState<ProfileRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  // ✅ NEW: interest between buyer and item
  const [interest, setInterest] = useState<InterestRow | null>(null);
  const [actionBusy, setActionBusy] = useState<null | "confirm" | "decline">(null);

  // ui
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const amOwner = !!userId && !!thread && thread.owner_id === userId;
  const amRequester = !!userId && !!thread && thread.requester_id === userId;

  const interestStatus = (interest?.status ?? "").toLowerCase();
  const showActionCard = amRequester && interestStatus === "accepted"; // awaiting buyer confirm

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id ?? null;
    const email = s.session?.user?.email ?? null;

    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    // 1) load thread + joined item
    const { data: tData, error: tErr } = await supabase
      .from("threads")
      .select("id,item_id,owner_id,requester_id,created_at, items:items(id,title,photo_url,status,pickup_location)")
      .eq("id", threadId)
      .single();

    if (tErr) {
      setErr(tErr.message || "Error loading conversation.");
      setThread(null);
      setOtherProfile(null);
      setMessages([]);
      setInterest(null);
      setLoading(false);
      return;
    }

    const t = tData as unknown as ThreadRow;
    setThread(t);

    // 2) other profile
    const otherId = t.owner_id === uid ? t.requester_id : t.owner_id;
    const { data: pData } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .eq("id", otherId)
      .single();
    setOtherProfile((pData as ProfileRow) || null);

    // ✅ 3) load interest row for this buyer+item (requester_id)
    const { data: iData, error: iErr } = await supabase
      .from("interests")
      .select("id,status")
      .eq("item_id", t.item_id)
      .eq("user_id", t.requester_id)
      .maybeSingle();

    if (!iErr && iData) setInterest({ id: (iData as any).id, status: (iData as any).status ?? null });
    else setInterest(null);

    // 4) load messages
    const { data: mData, error: mErr } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (mErr) {
      setErr(mErr.message || "Error loading messages.");
      setMessages([]);
      setLoading(false);
      return;
    }

    setMessages((mData as MessageRow[]) || []);
    setLoading(false);
    setTimeout(scrollToBottom, 50);
  }

  async function sendMessage() {
    if (!isAshland || !userId) {
      router.push("/me");
      return;
    }
    if (!thread) return;

    const body = text.trim();
    if (!body) return;

    setSending(true);
    setErr(null);

    const temp: MessageRow = {
      id: `temp-${Date.now()}`,
      thread_id: thread.id,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, temp]);
    setText("");
    scrollToBottom();

    const { data, error } = await supabase
      .from("messages")
      .insert([{ thread_id: thread.id, sender_id: userId, body }])
      .select("id,thread_id,sender_id,body,created_at")
      .single();

    setSending(false);

    if (error) {
      setMessages((prev) => prev.filter((x) => x.id !== temp.id));
      setErr(error.message);
      return;
    }

    const real = data as MessageRow;
    setMessages((prev) => prev.map((x) => (x.id === temp.id ? real : x)));
    scrollToBottom();
  }

  // ✅ NEW: buyer confirm inside chat
  async function confirmPickup() {
    if (!thread || !interest?.id || !userId) return;
    setActionBusy("confirm");
    setErr(null);

    try {
      // reserve atomically
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", { p_interest_id: interest.id });
      if (rpcErr) throw new Error(rpcErr.message);

      // update local interest
      setInterest((prev) => (prev ? { ...prev, status: "reserved" } : prev));

      // system message
      const meName = "Buyer";
      const itemTitle = thread.items?.title ?? "this item";

      await supabase.from("messages").insert([
        {
          thread_id: thread.id,
          sender_id: userId,
          body: `✅ ${meName} confirmed pickup for "${itemTitle}". Please coordinate time/location here.`,
        },
      ]);
    } catch (e: any) {
      setErr(e?.message || "Could not confirm pickup.");
    } finally {
      setActionBusy(null);
    }
  }

  // ✅ NEW: buyer decline inside chat
  async function declinePickup() {
    if (!thread || !interest?.id || !userId) return;
    setActionBusy("decline");
    setErr(null);

    try {
      // simplest: mark declined (keep history)
      const { error: upErr } = await supabase
        .from("interests")
        .update({ status: "declined" })
        .eq("id", interest.id);

      if (upErr) throw new Error(upErr.message);

      setInterest((prev) => (prev ? { ...prev, status: "declined" } : prev));

      // system message
      const itemTitle = thread.items?.title ?? "this item";
      await supabase.from("messages").insert([
        {
          thread_id: thread.id,
          sender_id: userId,
          body: `❌ Buyer declined pickup for "${itemTitle}". Seller can accept another requester.`,
        },
      ]);

      // redirect buyer back to item page so they can request others
      router.push(`/item/${thread.item_id}`);
    } catch (e: any) {
      setErr(e?.message || "Could not decline.");
    } finally {
      setActionBusy(null);
    }
  }

  // realtime messages
  useEffect(() => {
    if (!threadId) return;

    const channel = supabase
      .channel(`messages-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as MessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          });
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  // realtime interest (so action card disappears after confirm)
  useEffect(() => {
    if (!thread?.item_id) return;

    const ch = supabase
      .channel(`interest-thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interests", filter: `item_id=eq.${thread.item_id}` },
        (payload) => {
          const row: any = payload.new;
          // only track the requester's interest row
          if (row?.user_id === thread.requester_id) {
            setInterest({ id: row.id, status: row.status ?? null });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [thread?.item_id, thread?.requester_id, threadId]);

  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadAll();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadAll();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  if (!isAshland) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Checking access…</div>;
  }

  const otherName = safeName(otherProfile?.full_name, "Campus user");
  const itemTitle = thread?.items?.title ?? "Listing";

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      <button
        onClick={() => router.push("/messages")}
        style={{
          border: "1px solid #334155",
          background: "transparent",
          color: "white",
          padding: "10px 12px",
          borderRadius: 12,
          cursor: "pointer",
          fontWeight: 900,
        }}
      >
        ← Back
      </button>

      <h1 style={{ marginTop: 16, fontSize: 28, fontWeight: 900 }}>Conversation</h1>
      {err && <p style={{ color: "#f87171", marginTop: 10 }}>{err}</p>}
      {loading && <p style={{ opacity: 0.8, marginTop: 10 }}>Loading…</p>}

      {/* Sticky context header */}
      {!loading && thread && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "black",
            paddingTop: 8,
            paddingBottom: 12,
            borderBottom: "1px solid #0f223f",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 14,
              borderRadius: 14,
              background: "#0b1730",
              border: "1px solid #0f223f",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 950, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {itemTitle}
              </div>

              <div style={{ opacity: 0.85, marginTop: 4 }}>
                Talking with: <b>{otherName}</b> <span style={{ opacity: 0.7 }}>• {otherProfile?.user_role || "student"}</span>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => router.push(`/item/${thread.item_id}`)}
                  style={{
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "white",
                    padding: "8px 10px",
                    borderRadius: 10,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  View item
                </button>

                {amOwner && (
                  <button
                    type="button"
                    onClick={() => router.push(`/manage/${thread.item_id}`)}
                    style={{
                      border: "1px solid #334155",
                      background: "transparent",
                      color: "white",
                      padding: "8px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    Manage
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ✅ INTERACTIVE ACTION CARD */}
          {showActionCard && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 14,
                background: "#071022",
                border: "1px solid #0f223f",
              }}
            >
              <div style={{ fontWeight: 900 }}>Seller accepted — confirm pickup?</div>
              <div style={{ opacity: 0.85, marginTop: 6 }}>
                If you confirm, the item becomes reserved and you both coordinate here.
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={confirmPickup}
                  disabled={actionBusy !== null}
                  style={{
                    border: "1px solid #166534",
                    background: "#14532d",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 12,
                    cursor: actionBusy ? "not-allowed" : "pointer",
                    fontWeight: 900,
                    opacity: actionBusy ? 0.7 : 1,
                  }}
                >
                  {actionBusy === "confirm" ? "Confirming..." : "Confirm pickup ✅"}
                </button>

                <button
                  onClick={declinePickup}
                  disabled={actionBusy !== null}
                  style={{
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 12,
                    cursor: actionBusy ? "not-allowed" : "pointer",
                    fontWeight: 900,
                    opacity: actionBusy ? 0.7 : 1,
                  }}
                >
                  {actionBusy === "decline" ? "Declining..." : "Decline ❌"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div style={{ marginTop: 12 }}>
        {messages.map((m) => {
          const isMe = !!userId && m.sender_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          return (
            <div key={m.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", marginTop: 10 }}>
              <div
                style={{
                  maxWidth: "min(640px, 78vw)",
                  padding: "10px 12px",
                  borderRadius: 16,
                  borderTopRightRadius: isMe ? 6 : 16,
                  borderTopLeftRadius: isMe ? 16 : 6,
                  background: isMe ? "rgba(22,163,74,0.25)" : "#0b1730",
                  border: "1px solid #0f223f",
                  color: "white",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontWeight: 600,
                }}
              >
                <div style={{ opacity: 0.95 }}>{m.body}</div>
                <div style={{ opacity: 0.55, fontSize: 12, marginTop: 6, textAlign: "right" }}>{time}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Type a message..."
          style={{
            flex: 1,
            height: 48,
            borderRadius: 12,
            border: "1px solid #0f223f",
            background: "#0b1730",
            color: "white",
            padding: "0 12px",
            outline: "none",
          }}
        />

        <button
          onClick={sendMessage}
          disabled={sending}
          style={{
            height: 48,
            padding: "0 16px",
            borderRadius: 12,
            border: "1px solid #16a34a",
            background: sending ? "rgba(22,163,74,0.25)" : "#052e16",
            color: "white",
            cursor: sending ? "not-allowed" : "pointer",
            fontWeight: 900,
            opacity: sending ? 0.8 : 1,
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}