"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { insertSystemMessage } from "@/lib/ensureThread";


// ================= TYPES =================
type ProfileRow = { id: string; full_name: string | null; user_role: string | null };

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

type MyInterestRow = { id: string; status: string | null };

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;

  client_id?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to?: string | null;
  attachments?: any | null;
};

type ReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type ThreadReadRow = { thread_id: string; user_id: string; last_seen_at: string };

type TradeRow = {
  id: string;
  item_id: string;
  thread_id: string;
  seller_id: string;
  buyer_id: string;
  state: "proposed" | "confirmed" | "fulfilled" | "canceled";
  proposed_by: string;
  confirmed_by: string | null;
  fulfilled_by: string | null;
  canceled_by: string | null;
  updated_at: string;
};

// ================= CONFIG =================
const PAGE_SIZE = 30;
const MEDIA_BUCKET = "message-media";

// ================= HELPERS =================
function isoToMs(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function safeName(p: ProfileRow | null) {
  const n = (p?.full_name ?? "").trim();
  return n || "Ashland user";
}

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

function makeClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAllowedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

// ================= PAGE =================
export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();

  // ✅ robust threadId
  const threadId = useMemo(() => {
    const raw = params?.threadId;
    const id = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
    return (id || "").trim();
  }, [params]);

  // ---------- auth ----------
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // ---------- thread/item/profile ----------
  const [thread, setThread] = useState<ThreadRow | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);
  const [otherProfile, setOtherProfile] = useState<ProfileRow | null>(null);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  // ---------- trade/fulfillment ----------
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeErr, setTradeErr] = useState<string | null>(null);

  // ---------- messages + reactions ----------
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});
  const [myReactions, setMyReactions] = useState<Record<string, Record<string, boolean>>>({});

  // ---------- read receipts ----------
  const [myLastSeenAt, setMyLastSeenAt] = useState<string | null>(null);
  const [otherLastSeenAt, setOtherLastSeenAt] = useState<string | null>(null);

  // ---------- typing/presence ----------
  const [otherTyping, setOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);

  // realtime channel refs (stable, no hunting)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- UI ----------
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [uploading, setUploading] = useState(false);

  // paging
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // scroll behavior
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // ---------- derived ----------
  const isAshland = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const canConfirmPickup = myStatus === "accepted";
  const isBuyer = !!userId && !!thread?.requester_id && userId === thread.requester_id;
  const mustConfirmBeforeChat = isBuyer && canConfirmPickup;

  const otherId = useMemo(() => {
    if (!userId || !thread) return null;
    const ownerId = thread.owner_id ?? null;
    const requesterId = thread.requester_id ?? null;
    if (!ownerId || !requesterId) return null;
    return ownerId === userId ? requesterId : ownerId;
  }, [userId, thread]);

  function scrollToBottom(force = false) {
    if (!stickToBottom && !force) return;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  // ================= AUTH =================
  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const uid = session?.user?.id ?? null;
    const email = session?.user?.email ?? null;
    setUserId(uid);
    setUserEmail(email);
    return { uid, email };
  }

  // ================= LOAD THREAD/ITEM/PROFILE =================
  async function loadThreadAndItem(uid: string) {
    const { data: th, error: thErr } = await supabase
      .from("threads")
      .select("id,item_id,owner_id,requester_id,created_at")
      .eq("id", threadId)
      .single();

    if (thErr) throw new Error(thErr.message || "Error loading thread.");
    const threadRow = th as ThreadRow;
    setThread(threadRow);

    if (!threadRow.item_id) {
      setItem(null);
      setOtherProfile(null);
      return threadRow;
    }

    const { data: it, error: itErr } = await supabase
      .from("items")
      .select("id,title,photo_url,status,owner_id")
      .eq("id", threadRow.item_id)
      .single();

    if (itErr) throw new Error(itErr.message || "Error loading item.");
    const itemRow = it as ItemRow;
    setItem(itemRow);

    const ownerId = (threadRow.owner_id ?? itemRow.owner_id ?? null) as string | null;
    const requesterId = (threadRow.requester_id ?? null) as string | null;
    const other = ownerId && requesterId ? (ownerId === uid ? requesterId : ownerId) : null;

    if (other) {
      const { data: pData } = await supabase
        .from("profiles")
        .select("id,full_name,user_role")
        .eq("id", other)
        .single();
      setOtherProfile((pData as any) ?? null);
    } else {
      setOtherProfile(null);
    }

    return threadRow;
  }

  async function loadMyInterest(uid: string, itemId: string | null) {
    if (!uid || !itemId) {
      setMyInterest(null);
      return;
    }
    const { data } = await supabase
      .from("interests")
      .select("id,status")
      .eq("item_id", itemId)
      .eq("user_id", uid)
      .maybeSingle();

    if (data) setMyInterest({ id: (data as any).id, status: (data as any).status ?? null });
    else setMyInterest(null);
  }

  // ================= MESSAGES (PAGED) =================
  async function fetchMessagesPage(before?: string | null) {
    let q = supabase
      .from("messages")
      .select("id,thread_id,sender_id,body,created_at,client_id,edited_at,deleted_at,reply_to,attachments")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (before) q = q.lt("created_at", before);

    const { data, error } = await q;
    if (error) throw new Error(error.message || "Error loading messages.");

    const rows = ((data as MessageRow[]) || []).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
    return rows;
  }

  async function loadInitialMessages() {
    const page = await fetchMessagesPage(null);
    setMessages(page);
    setHasMore(page.length === PAGE_SIZE);
    setTimeout(() => scrollToBottom(true), 30);
  }

  async function loadOlder() {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const oldest = messages[0]?.created_at ?? null;
      const page = await fetchMessagesPage(oldest);
      setMessages((prev) => [...page, ...prev]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (e: any) {
      setErr(e?.message || "Could not load older.");
    } finally {
      setLoadingMore(false);
    }
  }

  // ================= READ RECEIPTS =================
  async function loadReads(uid: string) {
    try {
      const { data: mine } = await supabase
        .from("thread_reads")
        .select("thread_id,user_id,last_seen_at")
        .eq("thread_id", threadId)
        .eq("user_id", uid)
        .maybeSingle();
      setMyLastSeenAt((mine as ThreadReadRow | null)?.last_seen_at ?? null);

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
      setMyLastSeenAt(null);
      setOtherLastSeenAt(null);
    }
  }

  async function markSeenNow(uid: string) {
    if (mustConfirmBeforeChat) return;
    const nowIso = new Date().toISOString();
    try {
      await supabase.from("thread_reads").upsert([{ thread_id: threadId, user_id: uid, last_seen_at: nowIso }], {
        onConflict: "thread_id,user_id",
      });
      setMyLastSeenAt(nowIso);
    } catch {
      // ignore
    }
  }

  // ================= REACTIONS =================
  async function loadReactions(uid: string, msgIds: string[]) {
    if (msgIds.length === 0) return;

    const { data, error } = await supabase
      .from("message_reactions")
      .select("id,message_id,user_id,emoji,created_at")
      .in("message_id", msgIds);

    if (error) return;

    const counts: Record<string, Record<string, number>> = {};
    const mine: Record<string, Record<string, boolean>> = {};

    for (const r of (data as ReactionRow[]) || []) {
      counts[r.message_id] ??= {};
      counts[r.message_id][r.emoji] = (counts[r.message_id][r.emoji] || 0) + 1;

      if (r.user_id === uid) {
        mine[r.message_id] ??= {};
        mine[r.message_id][r.emoji] = true;
      }
    }

    setReactions(counts);
    setMyReactions(mine);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!userId) return;
    const already = !!myReactions?.[messageId]?.[emoji];

    // optimistic
    setMyReactions((prev) => {
      const next = { ...(prev || {}) };
      next[messageId] = { ...(next[messageId] || {}) };
      if (already) delete next[messageId][emoji];
      else next[messageId][emoji] = true;
      return next;
    });

    setReactions((prev) => {
      const next = { ...(prev || {}) };
      next[messageId] = { ...(next[messageId] || {}) };
      const cur = next[messageId][emoji] || 0;
      next[messageId][emoji] = Math.max(0, cur + (already ? -1 : 1));
      if (next[messageId][emoji] === 0) delete next[messageId][emoji];
      return next;
    });

    if (already) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", userId).eq("emoji", emoji);
    } else {
      await supabase.from("message_reactions").insert([{ message_id: messageId, user_id: userId, emoji }]);
    }
  }

  // ================= SEND / RETRY / EDIT / DELETE =================
  async function sendMessage(payload: { body: string; attachments?: any | null }) {
    if (!isAshland || !userId) return router.push("/me");
    if (mustConfirmBeforeChat) return;

    const body = payload.body.trim();
    const hasAttachment = payload.attachments && Object.keys(payload.attachments).length > 0;
    if (!body && !hasAttachment) return;

    setErr(null);

    const client_id = makeClientId();
    const tempId = `temp-${client_id}`;
    const now = new Date().toISOString();

    const optimistic: MessageRow = {
      id: tempId,
      thread_id: threadId,
      sender_id: userId,
      body,
      created_at: now,
      client_id,
      edited_at: null,
      deleted_at: null,
      reply_to: replyTo?.id ?? null,
      attachments: payload.attachments ?? null,
    };

    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);
    setText("");
    scrollToBottom(true);

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          thread_id: threadId,
          sender_id: userId,
          body,
          client_id,
          reply_to: replyTo?.id ?? null,
          attachments: payload.attachments ?? null,
        },
      ])
      .select("id,thread_id,sender_id,body,created_at,client_id,edited_at,deleted_at,reply_to,attachments")
      .single();

    if (error) {
      setErr(error.message || "Send failed. Tap the message to retry.");
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, edited_at: "FAILED" } : m)));
      return;
    }

    const real = data as MessageRow;
    setMessages((prev) => prev.map((m) => (m.id === tempId ? real : m)));
    await markSeenNow(userId);
  }

  async function retrySend(temp: MessageRow) {
    if (!userId) return;
    if (!String(temp.id).startsWith("temp-")) return;
    await sendMessage({ body: temp.body || "", attachments: temp.attachments ?? null });
    setMessages((prev) => prev.filter((m) => m.id !== temp.id));
  }

  async function startEdit(m: MessageRow) {
    if (!userId) return;
    if (m.sender_id !== userId) return;
    if (m.deleted_at) return;
    if (String(m.id).startsWith("temp-")) return;
    setEditingId(m.id);
    setEditingText(m.body || "");
  }

  async function saveEdit() {
    if (!userId || !editingId) return;
    const body = editingText.trim();
    if (!body) return;

    const id = editingId;
    setEditingId(null);
    setErr(null);

    const editedAt = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body, edited_at: editedAt } : m)));

    const { error } = await supabase.from("messages").update({ body, edited_at: editedAt }).eq("id", id);
    if (error) setErr(error.message || "Edit failed.");
  }

  async function deleteMessage(id: string) {
    if (!userId) return;
    const m = messages.find((x) => x.id === id);
    if (!m) return;
    if (m.sender_id !== userId) return;
    if (String(m.id).startsWith("temp-")) return;

    const ok = confirm("Delete this message?");
    if (!ok) return;

    setErr(null);
    const deletedAt = new Date().toISOString();

    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, deleted_at: deletedAt } : x)));
    const { error } = await supabase.from("messages").update({ deleted_at: deletedAt }).eq("id", id);
    if (error) setErr(error.message || "Delete failed.");
  }

  // ================= IMAGE UPLOAD =================
  async function uploadImage(file: File) {
    if (!userId) return null;

    // keep simple: allow any image, but validate common formats
    if (!file.type?.startsWith("image/")) {
      setErr("Please upload an image file.");
      return null;
    }

    // optional: strict types
    if (!isAllowedImage(file)) {
      setErr("Upload JPG, PNG, or WEBP.");
      return null;
    }

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `threads/${threadId}/${userId}/${Date.now()}.${ext}`;

    setUploading(true);
    setErr(null);

    const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });

    if (upErr) {
      setUploading(false);
      setErr(upErr.message || "Upload failed.");
      return null;
    }

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    setUploading(false);
    return data.publicUrl;
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const url = await uploadImage(f);
    if (!url) return;

    await sendMessage({
      body: "",
      attachments: { type: "image", url },
    });
  }

  // ================= PICKUP CONFIRM (your existing gate) =================
  async function confirmPickupFromChat() {
    if (!isAshland || !userId) return router.push("/me");
    if (!thread?.item_id || !myInterest?.id) return;
    if (!mustConfirmBeforeChat) return;

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
      await markSeenNow(userId);
    } catch (e: any) {
      setErr(e?.message || "Could not confirm pickup.");
    }
  }

  // ================= TRADE (FULFILLMENT LOOP) =================
  function isParticipant(t: TradeRow, uid: string | null) {
    if (!uid) return false;
    return t.seller_id === uid || t.buyer_id === uid;
  }

  async function loadTrade() {
    if (!threadId) return;
    setTradeLoading(true);
    setTradeErr(null);

    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      setTradeErr(error.message);
      setTrade(null);
      setTradeLoading(false);
      return;
    }

    const row = (data?.[0] as TradeRow) ?? null;
    // if canceled, treat as no active deal
    if (row?.state === "canceled") setTrade(null);
    else setTrade(row);

    setTradeLoading(false);
  }

  async function proposeTrade() {
    if (!userId || !thread || !thread.item_id || !thread.owner_id || !thread.requester_id) return;

    // don’t allow before pickup confirmation if you’re gating chat
    if (mustConfirmBeforeChat) return;

    setTradeErr(null);

    const { error } = await supabase.from("trades").insert([
      {
        item_id: thread.item_id,
        thread_id: threadId,
        seller_id: thread.owner_id,
        buyer_id: thread.requester_id,
        state: "proposed",
        proposed_by: userId,
      },
    ]);

    if (error) {
      // unique index likely hit; just reload
      await loadTrade();
      return;
    }

    await insertSystemMessage({
      threadId,
      senderId: userId,
      body: "📌 Pickup/help proposed. Waiting for the other person to confirm.",
    });

    await loadTrade();
  }

  async function confirmTrade() {
    if (!trade || !userId) return;
    if (!isParticipant(trade, userId)) return;
    if (trade.state !== "proposed") return;
    if (trade.proposed_by === userId) {
      setTradeErr("Waiting for the other person to confirm.");
      return;
    }

    setTradeErr(null);

    const { error: updErr } = await supabase
      .from("trades")
      .update({ state: "confirmed", confirmed_by: userId })
      .eq("id", trade.id);

    if (updErr) {
      setTradeErr(updErr.message);
      return;
    }

    // reserve item
    await supabase.from("items").update({ status: "reserved" }).eq("id", trade.item_id);

    await insertSystemMessage({
      threadId,
      senderId: userId,
      body: "✅ Confirmed. You can mark it completed after pickup/help is done.",
    });

    await loadTrade();
    // refresh item header status
    if (thread?.item_id) {
      const { data: it } = await supabase
        .from("items")
        .select("id,title,photo_url,status,owner_id")
        .eq("id", thread.item_id)
        .single();
      if (it) setItem(it as any);
    }
  }

  async function markFulfilled() {
    if (!trade || !userId) return;
    if (!isParticipant(trade, userId)) return;
    if (trade.state !== "confirmed") return;

    setTradeErr(null);

    const { error: updErr } = await supabase
      .from("trades")
      .update({ state: "fulfilled", fulfilled_by: userId })
      .eq("id", trade.id);

    if (updErr) {
      setTradeErr(updErr.message);
      return;
    }

    await supabase.from("items").update({ status: "completed" }).eq("id", trade.item_id);

    await insertSystemMessage({
      threadId,
      senderId: userId,
      body: "🏁 Marked completed. Thanks for using ScholarSwap.",
    });

    await loadTrade();
    if (thread?.item_id) {
      const { data: it } = await supabase
        .from("items")
        .select("id,title,photo_url,status,owner_id")
        .eq("id", thread.item_id)
        .single();
      if (it) setItem(it as any);
    }
  }

  async function cancelTrade() {
    if (!trade || !userId) return;
    if (!isParticipant(trade, userId)) return;
    if (trade.state !== "proposed" && trade.state !== "confirmed") return;

    setTradeErr(null);

    const { error: updErr } = await supabase
      .from("trades")
      .update({ state: "canceled", canceled_by: userId })
      .eq("id", trade.id);

    if (updErr) {
      setTradeErr(updErr.message);
      return;
    }

    // set item back to available (only if not already completed)
    await supabase.from("items").update({ status: "available" }).eq("id", trade.item_id);

    await insertSystemMessage({
      threadId,
      senderId: userId,
      body: "↩️ Deal canceled. Item is available again.",
    });

    setTrade(null);
    if (thread?.item_id) {
      const { data: it } = await supabase
        .from("items")
        .select("id,title,photo_url,status,owner_id")
        .eq("id", thread.item_id)
        .single();
      if (it) setItem(it as any);
    }
  }

  // ================= REALTIME (MESSAGES + PRESENCE + REACTIONS) =================
  async function trackTyping(isTyping: boolean) {
    const ch = channelRef.current as any;
    if (!ch || !userId) return;
    try {
      await ch.track({ user_id: userId, typing: isTyping });
    } catch {
      // ignore
    }
  }

  function onTextChange(v: string) {
    setText(v);
    if (!userId) return;
    if (mustConfirmBeforeChat) return;

    trackTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => trackTyping(false), 900);
  }

  // scroll detect
