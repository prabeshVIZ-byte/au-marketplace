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
  created_at?: string;
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

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const sameDay = d.toDateString() === now.toDateString();
  const yday = new Date(now);
  yday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yday.toDateString();

  if (sameDay) return "Today";
  if (isYesterday) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function makeClientId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAllowedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function normStatus(s?: string | null) {
  return (s ?? "").toLowerCase().trim();
}

function statusBadge(status?: string | null) {
  const st = normStatus(status);
  if (!st) return { label: "Active", tone: "neutral" as const };
  if (st.includes("complete") || st === "completed") return { label: "Completed", tone: "done" as const };
  if (st.includes("claim") || st === "claimed") return { label: "Claimed", tone: "done" as const };
  if (st.includes("reserve") || st === "reserved") return { label: "Reserved", tone: "warn" as const };
  if (st.includes("available")) return { label: "Available", tone: "good" as const };
  return { label: "Active", tone: "neutral" as const };
}

function dealLabelOf(trade: TradeRow | null) {
  if (!trade) return "Not started";
  if (trade.state === "proposed") return "Waiting for confirmation";
  if (trade.state === "confirmed") return "Confirmed";
  if (trade.state === "fulfilled") return "Completed";
  return "Not started";
}

function dealPillTone(trade: TradeRow | null) {
  if (!trade) return "neutral" as const;
  if (trade.state === "proposed") return "warn" as const;
  if (trade.state === "confirmed") return "good" as const;
  if (trade.state === "fulfilled") return "done" as const;
  return "neutral" as const;
}

function isParticipant(t: TradeRow, uid: string | null) {
  if (!uid) return false;
  return t.seller_id === uid || t.buyer_id === uid;
}

