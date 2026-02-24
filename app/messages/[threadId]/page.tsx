"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ThreadHeader = {
  id: string;
  owner_id: string;
  requester_id: string;
  item: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
  };
};

type OtherUser = {
  id: string;
  name: string;
  role: string | null;
};

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();
  const threadId = params?.threadId as string;

  const [userId, setUserId] = useState<string | null>(null);

  const [header, setHeader] = useState<ThreadHeader | null>(null);
  const [other, setOther] = useState<OtherUser | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const otherLabel = useMemo(() => {
    if (!other) return "Campus user";
    return other.role ? `${other.name} (${other.role})` : other.name;
  }, [other]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
    return data.session?.user?.id ?? null;
  }

  async function loadHeader(uid: string) {
    // thread + item
    const { data: tData, error: tErr } = await supabase
      .from("threads")
      .select("id,owner_id,requester_id,items:items(id,title,photo_url,status)")
      .eq("id", threadId)
      .single();

    if (tErr) throw tErr;

    const t = tData as any;

    const itemObj = t.items ?? null; // joined object

    const mapped: ThreadHeader = {
      id: String(t.id),
      owner_id: String(t.owner_id),
      requester_id: String(t.requester_id),
      item: {
        id: String(itemObj?.id ?? ""),
        title: String(itemObj?.title ?? "Listing"),
        photo_url: itemObj?.photo_url ? String(itemObj.photo_url) : null,
        status: itemObj?.status ? String(itemObj.status) : null,
      },
    };

    setHeader(mapped);

    // other person profile
    const otherId = mapped.owner_id === uid ? mapped.requester_id : mapped.owner_id;

    const { data: pData, error: pErr } = await supabase
      .from("profiles")
      .select("id,full_name,user_role")
      .eq("id", otherId)
      .maybeSingle();

    if (pErr) {
      setOther({ id: otherId, name: "Campus user", role: null });
      return;
    }

    const p = (pData as any) ?? null;
    const nm = String((p?.full_name ?? "Campus user") as any);
    const role = p?.user_role ? String(p.user_role) : null;

    setOther({ id: otherId, name: nm, role });
  }

  async function loadMessages() {
    const { data, error } = await supabase
      .from("messages")
      .select("id,sender_id,body,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (!error) setMessages((data as Message[]) || []);
  }

  async function sendMessage() {
    if (!text.trim() || !userId) return;
    setSending(true);

    const body = text.trim();

    const { error } = await supabase.from("messages").insert([
      { thread_id: threadId, sender_id: userId, body },
    ]);

    setSending(false);

    if (error) return alert(error.message);

    setText("");
    loadMessages();
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const uid = await syncAuth();
        if (!uid) {
          setLoading(false);
          return;
        }
        await loadHeader(uid);
        await loadMessages();
      } catch (e: any) {
        alert(e?.message || "Failed to load conversation.");
      } finally {
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel("realtime-thread-" + threadId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      <button
        onClick={() => router.push("/messages")}
        style={{
          border: "1px solid #334155",
          padding: "8px 12px",
          borderRadius: 10,
          background: "transparent",
          color: "white",
          fontWeight: 950,
          marginBottom: 14,
          cursor: "pointer",
        }}
      >
        ← Back
      </button>

      {/* Header */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          padding: 14,
          borderRadius: 18,
          border: "1px solid #0f223f",
          background: "rgba(11,23,48,0.75)",
          position: "sticky",
          top: 12,
          zIndex: 5,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            width: 62,
            height: 62,
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
          {header?.item.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={header.item.photo_url} alt="Item" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ fontWeight: 950 }}>No</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 950 }}>Item</div>
          <div style={{ fontSize: 18, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {header?.item.title ?? "Conversation"}
          </div>

          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.25)",
                background: "rgba(0,0,0,0.25)",
                fontWeight: 900,
              }}
            >
              Status: {header?.item.status ?? "—"}
            </span>

            <span
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid rgba(22,163,74,0.35)",
                background: "rgba(22,163,74,0.12)",
                fontWeight: 950,
              }}
            >
              With: {otherLabel}
            </span>
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 18, fontSize: 22, fontWeight: 950 }}>Conversation</h2>

      {loading ? (
        <p style={{ opacity: 0.75 }}>Loading…</p>
      ) : (
        <>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && <div style={{ opacity: 0.75 }}>No messages yet. Say hi 👋</div>}

            {messages.map((m) => {
              const mine = m.sender_id === userId;
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                  <div
                    style={{
                      background: mine ? "#052e16" : "#0b1730",
                      border: "1px solid rgba(148,163,184,0.18)",
                      padding: "10px 12px",
                      borderRadius: 16,
                      fontSize: 14,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.body}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.6, textAlign: mine ? "right" : "left" }}>
                    {fmtTime(m.created_at)}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={other ? `Message ${other.name}...` : "Type a message..."}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              style={{
                flex: 1,
                padding: "12px 12px",
                borderRadius: 14,
                border: "1px solid #334155",
                background: "#0b1730",
                color: "white",
                outline: "none",
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending}
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                border: "1px solid #16a34a",
                background: sending ? "rgba(22,163,74,0.15)" : "#052e16",
                color: "white",
                fontWeight: 950,
                cursor: sending ? "not-allowed" : "pointer",
                opacity: sending ? 0.8 : 1,
              }}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}