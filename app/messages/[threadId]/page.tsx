"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();
  const threadId = params?.threadId as string;

  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
  }

  async function loadMessages() {
    const { data, error } = await supabase
      .from("messages")
      .select("id,sender_id,body,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (!error) setMessages((data as Message[]) || []);
    setLoading(false);
  }

  async function sendMessage() {
    if (!text.trim() || !userId) return;

    const { error } = await supabase.from("messages").insert([
      {
        thread_id: threadId,
        sender_id: userId,
        body: text.trim(),
      },
    ]);

    if (!error) {
      setText("");
      loadMessages();
    }
  }

  useEffect(() => {
    syncAuth();
    loadMessages();

    const channel = supabase
      .channel("realtime-thread-" + threadId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${threadId}`,
        },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
      <button
        onClick={() => router.push("/messages")}
        style={{
          border: "1px solid #334155",
          padding: "8px 12px",
          borderRadius: 10,
          background: "transparent",
          color: "white",
          fontWeight: 900,
          marginBottom: 14,
        }}
      >
        ← Back
      </button>

      <h1 style={{ fontSize: 24, fontWeight: 900 }}>Conversation</h1>

      {loading ? (
        <p style={{ opacity: 0.7 }}>Loading…</p>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  background: mine ? "#052e16" : "#1e293b",
                  padding: "10px 14px",
                  borderRadius: 14,
                  maxWidth: "75%",
                  fontSize: 14,
                }}
              >
                {m.body}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #334155",
            background: "#0b1730",
            color: "white",
          }}
        />
        <button
          onClick={sendMessage}
          style={{
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid #16a34a",
            background: "#052e16",
            color: "white",
            fontWeight: 900,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}