// ================= PAGE =================
export default function ThreadPage() {
  const router = useRouter();
  const params = useParams();

  const threadId = useMemo(() => {
    const raw = (params as any)?.threadId;
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

  // ---------- trade ----------
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

  // ---------- presence ----------
  const [otherTyping, setOtherTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---------- UI ----------
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [uploading, setUploading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

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

  // ================= SEND / EDIT / DELETE =================
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
      setErr(error.message || "Send failed. Tap retry.");
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
    setOpenMenuFor(null);
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
    setOpenMenuFor(null);

    const deletedAt = new Date().toISOString();
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, deleted_at: deletedAt } : x)));
    const { error } = await supabase.from("messages").update({ deleted_at: deletedAt }).eq("id", id);
    if (error) setErr(error.message || "Delete failed.");
  }

  // ================= IMAGE UPLOAD =================
  async function uploadImage(file: File) {
    if (!userId) return null;

    if (!file.type?.startsWith("image/")) {
      setErr("Please upload an image file.");
      return null;
    }
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

    await sendMessage({ body: "", attachments: { type: "image", url } });
  }

  // ================= PICKUP CONFIRM (your gate) =================
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

  // ================= TRADE =================
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
    if (row?.state === "canceled") setTrade(null);
    else setTrade(row);

    setTradeLoading(false);
  }

  async function proposeTrade() {
    if (!userId || !thread || !thread.item_id || !thread.owner_id || !thread.requester_id) return;
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

    await supabase.from("items").update({ status: "reserved" }).eq("id", trade.item_id);

    await insertSystemMessage({
      threadId,
      senderId: userId,
      body: "✅ Confirmed. You can mark it completed after pickup/help is done.",
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

    const node = el;
    function onScroll() {
      const dist = node.scrollHeight - node.scrollTop - node.clientHeight;
      setStickToBottom(dist < 160);
    }

    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  // realtime subscription
  useEffect(() => {
    if (!threadId || !userId) return;

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
        const typing = otherKeys.some((k) => (state?.[k] || []).some((x: any) => !!x?.typing)) || false;
        setOtherTyping(typing);
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const ev = payload.eventType;

          if (ev === "INSERT") {
            const row = payload.new as MessageRow;

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
              }, 60);
            }

            setTimeout(() => scrollToBottom(), 40);
          }

          if (ev === "UPDATE") {
            const row = payload.new as MessageRow;
            setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
          }
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => {
        if (userId) loadReactions(userId, messages.map((m) => m.id));
      })
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

  const dealLabel = dealLabelOf(trade);
  const dealTone = dealPillTone(trade);

  const canProposeDeal = !trade && !!thread?.item_id && !!thread?.owner_id && !!thread?.requester_id && !mustConfirmBeforeChat;
  const canConfirmDeal = trade?.state === "proposed" && trade?.proposed_by !== userId && isParticipant(trade, userId);
  const canCompleteDeal = trade?.state === "confirmed" && isParticipant(trade, userId);
  const canCancelDeal = !!trade && (trade.state === "proposed" || trade.state === "confirmed") && isParticipant(trade, userId);

  const grouped = useMemo(() => {
    const out: Array<
      | { kind: "day"; key: string; label: string }
      | { kind: "msg"; msg: MessageRow; mine: boolean; time: string; deleted: boolean; isTemp: boolean; failed: boolean }
    > = [];

    let lastDayKey = "";
    for (const m of messages) {
      const dayKey = new Date(m.created_at).toDateString();
      if (dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        out.push({ kind: "day", key: dayKey, label: fmtDayLabel(m.created_at) });
      }
      const mine = !!userId && m.sender_id === userId;
      const deleted = !!m.deleted_at;
      const isTemp = String(m.id).startsWith("temp-");
      const failed = m.edited_at === "FAILED";
      out.push({
        kind: "msg",
        msg: m,
        mine,
        time: fmtTime(m.created_at),
        deleted,
        isTemp,
        failed,
      });
    }
    return out;
  }, [messages, userId]);

  // ================= RENDER =================
  if (!threadId) {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f8", color: "#0f172a", padding: 18 }}>
        Invalid thread.
      </div>
    );
  }

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f7f8", color: "#0f172a", padding: 18 }}>
        Checking access…
      </div>
    );
  }

  const st = statusBadge(item?.status);

  return (
    <div className="page" onClick={() => openMenuFor && setOpenMenuFor(null)}>
      {/* Sticky header */}
      <header className="top" onClick={(e) => e.stopPropagation()}>
        <div className="topRow">
          <button className="backBtn" type="button" onClick={() => router.push("/messages")}>
            <span aria-hidden>←</span> Back
          </button>

          <div className="brand">
            <div className="brandName">ScholarSwap</div>
            <div className="brandSub">
              {otherProfile ? safeName(otherProfile) : "Conversation"}
              {otherTyping ? <span className="typing"> • typing…</span> : null}
            </div>
          </div>

          <button
            className="miniBtn"
            type="button"
            onClick={() => {
              loadReads(userId!);
              loadTrade();
            }}
            aria-label="Refresh"
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {err && <div className="err">{err}</div>}

        {!loading && item && (
          <div className="meta">
            <button className="itemCard" type="button" onClick={() => router.push(`/item/${item.id}`)}>
              <div className="thumb">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt={item.title} />
                ) : (
                  <div className="noThumb" aria-hidden>
                    📦
                  </div>
                )}
              </div>

              <div className="itemInfo">
                <div className="itemTitle">{item.title}</div>
                <div className="itemSub">
                  <span className={`badge ${st.tone}`}>{st.label}</span>
                  {myInterest?.status ? <span className="dotSep">•</span> : null}
                  {myInterest?.status ? <span className="muted">Interest: {myInterest.status}</span> : null}
                </div>
              </div>

              <div className="chev" aria-hidden>
                ›
              </div>
            </button>

            {/* Deal bar */}
            <div className="dealBar">
              <div className="dealLeft">
                <div className="dealTitle">Deal</div>
                <div className="dealSub">
                  <span className={`dealPill ${dealTone}`}>{tradeLoading ? "Loading…" : dealLabel}</span>
                  {unseenCount > 0 ? <span className="unseen">Unseen {unseenCount}</span> : null}
                </div>
              </div>

              <div className="dealActions">
                {canProposeDeal && (
                  <button className="actionPrimary" type="button" onClick={proposeTrade}>
                    Propose
                  </button>
                )}
                {canConfirmDeal && (
                  <button className="actionPrimary" type="button" onClick={confirmTrade}>
                    Confirm
                  </button>
                )}
                {canCompleteDeal && (
                  <button className="actionGood" type="button" onClick={markFulfilled}>
                    Complete
                  </button>
                )}
                {canCancelDeal && (
                  <button className="actionGhost" type="button" onClick={cancelTrade}>
                    Cancel
                  </button>
                )}
              </div>

              {tradeErr && <div className="tradeErr">{tradeErr}</div>}
            </div>

            {/* Buyer gate (clean, single CTA) */}
            {mustConfirmBeforeChat && (
              <div className="gate">
                <div className="gateText">
                  Seller accepted your request. <span className="muted">Confirm pickup to start chatting.</span>
                </div>
                <button className="gateBtn" type="button" onClick={confirmPickupFromChat}>
                  Confirm pickup ✅
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && !item && (
          <div className="meta">
            <div className="emptyMeta">
              <div className="emptyMetaTitle">Conversation</div>
              <div className="emptyMetaSub">This thread has no item attached.</div>
            </div>
          </div>
        )}
      </header>

      {/* Messages */}
      <main className="main" onClick={(e) => e.stopPropagation()}>
        <div ref={listRef} className="list">
          {hasMore && (
            <button className="loadMore" onClick={loadOlder} disabled={loadingMore} type="button">
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          )}

          {loading && <div className="loading">Loading…</div>}

          {!loading &&
            grouped.map((x) => {
              if (x.kind === "day") {
                return (
                  <div key={x.key} className="day">
                    <span>{x.label}</span>
                  </div>
                );
              }

              const { msg: m, mine, time, deleted, isTemp, failed } = x;

              const att = m.attachments || null;
              const replyTarget = m.reply_to ? messages.find((z) => z.id === m.reply_to) : null;

              return (
                <div key={m.id} className={`row ${mine ? "mine" : "theirs"}`}>
                  <div className={`bubble ${mine ? "bMine" : "bTheirs"} ${deleted ? "deleted" : ""}`}>
                    {/* reply preview */}
                    {replyTarget && !deleted && (
                      <button
                        className="replyPeek"
                        type="button"
                        onClick={() => {
                          // simple: scroll to target by id if present
                          const el = document.getElementById(`msg-${replyTarget.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        <div className="replyPeekTop">
                          Replying to{" "}
                          <b>{replyTarget.sender_id === userId ? "you" : safeName(otherProfile)}</b>
                        </div>
                        <div className="replyPeekBody">
                          {replyTarget.deleted_at ? "Message deleted" : (replyTarget.body || "").slice(0, 90)}
                        </div>
                      </button>
                    )}

                    {/* body */}
                    <div id={`msg-${m.id}`} className="body">
                      {deleted ? (
                        <span className="deletedText">Message deleted</span>
                      ) : (
                        <>
                          {att?.type === "image" && att?.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="img" src={att.url} alt="attachment" />
                          ) : null}

                          {m.body ? <div className="text">{m.body}</div> : null}

                          {failed ? (
                            <button
                              className="fail"
                              type="button"
                              onClick={() => {
                                if (failed && isTemp) retrySend(m);
                              }}
                            >
                              Send failed — tap to retry
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>

                    {/* footer */}
                    <div className="metaRow">
                      <span className="time">{time}</span>
                      {m.edited_at && m.edited_at !== "FAILED" && !deleted ? <span className="metaTiny">Edited</span> : null}
                      {mine && lastMyMessage?.id === m.id && !deleted ? (
                        <span className="metaTiny">{lastMyMessageSeen ? "Seen" : "Sent"}</span>
                      ) : null}

                      {!deleted && (
                        <button
                          className="menuBtn"
                          type="button"
                          onClick={() => setOpenMenuFor(openMenuFor === m.id ? null : m.id)}
                          aria-label="Message actions"
                          title="Actions"
                        >
                          ⋯
                        </button>
                      )}
                    </div>

                    {/* quick actions row (minimal) */}
                    {!deleted && (
                      <div className="actions">
                        <button className="rx" type="button" onClick={() => toggleReaction(m.id, "👍")}>
                          👍
                        </button>
                        <button className="rx" type="button" onClick={() => toggleReaction(m.id, "❤️")}>
                          ❤️
                        </button>
                        <button className="act" type="button" onClick={() => setReplyTo(m)}>
                          Reply
                        </button>

                        {openMenuFor === m.id && (
                          <div className={`menu ${mine ? "right" : "left"}`} onClick={(e) => e.stopPropagation()}>
                            <div className="menuGrid">
                              <button className="menuItem" type="button" onClick={() => navigator.clipboard.writeText(m.body || "")}>
                                Copy
                              </button>
                              {mine && !String(m.id).startsWith("temp-") ? (
                                <>
                                  <button className="menuItem" type="button" onClick={() => startEdit(m)}>
                                    Edit
                                  </button>
                                  <button className="menuItem danger" type="button" onClick={() => deleteMessage(m.id)}>
                                    Delete
                                  </button>
                                </>
                              ) : null}
                              <button className="menuItem" type="button" onClick={() => setOpenMenuFor(null)}>
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* reaction chips */}
                    {!deleted && Object.keys(reactions[m.id] || {}).length > 0 && (
                      <div className={`chips ${mine ? "chipsMine" : "chipsTheirs"}`}>
                        {Object.entries(reactions[m.id] || {}).map(([emoji, count]) => {
                          const active = !!myReactions?.[m.id]?.[emoji];
                          return (
                            <button
                              key={emoji}
                              className={`chip ${active ? "on" : ""}`}
                              type="button"
                              onClick={() => toggleReaction(m.id, emoji)}
                            >
                              {emoji} {count}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          <div ref={bottomRef} />
        </div>

        {!stickToBottom && (
          <button className="toBottom" type="button" onClick={() => scrollToBottom(true)} aria-label="Scroll to latest">
            ↓ New
          </button>
        )}
      </main>

      {/* Composer */}
      <footer className="composerWrap" onClick={(e) => e.stopPropagation()}>
        {replyTo && (
          <div className="replyBanner">
            <div className="replyText">
              Replying to: {replyTo.deleted_at ? "Message deleted" : (replyTo.body || "").slice(0, 110)}
            </div>
            <button className="replyClose" type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              ✕
            </button>
          </div>
        )}

        {editingId && (
          <div className="editBanner">
            <input
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              className="editInput"
              placeholder="Edit message…"
            />
            <button className="editSave" type="button" onClick={saveEdit}>
              Save
            </button>
            <button className="editCancel" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        )}

        <div className={`composer ${mustConfirmBeforeChat ? "disabled" : ""}`}>
          <label className="iconBtn" title="Upload image">
            <span aria-hidden>📎</span>
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
            className="input"
          />

          <button
            className="send"
            type="button"
            onClick={() => sendMessage({ body: text, attachments: null })}
            disabled={mustConfirmBeforeChat || uploading || !text.trim()}
            aria-label="Send"
            title="Send"
          >
            <span className="sendIcon" aria-hidden>
              ➤
            </span>
          </button>
        </div>
      </footer>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f7f7f8;
          color: #0f172a;
          padding-bottom: 110px;
        }

        .top {
          position: sticky;
          top: 0;
          z-index: 30;
          background: rgba(247, 247, 248, 0.92);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid #e5e7eb;
        }

        .topRow {
          display: grid;
          grid-template-columns: 88px 1fr 44px;
          align-items: center;
          gap: 10px;
          padding: 14px 14px 10px;
        }

        .backBtn {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 999px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 950;
          color: #111827;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .brand {
          min-width: 0;
          text-align: center;
        }

        .brandName {
          font-weight: 950;
          letter-spacing: -0.4px;
          font-size: 16px;
          line-height: 1.1;
        }

        .brandSub {
          font-size: 12px;
          color: #6b7280;
          font-weight: 900;
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .typing {
          color: #065f46;
          font-weight: 950;
        }

        .miniBtn {
          width: 44px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .err {
          padding: 0 14px 10px;
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
        }

        .meta {
          padding: 0 14px 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .itemCard {
          width: 100%;
          text-align: left;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 18px;
          padding: 12px;
          display: grid;
          grid-template-columns: 58px 1fr 16px;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
        }

        .thumb {
          width: 58px;
          height: 58px;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
        }

        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .noThumb {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          color: #6b7280;
          font-weight: 950;
          font-size: 18px;
        }

        .itemInfo {
          min-width: 0;
        }

        .itemTitle {
          font-weight: 950;
          color: #111827;
          font-size: 15px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .itemSub {
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .badge {
          font-size: 12px;
          font-weight: 950;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #6b7280;
        }

        .badge.good {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
          color: #065f46;
        }

        .badge.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.25);
          color: #92400e;
        }

        .badge.done {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.25);
          color: #1e3a8a;
        }

        .muted {
          color: #6b7280;
          font-weight: 800;
          font-size: 12px;
        }

        .dotSep {
          color: #9ca3af;
          font-weight: 900;
          font-size: 12px;
        }

        .chev {
          color: #9ca3af;
          font-weight: 950;
          font-size: 20px;
          text-align: right;
        }

        .dealBar {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 18px;
          padding: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: center;
        }

        .dealLeft {
          min-width: 0;
        }

        .dealTitle {
          font-weight: 950;
          color: #111827;
          font-size: 13px;
        }

        .dealSub {
          margin-top: 6px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .dealPill {
          font-size: 12px;
          font-weight: 950;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #6b7280;
        }

        .dealPill.good {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
          color: #065f46;
        }
        .dealPill.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.25);
          color: #92400e;
        }
        .dealPill.done {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.25);
          color: #1e3a8a;
        }

        .unseen {
          font-size: 12px;
          font-weight: 950;
          color: #b91c1c;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 6px 10px;
          border-radius: 999px;
        }

        .dealActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .actionPrimary,
        .actionGood,
        .actionGhost {
          height: 38px;
          border-radius: 14px;
          font-weight: 950;
          cursor: pointer;
          padding: 0 12px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
        }

        .actionPrimary {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }

        .actionGood {
          border-color: rgba(34, 197, 94, 0.25);
          background: rgba(34, 197, 94, 0.12);
          color: #065f46;
        }

        .actionGhost {
          background: #ffffff;
          color: #111827;
        }

        .tradeErr {
          grid-column: 1 / -1;
          color: #b91c1c;
          font-weight: 900;
          font-size: 12px;
          margin-top: 6px;
        }

        .gate {
          border-radius: 18px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          padding: 12px;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
        }

        .gateText {
          font-weight: 950;
          color: #065f46;
          font-size: 13px;
          line-height: 1.2;
        }

        .gateBtn {
          height: 38px;
          border-radius: 14px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: #065f46;
          color: #ffffff;
          font-weight: 950;
          cursor: pointer;
          padding: 0 12px;
          white-space: nowrap;
        }

        .emptyMeta {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 18px;
          padding: 12px;
        }

        .emptyMetaTitle {
          font-weight: 950;
          color: #111827;
        }

        .emptyMetaSub {
          margin-top: 6px;
          color: #6b7280;
          font-weight: 800;
          font-size: 12px;
        }

        .main {
          padding: 12px 14px 0;
          max-width: 900px;
          margin: 0 auto;
        }

        .list {
          height: calc(100vh - 350px);
          overflow-y: auto;
          padding-bottom: 10px;
        }

        .loadMore {
          width: 100%;
          height: 42px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          font-weight: 950;
          cursor: pointer;
          margin-bottom: 10px;
        }

        .loading {
          color: #6b7280;
          font-weight: 900;
          font-size: 13px;
          padding: 10px 2px;
        }

        .day {
          display: flex;
          justify-content: center;
          margin: 14px 0 10px;
        }

        .day span {
          font-size: 12px;
          font-weight: 950;
          color: #6b7280;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.9);
          padding: 6px 10px;
          border-radius: 999px;
        }

        .row {
          display: flex;
          margin: 10px 0;
        }

        .row.mine {
          justify-content: flex-end;
        }

        .row.theirs {
          justify-content: flex-start;
        }

        .bubble {
          max-width: min(720px, 88vw);
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.06);
          overflow: visible;
        }

        .bMine {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.22);
        }

        .bTheirs {
          background: #ffffff;
        }

        .deleted {
          opacity: 0.7;
        }

        .replyPeek {
          width: 100%;
          text-align: left;
          border: none;
          background: rgba(15, 23, 42, 0.04);
          border-bottom: 1px solid rgba(229, 231, 235, 0.9);
          padding: 10px 12px;
          cursor: pointer;
        }

        .replyPeekTop {
          font-size: 11px;
          font-weight: 950;
          color: #6b7280;
        }

        .replyPeekBody {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 800;
          color: #111827;
          opacity: 0.9;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .body {
          padding: 10px 12px;
        }

        .text {
          white-space: pre-wrap;
          word-break: break-word;
          font-weight: 700;
          color: #111827;
          font-size: 14px;
          line-height: 1.35;
        }

        .deletedText {
          font-style: italic;
          color: #6b7280;
          font-weight: 800;
        }

        .img {
          width: 100%;
          max-height: 360px;
          object-fit: cover;
          border-radius: 14px;
          border: 1px solid rgba(229, 231, 235, 0.9);
          margin-bottom: 10px;
          display: block;
        }

        .fail {
          margin-top: 10px;
          width: 100%;
          height: 36px;
          border-radius: 14px;
          border: 1px solid rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.1);
          color: #b91c1c;
          font-weight: 950;
          cursor: pointer;
        }

        .metaRow {
          padding: 0 12px 10px;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
        }

        .time {
          color: #6b7280;
          font-weight: 900;
          font-size: 12px;
        }

        .metaTiny {
          color: #6b7280;
          font-weight: 900;
          font-size: 12px;
        }

        .menuBtn {
          margin-left: auto;
          width: 34px;
          height: 28px;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          color: #111827;
        }

        .actions {
          padding: 0 12px 12px;
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
          position: relative;
        }

        .rx {
          height: 32px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          padding: 0 10px;
        }

        .act {
          height: 32px;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          padding: 0 10px;
          color: #111827;
        }

        .menu {
          position: absolute;
          top: 40px;
          z-index: 50;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
          padding: 10px;
          width: 220px;
        }

        .menu.right {
          right: 12px;
        }

        .menu.left {
          left: 12px;
        }

        .menuGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .menuItem {
          height: 38px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          color: #111827;
          text-align: left;
          padding: 0 12px;
        }

        .menuItem.danger {
          border-color: rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.08);
          color: #b91c1c;
        }

        .chips {
          display: flex;
          gap: 8px;
          padding: 0 12px 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .chip {
          height: 30px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          padding: 0 10px;
          color: #111827;
          font-size: 12px;
        }

        .chip.on {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }

        .toBottom {
          position: fixed;
          right: 14px;
          bottom: 118px;
          height: 44px;
          border-radius: 999px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
          font-weight: 950;
          cursor: pointer;
          padding: 0 14px;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
        }

        .composerWrap {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 10px 14px 16px;
          background: rgba(247, 247, 248, 0.92);
          backdrop-filter: blur(12px);
          border-top: 1px solid #e5e7eb;
          z-index: 40;
        }

        .replyBanner {
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          border-radius: 16px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .replyText {
          font-weight: 900;
          color: #065f46;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }

        .replyClose {
          width: 36px;
          height: 36px;
          border-radius: 14px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          font-weight: 950;
          color: #065f46;
        }

        .editBanner {
          border: 1px solid rgba(59, 130, 246, 0.25);
          background: rgba(59, 130, 246, 0.1);
          border-radius: 16px;
          padding: 10px;
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 8px;
          margin-bottom: 10px;
        }

        .editInput {
          height: 42px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 0 12px;
          outline: none;
          font-weight: 800;
          color: #111827;
        }

        .editSave,
        .editCancel {
          height: 42px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          cursor: pointer;
          font-weight: 950;
          padding: 0 12px;
          color: #111827;
        }

        .composer {
          display: grid;
          grid-template-columns: 46px 1fr 46px;
          gap: 10px;
          align-items: center;
        }

        .composer.disabled {
          opacity: 0.7;
        }

        .iconBtn {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          display: grid;
          place-items: center;
          cursor: pointer;
          font-weight: 950;
          color: #111827;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .input {
          height: 46px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 0 12px;
          outline: none;
          font-weight: 800;
          color: #111827;
        }

        .input::placeholder {
          color: #9ca3af;
          font-weight: 800;
        }

        .send {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
          font-weight: 950;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .send:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sendIcon {
          font-size: 16px;
          transform: translateX(1px);
        }

        @media (min-width: 900px) {
          .topRow {
            padding-left: 18px;
            padding-right: 18px;
          }
          .meta {
            padding-left: 18px;
            padding-right: 18px;
          }
          .main {
            padding-left: 18px;
            padding-right: 18px;
          }
          .composerWrap {
            padding-left: 18px;
            padding-right: 18px;
          }
          .list {
            height: calc(100vh - 330px);
          }
        }
      `}</style>
    </div>
  );
}