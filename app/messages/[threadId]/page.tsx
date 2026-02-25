"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { insertSystemMessage } from "@/lib/ensureThread";

type ProfileRow = {
  id: string;
  full_name: string | null;
  user_role: string | null;
};

type ThreadRow = {
  id: string;
  item_id: string | null;
  owner_id?: string | null;
  requester_id?: string | null;
  created_at?: string;
};

type ItemRow = {
  id: string;
  title: string;
  photo_url: string | null;
  status?: string | null;
  owner_id: string | null;
};

type MyInterestRow = {
  id: string;
  status: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;

  // optional (recommended columns)
  pinned?: boolean | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
};

type ThreadReadRow = {
  thread_id: string;
  user_id: string;
  last_seen_at: string;
};

function pillStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: 900,
    whiteSpace: "nowrap",
  } as const;
}

function isoToMs(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function safeName(p: ProfileRow | null) {
  const n = (p?.full_name ?? "").trim();
  if (n) return n;
  return "Ashland user";
}

export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();
  const threadId = (params?.threadId as string) || "";

  // auth
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // data
  const [thread, setThread] = useState<ThreadRow | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);
  const [otherProfile, setOtherProfile] = useState<ProfileRow | null>(null);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  // seen/unseen
  const [myLastSeenAt, setMyLastSeenAt] = useState<string | null>(null);
  const [otherLastSeenAt, setOtherLastSeenAt] = useState<string | null>(null);

  // ui
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [msgActingId, setMsgActingId] = useState<string | null>(null); // pin/delete acting

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const canConfirm = myStatus === "accepted"; // seller accepted buyer's interest

  const isBuyer = !!userId && !!thread?.requester_id && userId === thread.requester_id;
  const mustConfirmBeforeChat = isBuyer && canConfirm;

  const otherId = useMemo(() => {
    if (!userId || !thread) return null;
    const ownerId = thread.owner_id ?? null;
    const requesterId = thread.requester_id ?? null;
    if (!ownerId || !requesterId) return null;
    return ownerId === userId ? requesterId : ownerId;
  }, [userId, thread]);

  function scrollToBottom() {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadThreadAndItem(uid: string) {
    if (!threadId) return null;

    setErr(null);

    const { data: th, error: thErr } = await supabase
      .from("threads")
      .select("id,item_id,owner_id,requester_id,created_at")
      .eq("id", threadId)
      .single();

    if (thErr) throw new Error(thErr.message || "Error loading thread.");

    const threadRow = th as ThreadRow;
    setThread(threadRow);

    if (threadRow.item_id) {
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select("id,title,photo_url,status,owner_id")
        .eq("id", threadRow.item_id)
        .single();

      if (!itErr && it) {
        const itemRow = it as ItemRow;
        setItem(itemRow);

        // other profile
        const ownerId = (threadRow.owner_id ?? itemRow.owner_id ?? null) as string | null;
        const requesterId = (threadRow.requester_id ?? null) as string | null;

        const other =
          ownerId && requesterId ? (ownerId === uid ? requesterId : ownerId) : null;

        if (other) {
          const { data: pData, error: pErr } = await supabase
            .from("profiles")
            .select("id,full_name,user_role")
            .eq("id", other)
            .single();

          if (!pErr && pData) setOtherProfile(pData as ProfileRow);
          else setOtherProfile(null);
        } else {
          setOtherProfile(null);
        }
      } else {
        setItem(null);
        setOtherProfile(null);
      }
    } else {
      setItem(null);
      setOtherProfile(null);
    }

    return threadRow;
  }

  async function loadMyInterest(uid: string, itemId: string | null) {
    if (!uid || !itemId) {
      setMyInterest(null);
      return;
    }

    const { data, error } = await supabase
      .from("interests")
      .select("id,status")
      .eq("item_id", itemId)
      .eq("user_id", uid)
      .maybeSingle();

    if (!error && data) {
      setMyInterest({ id: (data as any).id, status: (data as any).status ?? null });
    } else {
      setMyInterest(null);
    }
  }

  async function loadMessages() {
    if (!threadId) return;

    const { data, error } = await supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at,pinned,deleted_at,deleted_by")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) {
      setMessages([]);
      throw new Error(error.message || "Error loading messages.");
    }

    const rows = ((data as MessageRow[]) || []).map((m) => ({
      ...m,
      pinned: m.pinned ?? false,
    }));

    // pinned first, but keep chronological inside each group
    const pinned = rows.filter((m) => !!m.pinned).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
    const normal = rows.filter((m) => !m.pinned).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));

    setMessages([...pinned, ...normal]);
  }

  async function loadReads() {
    if (!threadId || !userId) return;

    // my read
    try {
      const { data: mine } = await supabase
        .from("thread_reads")
        .select("thread_id,user_id,last_seen_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .maybeSingle();

      setMyLastSeenAt((mine as ThreadReadRow | null)?.last_seen_at ?? null);

      // other read (if we know who other is)
      if (otherId) {
        const { data: oth } = await supabase
          .from("thread_reads")
          .select("thread_id,user_id,last_seen_at")
          .eq("thread_id", threadId)
          .eq("user_id", otherId)
          .maybeSingle();

        setOtherLastSeenAt((oth as ThreadReadRow | null)?.last_seen_at ?? null);
      } else {
        setOtherLastSeenAt(null);
      }
    } catch {
      // if table doesn't exist, we silently ignore
      setMyLastSeenAt(null);
      setOtherLastSeenAt(null);
    }
  }

  async function markSeenNow() {
    if (!threadId || !userId) return;

    // only mark seen if you can actually view the chat (your gate)
    if (mustConfirmBeforeChat) return;

    const nowIso = new Date().toISOString();

    // upsert into thread_reads (requires table)
    try {
      await supabase.from("thread_reads").upsert(
        [{ thread_id: threadId, user_id: userId, last_seen_at: nowIso }],
        { onConflict: "thread_id,user_id" }
      );
      setMyLastSeenAt(nowIso);
    } catch {
      // ignore if table missing
    }
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

    try {
      const th = await loadThreadAndItem(uid);
      await loadMyInterest(uid, th?.item_id ?? null);
      await loadMessages();
      await loadReads();
      await markSeenNow();

      setLoading(false);
      setTimeout(scrollToBottom, 50);
    } catch (e: any) {
      setErr(e?.message || "Failed to load conversation.");
      setThread(null);
      setItem(null);
      setMyInterest(null);
      setOtherProfile(null);
      setMessages([]);
      setLoading(false);
    }
  }

  async function refreshNow() {
    if (!threadId) return;
    setRefreshing(true);
    setErr(null);
    try {
      await loadMessages();
      await loadReads();
      await markSeenNow();
      setTimeout(scrollToBottom, 30);
    } catch (e: any) {
      setErr(e?.message || "Could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  async function sendMessage() {
    if (!isAshland || !userId) return router.push("/me");
    if (mustConfirmBeforeChat) return;

    const body = text.trim();
    if (!body) return;

    setSending(true);
    setErr(null);

    const temp: MessageRow = {
      id: `temp-${Date.now()}`,
      thread_id: threadId,
      sender_id: userId,
      body,
      created_at: new Date().toISOString(),
      pinned: false,
      deleted_at: null,
      deleted_by: null,
    };

    // optimistic append (at end of non-pinned)
    setMessages((prev) => [...prev, temp]);
    setText("");
    scrollToBottom();

    const { data, error } = await supabase
      .from("messages")
      .insert([{ thread_id: threadId, sender_id: userId, body }])
      .select("id,thread_id,sender_id,body,created_at,pinned,deleted_at,deleted_by")
      .single();

    setSending(false);

    if (error) {
      setMessages((prev) => prev.filter((x) => x.id !== temp.id));
      setErr(error.message);
      return;
    }

    const real = data as MessageRow;
    setMessages((prev) => prev.map((x) => (x.id === temp.id ? { ...real, pinned: real.pinned ?? false } : x)));
    await markSeenNow();
    scrollToBottom();
  }

  async function confirmPickupFromChat() {
    if (!isAshland || !userId) return router.push("/me");
    if (!thread?.item_id || !myInterest?.id) return;
    if (!mustConfirmBeforeChat) return;

    setActionBusy(true);
    setErr(null);

    try {
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", { p_interest_id: myInterest.id });
      if (rpcErr) throw new Error(rpcErr.message);

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Pickup confirmed. You can start chatting now to coordinate time and place.",
      });

      await loadMyInterest(userId, thread.item_id);
      await loadMessages();
      await markSeenNow();
      scrollToBottom();
    } catch (e: any) {
      setErr(e?.message || "Could not confirm pickup.");
    } finally {
      setActionBusy(false);
    }
  }

  async function togglePin(m: MessageRow) {
    if (!userId) return;
    if (!threadId) return;

    const next = !(m.pinned ?? false);
    setMsgActingId(m.id);
    setErr(null);

    // optimistic
    setMessages((prev) => {
      const updated = prev.map((x) => (x.id === m.id ? { ...x, pinned: next } : x));
      const pinned = updated.filter((x) => !!x.pinned).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
      const normal = updated.filter((x) => !x.pinned).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
      return [...pinned, ...normal];
    });

    // persist (requires pinned column)
    const { error } = await supabase.from("messages").update({ pinned: next }).eq("id", m.id);

    setMsgActingId(null);
    if (error) {
      // rollback by reloading from server
      await refreshNow();
      setErr(error.message);
    }
  }

  async function deleteMessage(m: MessageRow) {
    if (!userId) return;
    if (!threadId) return;

    const mine = m.sender_id === userId;
    const ok = confirm(mine ? "Delete this message?" : "Remove this message from your view?");
    if (!ok) return;

    setMsgActingId(m.id);
    setErr(null);

    // optimistic: soft-delete view
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), deleted_by: userId, body: "" } : x)));

    // Preferred: soft delete (requires columns)
    const { error: softErr } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq("id", m.id);

    if (!softErr) {
      setMsgActingId(null);
      return;
    }

    // Fallback: hard delete (only allow if sender)
    if (mine) {
      const { error: hardErr } = await supabase.from("messages").delete().eq("id", m.id);
      setMsgActingId(null);

      if (hardErr) {
        await refreshNow();
        setErr(hardErr.message);
      } else {
        setMessages((prev) => prev.filter((x) => x.id !== m.id));
      }
      return;
    }

    // If not mine and soft-delete not available, revert
    setMsgActingId(null);
    await refreshNow();
    setErr("Soft-delete is not enabled yet. Add deleted_at/deleted_by columns to messages.");
  }

  // refresh on focus (not live)
  useEffect(() => {
    if (!threadId) return;

    async function onFocus() {
      try {
        await loadMessages();
        await loadReads();
        await markSeenNow();
      } catch {
        // ignore
      }
    }

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, userId, otherId, mustConfirmBeforeChat]);

  // initial load + auth changes
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

  const unseenCount = useMemo(() => {
    if (!myLastSeenAt) return 0;
    const seenMs = isoToMs(myLastSeenAt);
    return messages.filter((m) => {
      if (!m.sender_id) return false;
      if (m.sender_id === userId) return false;
      if (m.deleted_at) return false;
      return isoToMs(m.created_at) > seenMs;
    }).length;
  }, [messages, myLastSeenAt, userId]);

  const lastMyMessage = useMemo(() => {
    const mine = messages.filter((m) => m.sender_id === userId && !m.deleted_at);
    if (mine.length === 0) return null;
    return mine.reduce((a, b) => (isoToMs(a.created_at) > isoToMs(b.created_at) ? a : b));
  }, [messages, userId]);

  const lastMyMessageSeen = useMemo(() => {
    if (!lastMyMessage) return false;
    if (!otherLastSeenAt) return false;
    return isoToMs(otherLastSeenAt) >= isoToMs(lastMyMessage.created_at);
  }, [lastMyMessage, otherLastSeenAt]);

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 18, paddingBottom: 120 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button
          onClick={() => router.push("/messages")}
          style={{
            background: "transparent",
            color: "white",
            border: "1px solid rgba(148,163,184,0.25)",
            padding: "8px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          ← Back
        </button>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {unseenCount > 0 && (
            <span style={{ ...pillStyle(), border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.10)" }}>
              Unseen: {unseenCount}
            </span>
          )}

          <button
            onClick={refreshNow}
            disabled={refreshing}
            style={{
              background: "transparent",
              color: "white",
              border: "1px solid rgba(148,163,184,0.25)",
              padding: "8px 12px",
              borderRadius: 12,
              cursor: refreshing ? "not-allowed" : "pointer",
              fontWeight: 900,
              opacity: refreshing ? 0.7 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <h1 style={{ marginTop: 14, fontSize: 26, fontWeight: 950 }}>Conversation</h1>

      {err && <div style={{ color: "#f87171", marginTop: 10 }}>{err}</div>}
      {loading && <div style={{ opacity: 0.8, marginTop: 10 }}>Loading…</div>}

      {/* header */}
      {!loading && item && (
        <div
          style={{
            marginTop: 12,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(148,163,184,0.15)",
            borderRadius: 18,
            padding: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid rgba(148,163,184,0.18)",
              background: "rgba(255,255,255,0.03)",
              flexShrink: 0,
            }}
          >
            {item.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.photo_url} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : null}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.title}
            </div>

            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={pillStyle()}>Thread: {threadId.slice(0, 8)}…</span>
              {myInterest?.status ? <span style={pillStyle()}>Status: {myInterest.status}</span> : null}
              {otherProfile ? (
                <span style={pillStyle()}>
                  Talking with: {safeName(otherProfile)}
                  <span style={{ opacity: 0.75 }}>• {otherProfile.user_role || "student"}</span>
                </span>
              ) : null}
            </div>
          </div>

          <button
            onClick={() => router.push(`/item/${item.id}`)}
            style={{
              background: "transparent",
              border: "1px solid rgba(148,163,184,0.22)",
              color: "white",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 950,
              whiteSpace: "nowrap",
            }}
          >
            View item
          </button>
        </div>
      )}

      {/* ✅ Buyer confirm gate */}
      {!loading && item && mustConfirmBeforeChat && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            border: "1px solid rgba(52,211,153,0.22)",
            background: "rgba(16,185,129,0.10)",
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 950 }}>
            Seller accepted your request. <span style={{ opacity: 0.85 }}>Confirm pickup above to start chatting.</span>
          </div>

          <button
            onClick={confirmPickupFromChat}
            disabled={actionBusy}
            style={{
              background: "rgba(20,83,45,1)",
              border: "1px solid rgba(22,101,52,1)",
              color: "white",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: actionBusy ? "not-allowed" : "pointer",
              fontWeight: 950,
              opacity: actionBusy ? 0.8 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {actionBusy ? "Confirming…" : "Confirm pickup ✅"}
          </button>
        </div>
      )}

      {/* messages */}
      <div style={{ marginTop: 14 }}>
        {messages.map((m) => {
          const mine = !!userId && m.sender_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const deleted = !!m.deleted_at;

          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: 10 }}>
              <div style={{ maxWidth: "min(640px, 78vw)" }}>
                {/* bubble */}
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 16,
                    borderTopRightRadius: mine ? 6 : 16,
                    borderTopLeftRadius: mine ? 16 : 6,
                    background: mine ? "rgba(22,163,74,0.25)" : "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(148,163,184,0.18)",
                    color: "white",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontWeight: 650,
                    position: "relative",
                  }}
                >
                  {/* pin badge */}
                  {!!m.pinned && (
                    <div
                      style={{
                        position: "absolute",
                        top: -10,
                        left: mine ? "auto" : 10,
                        right: mine ? 10 : "auto",
                        fontSize: 12,
                        fontWeight: 950,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid rgba(52,211,153,0.28)",
                        background: "rgba(16,185,129,0.12)",
                        opacity: 0.95,
                      }}
                    >
                      📌 Pinned
                    </div>
                  )}

                  <div style={{ opacity: deleted ? 0.65 : 0.98, fontStyle: deleted ? "italic" : "normal" }}>
                    {deleted ? "Message deleted" : m.body}
                  </div>

                  <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6, textAlign: "right", display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <span>{time}</span>

                    {/* Seen indicator ONLY on your last message */}
                    {mine && lastMyMessage?.id === m.id && !deleted && (
                      <span style={{ opacity: 0.75, fontWeight: 900 }}>
                        {lastMyMessageSeen ? "Seen" : "Sent"}
                      </span>
                    )}
                  </div>
                </div>

                {/* actions */}
                {!deleted && (
                  <div style={{ marginTop: 6, display: "flex", gap: 8, justifyContent: mine ? "flex-end" : "flex-start" }}>
                    <button
                      onClick={() => togglePin(m)}
                      disabled={msgActingId === m.id}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(148,163,184,0.20)",
                        color: "white",
                        padding: "6px 10px",
                        borderRadius: 12,
                        cursor: msgActingId === m.id ? "not-allowed" : "pointer",
                        fontWeight: 900,
                        opacity: msgActingId === m.id ? 0.7 : 0.95,
                        fontSize: 12,
                      }}
                    >
                      {m.pinned ? "Unpin" : "Pin"}
                    </button>

                    <button
                      onClick={() => deleteMessage(m)}
                      disabled={msgActingId === m.id}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(127,29,29,0.80)",
                        color: "white",
                        padding: "6px 10px",
                        borderRadius: 12,
                        cursor: msgActingId === m.id ? "not-allowed" : "pointer",
                        fontWeight: 900,
                        opacity: msgActingId === m.id ? 0.7 : 0.95,
                        fontSize: 12,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => markSeenNow()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          disabled={sending || mustConfirmBeforeChat}
          placeholder={mustConfirmBeforeChat ? "Confirm pickup above to start chatting…" : "Type a message..."}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.18)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            padding: "0 12px",
            outline: "none",
            opacity: mustConfirmBeforeChat ? 0.7 : 1,
          }}
        />

        <button
          onClick={sendMessage}
          disabled={sending || !text.trim() || mustConfirmBeforeChat}
          style={{
            height: 48,
            padding: "0 16px",
            borderRadius: 12,
            border: "1px solid rgba(16,185,129,0.35)",
            background: sending ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.18)",
            color: "white",
            cursor: sending || !text.trim() || mustConfirmBeforeChat ? "not-allowed" : "pointer",
            fontWeight: 950,
            opacity: sending || !text.trim() || mustConfirmBeforeChat ? 0.65 : 1,
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}