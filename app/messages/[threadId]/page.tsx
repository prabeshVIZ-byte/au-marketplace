"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  user_role: string | null; // "student" | "faculty" (in your DB it's text)
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
  items: ItemRow | null; // joined
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

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

  // ui
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

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

    // Must have session
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
      .select("id,item_id,owner_id,requester_id,created_at, items:items(id,title,photo_url,status)")
      .eq("id", threadId)
      .single();

    if (tErr) {
      setErr(tErr.message || "Error loading conversation.");
      setThread(null);
      setOtherProfile(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    const t = tData as unknown as ThreadRow;
    setThread(t);

    // 2) load the OTHER person profile
    const otherId = t.owner_id === uid ? t.requester_id : t.owner_id;

    const { data: pData, error: pErr } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .eq("id", otherId)
      .single();

    if (pErr) {
      // don't hard fail chat if profile missing
      setOtherProfile(null);
    } else {
      setOtherProfile(pData as ProfileRow);
    }

    // 3) load messages
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

    // Scroll to bottom after initial load
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

    // optimistic
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
      // remove optimistic
      setMessages((prev) => prev.filter((x) => x.id !== temp.id));
      setErr(error.message);
      return;
    }

    // replace temp with real row
    const real = data as MessageRow;
    setMessages((prev) => prev.map((x) => (x.id === temp.id ? real : x)));
    scrollToBottom();
  }

  // realtime (optional but nice)
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
            // avoid dupes if we already inserted/received it
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
            {thread.items?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thread.items.photo_url}
                alt={thread.items.title}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
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
                  borderRadius: 12,
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

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 900, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {thread.items?.title || "Listing"}
              </div>

              <div style={{ opacity: 0.85, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Talking with: <b>{otherProfile?.full_name || "Campus user"}</b>{" "}
                <span style={{ opacity: 0.7 }}>• {otherProfile?.user_role || "student"}</span>
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
              </div>
            </div>
          </div>
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