useEffect(() => {
  const el = listRef.current;
  if (!el) return;

  const node = el; // ✅ node is HTMLDivElement, not nullable

  function onScroll() {
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;

    setStickToBottom(distanceFromBottom < 120);
  }

  node.addEventListener("scroll", onScroll);
  return () => node.removeEventListener("scroll", onScroll);
}, []);

  // realtime subscription
  useEffect(() => {
    if (!threadId || !userId) return;

    // cleanup old
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel(`thread:${threadId}`)
      .on("presence", { event: "sync" }, () => {
        const state = (ch.presenceState() as any) || {};
        const keys = Object.keys(state);
        const otherKeys = keys.filter((k) => k !== userId);

        const typing =
          otherKeys.some((k) => (state?.[k] || []).some((x: any) => !!x?.typing)) || false;

        setOtherTyping(typing);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const ev = payload.eventType;

          if (ev === "INSERT") {
            const row = payload.new as MessageRow;

            // dedupe via client_id
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;

              if (row.client_id) {
                const tempId = `temp-${row.client_id}`;
                const hasTemp = prev.some((m) => m.id === tempId);
                const next = hasTemp ? prev.map((m) => (m.id === tempId ? row : m)) : [...prev, row];
                return next.sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
              }

              return [...prev, row].sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
            });

            if (row.sender_id && row.sender_id !== userId) {
              setTimeout(() => {
                if (stickToBottom) markSeenNow(userId);
              }, 50);
            }
            setTimeout(() => scrollToBottom(), 30);
          }

          if (ev === "UPDATE") {
            const row = payload.new as MessageRow;
            setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => {
          // reload counts (cheap enough for MVP)
          if (userId) loadReactions(userId, messages.map((m) => m.id));
        }
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          channelRef.current = ch;
          await ch.track({ user_id: userId, typing: false });
        }
      });

    channelRef.current = ch;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, userId, stickToBottom, mustConfirmBeforeChat]);

  // ================= INITIAL LOAD =================
  useEffect(() => {
    if (!threadId) return;

    (async () => {
      setLoading(true);
      setErr(null);

      const s = await syncAuth();
      const uid = s.uid;
      const email = s.email;

      if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
        router.push("/me");
        return;
      }

      try {
        const th = await loadThreadAndItem(uid);
        await loadMyInterest(uid, th?.item_id ?? null);
        await loadInitialMessages();
        await loadReads(uid);
        await markSeenNow(uid);
        await loadTrade();
        setLoading(false);
      } catch (e: any) {
        setErr(e?.message || "Failed to load conversation.");
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth().then((s) => {
        if (s.uid && s.email && s.email.toLowerCase().endsWith("@ashland.edu")) {
          loadReads(s.uid);
        }
      });
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // reload reactions when messages change
  useEffect(() => {
    if (!userId) return;
    if (messages.length === 0) return;
    loadReactions(userId, messages.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, userId]);

  // ================= UI DERIVED =================
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

  // trade UI
  const dealLabel =
    trade?.state === "proposed"
      ? "Waiting for confirmation"
      : trade?.state === "confirmed"
      ? "Confirmed"
      : trade?.state === "fulfilled"
      ? "Completed"
      : "Not started";

  const canProposeDeal = !trade && !!thread?.item_id && !!thread?.owner_id && !!thread?.requester_id && !mustConfirmBeforeChat;
  const canConfirmDeal = trade?.state === "proposed" && trade?.proposed_by !== userId && isParticipant(trade, userId);
  const canCompleteDeal = trade?.state === "confirmed" && isParticipant(trade, userId);
  const canCancelDeal = trade && (trade.state === "proposed" || trade.state === "confirmed") && isParticipant(trade, userId);

  // ================= RENDER =================
  if (!threadId) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Invalid thread.
      </div>
    );
  }

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 18, paddingBottom: 120 }}>
      {/* top bar */}
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
            <span
              style={{
                ...pillStyle(),
                border: "1px solid rgba(239,68,68,0.35)",
                background: "rgba(239,68,68,0.10)",
              }}
            >
              Unseen: {unseenCount}
            </span>
          )}

          {otherTyping && <span style={pillStyle()}>Typing…</span>}
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
              <img
                src={item.photo_url}
                alt={item.title}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : null}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 950, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.title}
            </div>

            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={pillStyle()}>Status: {item.status || "available"}</span>
              {myInterest?.status ? <span style={pillStyle()}>Interest: {myInterest.status}</span> : null}
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

      {/* fulfillment / deal status (low friction) */}
      {!loading && item && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid rgba(148,163,184,0.15)",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 18,
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontWeight: 950 }}>Deal status</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {tradeLoading ? "Loading…" : dealLabel}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {canProposeDeal && (
              <button
                type="button"
                onClick={proposeTrade}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#16a34a",
                  color: "white",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Confirm pickup
              </button>
            )}

            {canConfirmDeal && (
              <button
                type="button"
                onClick={confirmTrade}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#16a34a",
                  color: "white",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
            )}

            {canCompleteDeal && (
              <button
                type="button"
                onClick={markFulfilled}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#22c55e",
                  color: "white",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Mark completed
              </button>
            )}

            {canCancelDeal && (
              <button
                type="button"
                onClick={cancelTrade}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "transparent",
                  color: "white",
                  fontWeight: 950,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {tradeErr && (
            <div style={{ width: "100%", color: "#f87171", fontSize: 12, marginTop: 6 }}>
              {tradeErr}
            </div>
          )}
        </div>
      )}

      {/* buyer confirm gate */}
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
            style={{
              background: "rgba(20,83,45,1)",
              border: "1px solid rgba(22,101,52,1)",
              color: "white",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 950,
              whiteSpace: "nowrap",
            }}
          >
            Confirm pickup ✅
          </button>
        </div>
      )}

      {/* messages list */}
      <div
        ref={listRef}
        style={{
          marginTop: 14,
          height: "calc(100vh - 360px)",
          overflowY: "auto",
          paddingRight: 6,
        }}
      >
        {hasMore && (
          <button
            onClick={loadOlder}
            disabled={loadingMore}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(255,255,255,0.03)",
              color: "white",
              cursor: loadingMore ? "not-allowed" : "pointer",
              fontWeight: 900,
              opacity: loadingMore ? 0.7 : 1,
            }}
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
        )}

        {messages.map((m) => {
          const mine = !!userId && m.sender_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const deleted = !!m.deleted_at;

          const att = m.attachments || null;
          const isTemp = String(m.id).startsWith("temp-");
          const failed = m.edited_at === "FAILED";

          const replyTarget = m.reply_to ? messages.find((x) => x.id === m.reply_to) : null;

          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: 10 }}>
              <div style={{ maxWidth: "min(680px, 82vw)" }}>
                <div
                  onClick={() => {
                    if (failed && isTemp) retrySend(m);
                  }}
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
                    cursor: failed ? "pointer" : "default",
                    opacity: deleted ? 0.7 : 1,
                  }}
                >
                  {replyTarget && !deleted && (
                    <div
                      style={{
                        marginBottom: 8,
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: "rgba(0,0,0,0.25)",
                        fontSize: 12,
                        opacity: 0.9,
                      }}
                    >
                      Replying to:{" "}
                      <span style={{ fontWeight: 950 }}>
                        {replyTarget.sender_id === userId ? "You" : safeName(otherProfile)}
                      </span>{" "}
                      — {replyTarget.deleted_at ? "Message deleted" : (replyTarget.body || "").slice(0, 80)}
                    </div>
                  )}

                  {deleted ? (
                    <span style={{ fontStyle: "italic" }}>Message deleted</span>
                  ) : (
                    <>
                      {att?.type === "image" && att?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.url}
                          alt="attachment"
                          style={{
                            width: "100%",
                            maxHeight: 360,
                            objectFit: "cover",
                            borderRadius: 14,
                            marginBottom: m.body ? 10 : 0,
                          }}
                        />
                      ) : null}

                      {m.body ? <div style={{ opacity: 0.98 }}>{m.body}</div> : null}

                      {failed ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Send failed — tap to retry</div> : null}
                    </>
                  )}

                  <div
                    style={{
                      opacity: 0.6,
                      fontSize: 12,
                      marginTop: 6,
                      textAlign: "right",
                      display: "flex",
                      gap: 10,
                      justifyContent: "flex-end",
                    }}
                  >
                    <span>{time}</span>
                    {m.edited_at && m.edited_at !== "FAILED" && !deleted ? <span>Edited</span> : null}
                    {mine && lastMyMessage?.id === m.id && !deleted ? (
                      <span style={{ opacity: 0.8, fontWeight: 900 }}>{lastMyMessageSeen ? "Seen" : "Sent"}</span>
                    ) : null}
                  </div>
                </div>

                {!deleted && (
                  <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: mine ? "flex-end" : "flex-start" }}>
                    {Object.entries(reactions[m.id] || {}).map(([emoji, count]) => {
                      const active = !!myReactions?.[m.id]?.[emoji];
                      return (
                        <button
                          key={emoji}
                          onClick={() => toggleReaction(m.id, emoji)}
                          style={{
                            borderRadius: 999,
                            padding: "6px 10px",
                            border: active ? "1px solid rgba(52,211,153,0.45)" : "1px solid rgba(148,163,184,0.22)",
                            background: active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.03)",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: 900,
                            fontSize: 12,
                          }}
                        >
                          {emoji} {count}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => toggleReaction(m.id, "👍")}
                      style={{
                        borderRadius: 999,
                        padding: "6px 10px",
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.03)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => toggleReaction(m.id, "❤️")}
                      style={{
                        borderRadius: 999,
                        padding: "6px 10px",
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.03)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      ❤️
                    </button>

                    <button
                      onClick={() => setReplyTo(m)}
                      style={{
                        borderRadius: 12,
                        padding: "6px 10px",
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.03)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      Reply
                    </button>

                    {m.sender_id === userId && !String(m.id).startsWith("temp-") ? (
                      <>
                        <button
                          onClick={() => startEdit(m)}
                          style={{
                            borderRadius: 12,
                            padding: "6px 10px",
                            border: "1px solid rgba(148,163,184,0.22)",
                            background: "rgba(255,255,255,0.03)",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: 900,
                            fontSize: 12,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteMessage(m.id)}
                          style={{
                            borderRadius: 12,
                            padding: "6px 10px",
                            border: "1px solid rgba(127,29,29,0.80)",
                            background: "rgba(255,255,255,0.03)",
                            color: "white",
                            cursor: "pointer",
                            fontWeight: 900,
                            fontSize: 12,
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* reply banner */}
      {replyTo && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.18)",
            background: "rgba(255,255,255,0.03)",
            padding: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Replying to: {replyTo.deleted_at ? "Message deleted" : (replyTo.body || "").slice(0, 80)}
          </div>
          <button
            onClick={() => setReplyTo(null)}
            style={{
              borderRadius: 12,
              padding: "6px 10px",
              border: "1px solid rgba(148,163,184,0.22)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontWeight: 950,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* edit bar */}
      {editingId && (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            border: "1px solid rgba(52,211,153,0.22)",
            background: "rgba(16,185,129,0.10)",
            padding: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.18)",
              background: "rgba(255,255,255,0.04)",
              color: "white",
              padding: "0 12px",
              outline: "none",
            }}
          />
          <button
            onClick={saveEdit}
            style={{
              height: 44,
              padding: "0 14px",
              borderRadius: 12,
              border: "1px solid rgba(16,185,129,0.35)",
              background: "rgba(16,185,129,0.18)",
              color: "white",
              cursor: "pointer",
              fontWeight: 950,
            }}
          >
            Save
          </button>
          <button
            onClick={() => setEditingId(null)}
            style={{
              height: 44,
              padding: "0 14px",
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontWeight: 950,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* composer */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <label
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.18)",
            background: "rgba(255,255,255,0.04)",
            display: "grid",
            placeItems: "center",
            cursor: uploading || mustConfirmBeforeChat ? "not-allowed" : "pointer",
            opacity: uploading || mustConfirmBeforeChat ? 0.6 : 1,
            fontWeight: 950,
          }}
          title="Upload image"
        >
          📷
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPickImage}
            disabled={uploading || mustConfirmBeforeChat}
            style={{ display: "none" }}
          />
        </label>

        <input
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onFocus={() => userId && markSeenNow(userId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage({ body: text, attachments: null });
            }
          }}
          disabled={mustConfirmBeforeChat}
          placeholder={mustConfirmBeforeChat ? "Confirm pickup above to start chatting…" : "Message…"}
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
          onClick={() => sendMessage({ body: text, attachments: null })}
          disabled={mustConfirmBeforeChat || uploading || !text.trim()}
          style={{
            height: 48,
            padding: "0 16px",
            borderRadius: 12,
            border: "1px solid rgba(16,185,129,0.35)",
            background: "rgba(16,185,129,0.18)",
            color: "white",
            cursor: mustConfirmBeforeChat || uploading || !text.trim() ? "not-allowed" : "pointer",
            fontWeight: 950,
            opacity: mustConfirmBeforeChat || uploading || !text.trim() ? 0.65 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}