"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { insertSystemMessage } from "@/lib/ensureThread";

// ================= TYPES =================
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

type ThreadReadRow = {
  thread_id: string;
  user_id: string;
  last_seen_at: string;
};

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
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉"];

// ================= HELPERS =================
function isoToMs(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function safeName(p: ProfileRow | null) {
  const n = (p?.full_name ?? "").trim();
  return n || "Campus user";
}

function initialsOf(name?: string | null) {
  const clean = (name || "").trim();
  if (!clean) return "AU";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "AU";
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();

  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();

  if (sameDay) return "Today";
  if (isYesterday) return "Yesterday";

  return d.toLocaleDateString([], { month: "short", day: "numeric" });
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

function dealToneOf(trade: TradeRow | null) {
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

function isImageAttachment(att: any) {
  return !!att && att.type === "image" && typeof att.url === "string" && att.url.trim().length > 0;
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
  const [showDealSheet, setShowDealSheet] = useState(false);

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

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const [bottomNavH, setBottomNavH] = useState(86);

  useEffect(() => {
    const update = () => {
      const nav = document.querySelector("nav");
      const h = nav ? (nav as HTMLElement).getBoundingClientRect().height : 86;
      setBottomNavH(Math.max(72, Math.min(120, Math.round(h || 86))));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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

  const otherName = safeName(otherProfile);

  function scrollToBottom(force = false) {
    if (!stickToBottom && !force) return;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function autoGrowComposer() {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function stopTypingNow() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (!userId) return;
    const ch = channelRef.current as any;
    if (!ch) return;
    ch.track({ user_id: userId, typing: false }).catch(() => {});
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
    const { data: hidden } = await supabase
      .from("user_hidden_threads")
      .select("id")
      .eq("user_id", uid)
      .eq("thread_id", threadId)
      .maybeSingle();

    if (hidden) {
      router.push("/messages");
      return null;
    }

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

    return ((data as MessageRow[]) || []).sort((a, b) => isoToMs(a.created_at) - isoToMs(b.created_at));
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
      setErr(e?.message || "Could not load older messages.");
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
    } catch {}
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

  // ================= SEND / EDIT / DELETE MSG =================
  async function sendMessage(payload: { body: string; attachments?: any | null }) {
    if (!isAshland || !userId) return router.push("/me");
    if (mustConfirmBeforeChat) return;

    const body = payload.body.trim();
    const hasAttachment = payload.attachments && Object.keys(payload.attachments).length > 0;
    if (!body && !hasAttachment) return;

    stopTypingNow();
    setErr(null);

    const client_id = makeClientId();
    const tempId = `temp-${client_id}`;
    const now = new Date().toISOString();

    const reply = replyTo;

    const optimistic: MessageRow = {
      id: tempId,
      thread_id: threadId,
      sender_id: userId,
      body,
      created_at: now,
      client_id,
      edited_at: null,
      deleted_at: null,
      reply_to: reply?.id ?? null,
      attachments: payload.attachments ?? null,
    };

    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);
    setText("");
    setSelectedMessageId(null);
    setTimeout(() => autoGrowComposer(), 0);
    scrollToBottom(true);

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          thread_id: threadId,
          sender_id: userId,
          body,
          client_id,
          reply_to: reply?.id ?? null,
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
    setSelectedMessageId(null);
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
    setSelectedMessageId(null);

    const deletedAt = new Date().toISOString();
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, deleted_at: deletedAt } : x)));

    const { error } = await supabase.from("messages").update({ deleted_at: deletedAt }).eq("id", id);
    if (error) setErr(error.message || "Delete failed.");
  }

  // ================= DELETE THREAD FOR ME =================
  async function deleteThreadForMe() {
    if (!userId || !threadId) return;

    const ok = confirm("Delete this conversation for you? The other user will still keep it.");
    if (!ok) return;

    setErr(null);

    const { error } = await supabase.from("user_hidden_threads").upsert(
      [{ user_id: userId, thread_id: threadId }],
      { onConflict: "user_id,thread_id" }
    );

    if (error) {
      setErr(error.message || "Could not delete this conversation for you.");
      return;
    }

    stopTypingNow();
    router.push("/messages");
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

  // ================= PICKUP CONFIRM =================
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

  // ================= PRESENCE / TYPING =================
  async function trackTyping(isTyping: boolean) {
    const ch = channelRef.current as any;
    if (!ch || !userId) return;
    try {
      await ch.track({ user_id: userId, typing: isTyping });
    } catch {}
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
      setStickToBottom(dist < 180);
    }

    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  // textarea auto-grow
  useEffect(() => {
    autoGrowComposer();
  }, [text]);

  // realtime
  useEffect(() => {
    if (!threadId || !userId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const ch = supabase
      .channel(`thread:${threadId}`)
      .on("presence", { event: "sync" }, () => {
        const state = (ch.presenceState() as Record<string, any[]>) || {};
        const allPresences = Object.values(state).flat();

        const otherIsTyping = allPresences.some((entry: any) => {
          return entry?.user_id && entry.user_id !== userId && entry.typing === true;
        });

        setOtherTyping(otherIsTyping);
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
      stopTypingNow();
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
        if (!th) return;

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

  // reactions load
  useEffect(() => {
    if (!userId) return;
    if (messages.length === 0) return;
    loadReactions(userId, messages.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, userId]);

  useEffect(() => {
    return () => stopTypingNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const grouped = useMemo(() => {
    const out: Array<{ kind: "day"; key: string; label: string } | { kind: "msg"; msg: MessageRow }> = [];
    let lastDay = "";

    for (const m of messages) {
      const dayKey = new Date(m.created_at).toDateString();
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        out.push({ kind: "day", key: dayKey, label: fmtDayLabel(m.created_at) });
      }
      out.push({ kind: "msg", msg: m });
    }

    return out;
  }, [messages]);

  const st = statusBadge(item?.status);
  const dealLabel = dealLabelOf(trade);
  const dealTone = dealToneOf(trade);

  const canProposeDeal = !trade && !!thread?.item_id && !!thread?.owner_id && !!thread?.requester_id && !mustConfirmBeforeChat;
  const canConfirmDeal = !!trade && trade.state === "proposed" && trade.proposed_by !== userId && isParticipant(trade, userId);
  const canCompleteDeal = !!trade && trade.state === "confirmed" && isParticipant(trade, userId);
  const canCancelDeal = !!trade && (trade.state === "proposed" || trade.state === "confirmed") && isParticipant(trade, userId);

  const COMPOSER_MIN_H = 74;
  const BANNER_H = replyTo || editingId ? 62 : 0;
  const reservedBottom = bottomNavH + COMPOSER_MIN_H + BANNER_H + 22;

  if (!threadId) {
    return <div style={{ minHeight: "100vh", padding: 18 }}>Invalid thread.</div>;
  }

  if (!isAshland) {
    return <div style={{ minHeight: "100vh", padding: 18 }}>Checking access…</div>;
  }

  return (
    <div
      className="page"
      onClick={() => {
        setSelectedMessageId(null);
        if (showDealSheet) setShowDealSheet(false);
      }}
    >
      <header className="header" onClick={(e) => e.stopPropagation()}>
        <div className="headerRow">
          <button className="iconGhost" type="button" onClick={() => router.push("/messages")} aria-label="Back">
            ←
          </button>

          <button
            className="identity"
            type="button"
            onClick={() => item?.id && router.push(`/item/${item.id}`)}
            title={item?.title || "Conversation"}
          >
            <div className="avatar">{initialsOf(otherName)}</div>

            <div className="identityText">
              <div className="identityName">{otherName}</div>
              <div className="identitySub">
                {otherTyping ? "Typing…" : item?.title ? item.title : "Conversation"}
              </div>
            </div>
          </button>

          <button
            className="iconGhost"
            type="button"
            onClick={() => {
              if (userId) loadReads(userId);
              loadTrade();
            }}
            aria-label="Refresh"
          >
            ↻
          </button>
        </div>

        {item && (
          <div className="contextStrip">
            <button className="listingPill" type="button" onClick={() => router.push(`/item/${item.id}`)}>
              <div className="listingThumb">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt={item.title} />
                ) : (
                  <span>📦</span>
                )}
              </div>

              <div className="listingMeta">
                <div className="listingTitle">{item.title}</div>
                <div className="listingSub">
                  <span className={`statusChip ${st.tone}`}>{st.label}</span>
                  {myInterest?.status ? <span className="tinyDot">•</span> : null}
                  {myInterest?.status ? <span>Interest: {myInterest.status}</span> : null}
                </div>
              </div>
            </button>

            <button className="dealPillBtn" type="button" onClick={() => setShowDealSheet((v) => !v)}>
              <span className={`dealChip ${dealTone}`}>{tradeLoading ? "Loading…" : dealLabel}</span>
              {unseenCount > 0 ? <span className="notifDot">{unseenCount}</span> : null}
            </button>
          </div>
        )}

        {err ? <div className="errorBox">{err}</div> : null}

        {mustConfirmBeforeChat && (
          <div className="gateBar">
            <div className="gateText">
              Seller accepted your request. Confirm pickup to unlock chat.
            </div>
            <button className="gateAction" type="button" onClick={confirmPickupFromChat}>
              Confirm pickup
            </button>
          </div>
        )}
      </header>

      {showDealSheet && (
        <div className="sheetWrap" onClick={(e) => e.stopPropagation()}>
          <div className="sheet">
            <div className="sheetHandle" />
            <div className="sheetTitle">Conversation options</div>
            <div className="sheetSub">Keep the thread clean. Manage deal actions here.</div>

            <div className="sheetActions">
              {canProposeDeal && (
                <button className="sheetPrimary" type="button" onClick={proposeTrade}>
                  Propose deal
                </button>
              )}
              {canConfirmDeal && (
                <button className="sheetPrimary" type="button" onClick={confirmTrade}>
                  Confirm deal
                </button>
              )}
              {canCompleteDeal && (
                <button className="sheetGood" type="button" onClick={markFulfilled}>
                  Mark completed
                </button>
              )}
              {canCancelDeal && (
                <button className="sheetGhost" type="button" onClick={cancelTrade}>
                  Cancel deal
                </button>
              )}

              <button className="sheetDanger" type="button" onClick={deleteThreadForMe}>
                Delete for me
              </button>
            </div>

            {tradeErr ? <div className="sheetErr">{tradeErr}</div> : null}
          </div>
        </div>
      )}

      <main className="thread" style={{ paddingBottom: reservedBottom }} onClick={(e) => e.stopPropagation()}>
        <div ref={listRef} className="threadInner">
          {hasMore && (
            <div className="olderWrap">
              <button className="olderBtn" onClick={loadOlder} disabled={loadingMore} type="button">
                {loadingMore ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}

          {loading && <div className="loadingState">Loading conversation…</div>}

          {!loading &&
            grouped.map((entry, index) => {
              if (entry.kind === "day") {
                return (
                  <div key={entry.key} className="dayDivider">
                    <span>{entry.label}</span>
                  </div>
                );
              }

              const m = entry.msg;
              const mine = !!userId && m.sender_id === userId;
              const deleted = !!m.deleted_at;
              const isTemp = String(m.id).startsWith("temp-");
              const failed = m.edited_at === "FAILED";
              const time = fmtTime(m.created_at);
              const att = m.attachments || null;
              const replyTarget = m.reply_to ? messages.find((z) => z.id === m.reply_to) : null;

              const prevMessage =
                index > 0 && grouped[index - 1]?.kind === "msg"
                  ? (grouped[index - 1] as { kind: "msg"; msg: MessageRow }).msg
                  : null;

              const groupedWithPrev =
                !!prevMessage &&
                prevMessage.sender_id === m.sender_id &&
                new Date(prevMessage.created_at).toDateString() === new Date(m.created_at).toDateString() &&
                isoToMs(m.created_at) - isoToMs(prevMessage.created_at) < 5 * 60 * 1000;

              const showAvatar = !mine && !groupedWithPrev;
              const isSelected = selectedMessageId === m.id;

              return (
                <div
                  key={m.id}
                  className={`messageRow ${mine ? "mine" : "theirs"} ${groupedWithPrev ? "tight" : ""}`}
                  id={`msg-${m.id}`}
                >
                  {!mine ? (
                    <div className="avatarSlot">
                      {showAvatar ? <div className="miniAvatar">{initialsOf(otherName)}</div> : <div className="avatarSpacer" />}
                    </div>
                  ) : null}

                  <div className={`messageStack ${mine ? "mine" : "theirs"}`}>
                    {replyTarget && !deleted && (
                      <button
                        className={`replyCard ${mine ? "mine" : "theirs"}`}
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`msg-${replyTarget.id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                          setSelectedMessageId(null);
                        }}
                      >
                        <div className="replyLabel">
                          Replying to {replyTarget.sender_id === userId ? "you" : otherName}
                        </div>
                        <div className="replyPreview">
                          {replyTarget.deleted_at
                            ? "Message deleted"
                            : (replyTarget.body || "").slice(0, 120) || "Attachment"}
                        </div>
                      </button>
                    )}

                    <button
                      className={`bubble ${mine ? "mine" : "theirs"} ${deleted ? "deleted" : ""} ${isSelected ? "selected" : ""}`}
                      type="button"
                      onClick={() => setSelectedMessageId((cur) => (cur === m.id ? null : m.id))}
                    >
                      {deleted ? (
                        <div className="deletedText">Message deleted</div>
                      ) : (
                        <>
                          {isImageAttachment(att) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="bubbleImage" src={att.url} alt="attachment" />
                          ) : null}

                          {m.body ? <div className="bubbleText">{m.body}</div> : null}

                          {failed ? (
                            <button className="failedBtn" type="button" onClick={() => failed && isTemp && retrySend(m)}>
                              Send failed — tap to retry
                            </button>
                          ) : null}
                        </>
                      )}
                    </button>

                    {!deleted && Object.keys(reactions[m.id] || {}).length > 0 && (
                      <div className={`reactionRow ${mine ? "mine" : "theirs"}`}>
                        {Object.entries(reactions[m.id] || {}).map(([emoji, count]) => {
                          const active = !!myReactions?.[m.id]?.[emoji];
                          return (
                            <button
                              key={emoji}
                              className={`reactionChip ${active ? "active" : ""}`}
                              type="button"
                              onClick={() => toggleReaction(m.id, emoji)}
                            >
                              {emoji} {count}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className={`metaLine ${mine ? "mine" : "theirs"}`}>
                      <span>{time}</span>
                      {m.edited_at && m.edited_at !== "FAILED" && !deleted ? <span>Edited</span> : null}
                      {mine && lastMyMessage?.id === m.id && !deleted ? (
                        <span>{lastMyMessageSeen ? "Seen" : "Sent"}</span>
                      ) : null}
                    </div>

                    {isSelected && !deleted && (
                      <div className={`actionTray ${mine ? "mine" : "theirs"}`}>
                        <div className="quickReactions">
                          {QUICK_REACTIONS.map((emoji) => (
                            <button key={emoji} className="quickReactionBtn" type="button" onClick={() => toggleReaction(m.id, emoji)}>
                              {emoji}
                            </button>
                          ))}
                        </div>

                        <div className="trayButtons">
                          <button
                            className="trayBtn"
                            type="button"
                            onClick={() => {
                              setReplyTo(m);
                              setSelectedMessageId(null);
                            }}
                          >
                            Reply
                          </button>

                          <button
                            className="trayBtn"
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(m.body || "");
                              setSelectedMessageId(null);
                            }}
                          >
                            Copy
                          </button>

                          {mine && !String(m.id).startsWith("temp-") ? (
                            <>
                              <button className="trayBtn" type="button" onClick={() => startEdit(m)}>
                                Edit
                              </button>
                              <button className="trayBtn danger" type="button" onClick={() => deleteMessage(m.id)}>
                                Delete
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          {otherTyping && !mustConfirmBeforeChat && (
            <div className="typingRow">
              <div className="avatarSlot">
                <div className="miniAvatar">{initialsOf(otherName)}</div>
              </div>
              <div className="typingBubble">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {!stickToBottom && (
          <button className="jumpBtn" type="button" onClick={() => scrollToBottom(true)} aria-label="Jump to latest">
            ↓ Latest
          </button>
        )}
      </main>

      {replyTo && (
        <div className="floatingBanner" style={{ bottom: bottomNavH + COMPOSER_MIN_H + 10 }}>
          <div className="floatingInner">
            <div className="floatingLabel">Replying to</div>
            <div className="floatingBody">
              {replyTo.deleted_at ? "Message deleted" : (replyTo.body || "").slice(0, 140) || "Attachment"}
            </div>
            <button className="floatingClose" type="button" onClick={() => setReplyTo(null)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {editingId && (
        <div className="floatingBanner" style={{ bottom: bottomNavH + COMPOSER_MIN_H + 10 }}>
          <div className="floatingInner editMode">
            <input className="editField" value={editingText} onChange={(e) => setEditingText(e.target.value)} />
            <button className="floatingSave" type="button" onClick={saveEdit} disabled={!editingText.trim()}>
              Save
            </button>
            <button className="floatingGhost" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="composerDock" style={{ bottom: bottomNavH }} onClick={(e) => e.stopPropagation()}>
        <div className="composerShell">
          <label className={`attachBtn ${uploading || mustConfirmBeforeChat ? "disabled" : ""}`} title="Upload image">
            ＋
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onPickImage}
              disabled={uploading || mustConfirmBeforeChat}
              style={{ display: "none" }}
            />
          </label>

          <div className="composerBox">
            <textarea
              ref={composerRef}
              className="composerInput"
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onBlur={stopTypingNow}
              onFocus={() => userId && markSeenNow(userId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage({ body: text, attachments: null });
                }
              }}
              disabled={mustConfirmBeforeChat}
              placeholder={mustConfirmBeforeChat ? "Confirm pickup above to start chatting…" : "Message"}
              rows={1}
            />
          </div>

          <button
            className={`sendFab ${!text.trim() || uploading || mustConfirmBeforeChat ? "disabled" : ""}`}
            type="button"
            onClick={() => sendMessage({ body: text, attachments: null })}
            disabled={!text.trim() || uploading || mustConfirmBeforeChat}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top, rgba(16, 185, 129, 0.08), transparent 24%),
            #f8fafc;
          color: #0f172a;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 20;
          background: rgba(248, 250, 252, 0.92);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          padding: 10px 12px 12px;
        }

        .headerRow {
          display: grid;
          grid-template-columns: 44px 1fr 44px;
          gap: 10px;
          align-items: center;
        }

        .iconGhost {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.9);
          color: #0f172a;
          font-weight: 900;
          font-size: 18px;
          cursor: pointer;
        }

        .identity {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          border: none;
          background: transparent;
          text-align: left;
          cursor: pointer;
          padding: 2px 0;
        }

        .avatar {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          font-size: 13px;
          font-weight: 950;
          flex-shrink: 0;
          box-shadow: 0 8px 20px rgba(16, 185, 129, 0.22);
        }

        .identityText {
          min-width: 0;
        }

        .identityName {
          font-size: 15px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .identitySub {
          margin-top: 1px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .contextStrip {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }

        .listingPill {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          text-align: left;
        }

        .listingThumb {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          overflow: hidden;
          background: #eef2f7;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          color: #64748b;
          border: 1px solid rgba(15, 23, 42, 0.08);
        }

        .listingThumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .listingMeta {
          min-width: 0;
        }

        .listingTitle {
          font-size: 13px;
          font-weight: 900;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .listingSub {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 2px;
          font-size: 11px;
          color: #64748b;
          font-weight: 800;
        }

        .tinyDot {
          opacity: 0.5;
        }

        .statusChip,
        .dealChip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 24px;
          border-radius: 999px;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 950;
          border: 1px solid rgba(15, 23, 42, 0.1);
          background: rgba(15, 23, 42, 0.04);
          color: #334155;
        }

        .statusChip.good,
        .dealChip.good {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.24);
          color: #047857;
        }

        .statusChip.warn,
        .dealChip.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.24);
          color: #92400e;
        }

        .statusChip.done,
        .dealChip.done {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.24);
          color: #1d4ed8;
        }

        .dealPillBtn {
          position: relative;
          border: none;
          background: transparent;
          padding: 0;
          cursor: pointer;
        }

        .notifDot {
          position: absolute;
          top: -4px;
          right: -2px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: #ef4444;
          color: white;
          font-size: 10px;
          font-weight: 950;
          display: grid;
          place-items: center;
          border: 2px solid #f8fafc;
        }

        .errorBox {
          margin-top: 10px;
          border-radius: 16px;
          padding: 10px 12px;
          background: rgba(239, 68, 68, 0.08);
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
          border: 1px solid rgba(239, 68, 68, 0.16);
        }

        .gateBar {
          margin-top: 10px;
          border-radius: 18px;
          padding: 12px;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.16);
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .gateText {
          font-size: 13px;
          font-weight: 900;
          color: #065f46;
        }

        .gateAction {
          height: 40px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(16, 185, 129, 0.22);
          background: rgba(16, 185, 129, 0.16);
          color: #065f46;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }

        .sheetWrap {
          position: fixed;
          inset: 0;
          z-index: 40;
          background: rgba(15, 23, 42, 0.22);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 12px;
        }

        .sheet {
          width: min(560px, 100%);
          background: #ffffff;
          border-radius: 24px 24px 18px 18px;
          padding: 10px 14px 16px;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
        }

        .sheetHandle {
          width: 46px;
          height: 5px;
          border-radius: 999px;
          background: #d1d5db;
          margin: 0 auto 12px;
        }

        .sheetTitle {
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
        }

        .sheetSub {
          margin-top: 4px;
          font-size: 13px;
          color: #64748b;
          font-weight: 700;
        }

        .sheetActions {
          margin-top: 14px;
          display: grid;
          gap: 10px;
        }

        .sheetPrimary,
        .sheetGood,
        .sheetGhost,
        .sheetDanger {
          height: 48px;
          border-radius: 16px;
          font-weight: 950;
          cursor: pointer;
        }

        .sheetPrimary {
          border: 1px solid rgba(16, 185, 129, 0.24);
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
        }

        .sheetGood {
          border: 1px solid rgba(34, 197, 94, 0.24);
          background: rgba(34, 197, 94, 0.12);
          color: #166534;
        }

        .sheetGhost {
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
          color: #0f172a;
        }

        .sheetDanger {
          border: 1px solid rgba(239, 68, 68, 0.22);
          background: rgba(239, 68, 68, 0.08);
          color: #b91c1c;
        }

        .sheetErr {
          margin-top: 10px;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 900;
        }

        .thread {
          padding: 10px 12px 0;
        }

        .threadInner {
          max-width: 860px;
          margin: 0 auto;
        }

        .olderWrap {
          display: flex;
          justify-content: center;
          margin: 6px 0 10px;
        }

        .olderBtn {
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.86);
          height: 38px;
          padding: 0 14px;
          border-radius: 999px;
          font-weight: 900;
          color: #334155;
          cursor: pointer;
        }

        .loadingState {
          text-align: center;
          color: #64748b;
          font-weight: 800;
          padding: 30px 0;
        }

        .dayDivider {
          display: flex;
          justify-content: center;
          margin: 18px 0 12px;
        }

        .dayDivider span {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 28px;
          padding: 0 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(15, 23, 42, 0.06);
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }

        .messageRow {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          margin-top: 10px;
        }

        .messageRow.tight {
          margin-top: 4px;
        }

        .messageRow.mine {
          justify-content: flex-end;
        }

        .messageRow.theirs {
          justify-content: flex-start;
        }

        .avatarSlot {
          width: 34px;
          flex-shrink: 0;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .miniAvatar,
        .avatarSpacer {
          width: 28px;
          height: 28px;
          border-radius: 999px;
        }

        .miniAvatar {
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          font-size: 10px;
          font-weight: 950;
        }

        .messageStack {
          display: flex;
          flex-direction: column;
          max-width: min(74vw, 560px);
        }

        .messageStack.mine {
          align-items: flex-end;
        }

        .messageStack.theirs {
          align-items: flex-start;
        }

        .replyCard {
          width: fit-content;
          max-width: 100%;
          margin-bottom: 4px;
          padding: 8px 10px;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid rgba(15, 23, 42, 0.06);
          text-align: left;
          cursor: pointer;
        }

        .replyCard.mine {
          background: rgba(16, 185, 129, 0.1);
          border-color: rgba(16, 185, 129, 0.12);
        }

        .replyLabel {
          font-size: 11px;
          font-weight: 900;
          color: #475569;
        }

        .replyPreview {
          margin-top: 3px;
          font-size: 12px;
          font-weight: 700;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bubble {
          border: none;
          cursor: pointer;
          text-align: left;
          max-width: 100%;
          padding: 12px 14px;
          border-radius: 22px;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
        }

        .bubble.selected {
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.18);
        }

        .bubble.mine {
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          border-bottom-right-radius: 8px;
        }

        .bubble.theirs {
          background: #ffffff;
          color: #0f172a;
          border-bottom-left-radius: 8px;
          border: 1px solid rgba(15, 23, 42, 0.06);
        }

        .bubble.deleted {
          background: rgba(15, 23, 42, 0.05);
          color: #64748b;
        }

        .bubbleImage {
          width: 100%;
          max-height: 360px;
          object-fit: cover;
          border-radius: 16px;
          display: block;
          margin-bottom: 8px;
        }

        .bubbleText {
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 14px;
          line-height: 1.38;
          font-weight: 700;
        }

        .deletedText {
          font-size: 14px;
          font-style: italic;
          font-weight: 700;
        }

        .failedBtn {
          margin-top: 8px;
          border: none;
          width: 100%;
          height: 38px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.22);
          color: inherit;
          font-weight: 900;
          cursor: pointer;
        }

        .reactionRow {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .reactionRow.mine {
          justify-content: flex-end;
        }

        .reactionRow.theirs {
          justify-content: flex-start;
        }

        .reactionChip {
          height: 26px;
          border-radius: 999px;
          padding: 0 10px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.92);
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          color: #0f172a;
        }

        .reactionChip.active {
          border-color: rgba(16, 185, 129, 0.22);
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
        }

        .metaLine {
          margin-top: 4px;
          display: flex;
          gap: 8px;
          font-size: 11px;
          font-weight: 800;
          color: #94a3b8;
          padding: 0 4px;
        }

        .metaLine.mine {
          justify-content: flex-end;
        }

        .metaLine.theirs {
          justify-content: flex-start;
        }

        .actionTray {
          margin-top: 6px;
          display: grid;
          gap: 8px;
          width: 100%;
        }

        .actionTray.mine {
          justify-items: end;
        }

        .actionTray.theirs {
          justify-items: start;
        }

        .quickReactions {
          display: flex;
          gap: 6px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          padding: 6px;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
        }

        .quickReactionBtn {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          border: none;
          background: transparent;
          font-size: 18px;
          cursor: pointer;
        }

        .trayButtons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .trayBtn {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .trayBtn.danger {
          color: #b91c1c;
          background: rgba(239, 68, 68, 0.06);
          border-color: rgba(239, 68, 68, 0.12);
        }

        .typingRow {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          margin-top: 14px;
        }

        .typingBubble {
          height: 42px;
          min-width: 68px;
          padding: 0 14px;
          border-radius: 22px;
          border-bottom-left-radius: 8px;
          background: white;
          border: 1px solid rgba(15, 23, 42, 0.06);
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .typingBubble span {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #94a3b8;
          display: block;
          animation: blink 1s infinite ease-in-out;
        }

        .typingBubble span:nth-child(2) {
          animation-delay: 0.12s;
        }

        .typingBubble span:nth-child(3) {
          animation-delay: 0.24s;
        }

        @keyframes blink {
          0%, 80%, 100% {
            transform: scale(0.85);
            opacity: 0.45;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .jumpBtn {
          position: fixed;
          right: 14px;
          bottom: calc(${bottomNavH}px + 88px);
          height: 42px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
          color: #0f172a;
          font-weight: 950;
          cursor: pointer;
          z-index: 25;
        }

        .floatingBanner {
          position: fixed;
          left: 12px;
          right: 12px;
          z-index: 45;
        }

        .floatingInner {
          max-width: 860px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 18px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.1);
          padding: 10px 12px;
          backdrop-filter: blur(10px);
        }

        .floatingInner.editMode {
          gap: 8px;
        }

        .floatingLabel {
          font-size: 11px;
          font-weight: 950;
          color: #10b981;
          flex-shrink: 0;
        }

        .floatingBody {
          min-width: 0;
          flex: 1;
          font-size: 12px;
          font-weight: 800;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .floatingClose,
        .floatingSave,
        .floatingGhost {
          height: 38px;
          border-radius: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .floatingClose {
          width: 38px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
        }

        .floatingSave {
          padding: 0 12px;
          border: 1px solid rgba(16, 185, 129, 0.24);
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
        }

        .floatingSave:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .floatingGhost {
          padding: 0 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #ffffff;
          color: #0f172a;
        }

        .editField {
          flex: 1;
          min-width: 0;
          height: 38px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: white;
          color: #0f172a;
          padding: 0 12px;
          outline: none;
          font-weight: 800;
        }

        .composerDock {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 44;
          padding: 10px 12px;
          padding-bottom: calc(10px + env(safe-area-inset-bottom));
          background: linear-gradient(to top, rgba(248, 250, 252, 0.98), rgba(248, 250, 252, 0.88));
          backdrop-filter: blur(12px);
          border-top: 1px solid rgba(15, 23, 42, 0.06);
        }

        .composerShell {
          max-width: 860px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 46px 1fr 46px;
          gap: 10px;
          align-items: end;
        }

        .attachBtn,
        .sendFab {
          width: 46px;
          min-width: 46px;
          height: 46px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 20px;
          font-weight: 950;
        }

        .attachBtn {
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: white;
          color: #0f172a;
          cursor: pointer;
        }

        .attachBtn.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .composerBox {
          min-height: 46px;
          border-radius: 24px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: white;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
        }

        .composerInput {
          width: 100%;
          max-height: 140px;
          resize: none;
          overflow: auto;
          border: none;
          outline: none;
          background: transparent;
          color: #0f172a;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.35;
        }

        .composerInput::placeholder {
          color: #94a3b8;
        }

        .composerInput:disabled {
          opacity: 0.7;
        }

        .sendFab {
          border: none;
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          box-shadow: 0 10px 24px rgba(16, 185, 129, 0.24);
          cursor: pointer;
        }

        .sendFab.disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
        }

        @media (min-width: 720px) {
          .header {
            padding-left: 18px;
            padding-right: 18px;
          }

          .thread {
            padding-left: 18px;
            padding-right: 18px;
          }

          .floatingBanner {
            left: 18px;
            right: 18px;
          }

          .composerDock {
            padding-left: 18px;
            padding-right: 18px;
          }
        }
      `}</style>
    </div>
  );
}