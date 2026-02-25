"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  // give fields
  category: string | null;
  pickup_location: string | null;

  // request fields
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  // shared
  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
};

type SellerProfile = {
  full_name: string | null;
  user_role: string | null;
};

type MyInterestRow = {
  id: string;
  status: string | null;
};

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until I cancel";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Until I cancel";

  const now = new Date();
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "Expired";

  const oneDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const dayDiff = Math.round((startOfEnd - startOfToday) / oneDay);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff < 7) return `in ${dayDiff} days`;

  return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 999,
        border: "1px solid rgba(148,163,184,0.20)",
        background: "rgba(255,255,255,0.04)",
        color: "rgba(255,255,255,0.88)",
        fontSize: 13,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function requestGroupLabel(g: string | null) {
  const k = (g ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  return "Request";
}

function requestTimeframeLabel(t: string | null) {
  const k = (t ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [seller, setSeller] = useState<SellerProfile | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // GIVE only
  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  const [saving, setSaving] = useState(false);

  // interest modal state (GIVE only)
  const [showInterest, setShowInterest] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [note, setNote] = useState("");
  const [interestMsg, setInterestMsg] = useState<string | null>(null);

  // photo modal
  const [openImg, setOpenImg] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const isMinePost = useMemo(() => {
    return !!userId && !!item?.owner_id && item.owner_id === userId;
  }, [userId, item?.owner_id]);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadItem() {
    if (!itemId) return;
    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,is_anonymous,expires_at,photo_url,status,owner_id,post_type,request_group,request_timeframe,request_location"
        )
        .eq("id", itemId)
        .single();

      if (itErr) throw new Error(itErr.message);
      const loaded = it as ItemRow;
      // default post_type if old rows exist
      loaded.post_type = (loaded.post_type ?? "give") as PostType;
      setItem(loaded);

      // seller profile (if not anonymous)
      const ownerId = loaded.owner_id ?? null;
      const anon = !!loaded.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof } = await supabase.from("profiles").select("full_name,user_role").eq("id", ownerId).single();
        setSeller((prof as SellerProfile) || null);
      } else {
        setSeller(null);
      }

      // GIVE only: interests count + my interest
      if (loaded.post_type === "give") {
        const { count } = await supabase.from("interests").select("*", { count: "exact", head: true }).eq("item_id", itemId);
        setInterestCount(count ?? 0);

        const { data: s } = await supabase.auth.getSession();
        const uid = s.session?.user?.id ?? null;

        if (uid) {
          const { data: mine, error: mineErr } = await supabase
            .from("interests")
            .select("id,status")
            .eq("item_id", itemId)
            .eq("user_id", uid)
            .maybeSingle();

          if (!mineErr && mine) setMyInterest({ id: (mine as any).id, status: (mine as any).status ?? null });
          else setMyInterest(null);
        } else {
          setMyInterest(null);
        }
      } else {
        // REQUEST: no interests
        setInterestCount(0);
        setMyInterest(null);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load item.");
      setItem(null);
      setSeller(null);
      setMyInterest(null);
    } finally {
      setLoading(false);
    }
  }

  // GIVE: submit interest
  async function submitInterest() {
    if (!item) return;
    if (postType !== "give") return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    if (isMinePost) {
      setInterestMsg("This is your listing.");
      return;
    }

    setSaving(true);
    setInterestMsg(null);

    try {
      const { data, error } = await supabase
        .from("interests")
        .insert([
          {
            item_id: item.id,
            user_id: userId,
            status: "pending",
            earliest_pickup: earliestPickup,
            time_window: timeWindow,
            note: note.trim() || null,
          },
        ])
        .select("id,status")
        .single();

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          setInterestMsg("You already sent an interest request for this item.");
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyInterest({ id: (data as any).id, status: (data as any).status ?? "pending" });
      setInterestCount((c) => c + 1);
      setInterestMsg("✅ Request sent. Wait for seller acceptance.");
      setNote("");
      setShowInterest(false);
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not send request.");
    } finally {
      setSaving(false);
    }
  }

  // GIVE: withdraw
  async function withdrawInterest() {
    if (!item) return;
    if (postType !== "give") return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    if (isMinePost) return;

    const st = (myInterest?.status ?? "").toLowerCase();
    if (st === "accepted" || st === "reserved") {
      setInterestMsg("This request is already accepted/reserved. You can’t withdraw here.");
      return;
    }

    setSaving(true);
    setInterestMsg(null);

    try {
      const { error } = await supabase.from("interests").delete().eq("item_id", item.id).eq("user_id", userId);
      if (error) throw new Error(error.message);

      setMyInterest(null);
      setInterestCount((c) => Math.max(0, c - 1));
      setShowInterest(false);
      setInterestMsg("Removed ✅");
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not remove your request.");
    } finally {
      setSaving(false);
    }
  }

  // GIVE: confirm pickup + chat
  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id) return;
    if (postType !== "give") return;

    if (!isLoggedIn) {
      router.push("/me");
      return;
    }

    if (isMinePost) return;

    const st = (myInterest.status ?? "").toLowerCase();
    if (st !== "accepted") {
      setInterestMsg("You can confirm only after the seller accepts.");
      return;
    }

    if (!item.owner_id) {
      setInterestMsg("Missing seller id. Cannot start chat.");
      return;
    }

    setSaving(true);
    setInterestMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", { p_interest_id: myInterest.id });
      if (rpcErr) throw new Error(rpcErr.message);

      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: userId,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Buyer confirmed pickup. Let’s coordinate a time and place here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not confirm pickup.");
    } finally {
      setSaving(false);
    }
  }

  // REQUEST: offer help -> open chat thread (direct)
  async function offerHelpAndChat() {
    if (!item || !userId) return;

    if (!isLoggedIn) {
      router.push("/me");
      return;
    }

    if (isMinePost) {
      setInterestMsg("This is your request.");
      return;
    }

    if (!item.owner_id) {
      setInterestMsg("Missing requester id. Cannot start chat.");
      return;
    }

    setSaving(true);
    setInterestMsg(null);

    try {
      // Use same thread system: owner = request poster, requester = helper (you)
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id, // poster
        requesterId: userId, // helper
      });

      const g = requestGroupLabel(item.request_group);
      const t = requestTimeframeLabel(item.request_timeframe);
      const loc = (item.request_location ?? "").trim();

      const context = [g, t, loc].filter(Boolean).join(" • ");
      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: `🙌 Offered help on this request.${context ? ` (${context})` : ""} Use this chat to coordinate details.`,
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not open chat.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    syncAuth();
    loadItem();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadItem();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // realtime interest updates ONLY for give posts
  useEffect(() => {
    if (!itemId || !userId) return;
    if (postType !== "give") return;

    const channel = supabase
      .channel(`interest-${itemId}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interests", filter: `item_id=eq.${itemId}` }, (payload) => {
        const row: any = payload.new;
        if (row?.user_id === userId) setMyInterest({ id: row.id, status: row.status ?? null });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId, postType]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showName = item && !item.is_anonymous && seller?.full_name;

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const mineInterested = !!myInterest?.id;
  const isAccepted = myStatus === "accepted";
  const isReserved = myStatus === "reserved";

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <button
        onClick={() => router.back()}
        style={{
          marginBottom: 14,
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

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.85 }}>Loading…</p>}

      {!loading && item && (
        <div style={{ maxWidth: 920 }}>
          <h1 style={{ fontSize: 38, fontWeight: 950, margin: 0, letterSpacing: -0.4 }}>{item.title}</h1>

          {/* chip row */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {postType === "give" && item.category ? <Chip>Category: {item.category}</Chip> : null}
            {postType === "give" && item.pickup_location ? <Chip>Pickup: {item.pickup_location}</Chip> : null}

            {postType === "request" ? (
              <>
                <Chip>Type: {requestGroupLabel(item.request_group)}</Chip>
                {item.request_timeframe ? <Chip>Timeframe: {requestTimeframeLabel(item.request_timeframe)}</Chip> : null}
                {item.request_location ? <Chip>Location: {item.request_location}</Chip> : null}
              </>
            ) : null}

            <Chip>
              {postType === "give" ? "Seller" : "Poster"}:{" "}
              {item.is_anonymous ? "Anonymous" : showName ? seller!.full_name : "Ashland user"}
              {!item.is_anonymous && seller?.user_role ? ` (${seller.user_role})` : ""}
            </Chip>

            {postType === "give" && <Chip>{interestCount} interested</Chip>}

            <Chip>
              {item.expires_at ? `Auto-archives • ${new Date(item.expires_at).toLocaleDateString()}` : "Active • until delisted"}{" "}
              <span style={{ opacity: 0.75 }}>({expiryText})</span>
            </Chip>
          </div>

          {/* media */}
          <div style={{ marginTop: 14 }}>
            {postType === "give" ? (
              item.photo_url ? (
                <button
                  type="button"
                  onClick={() => setOpenImg(item.photo_url!)}
                  style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", width: "100%" }}
                  aria-label="Open photo"
                  title="Open photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.photo_url}
                    alt={item.title}
                    style={{
                      width: "100%",
                      maxWidth: 920,
                      height: 420,
                      objectFit: "cover",
                      borderRadius: 16,
                      border: "1px solid rgba(148,163,184,0.18)",
                      display: "block",
                    }}
                  />
                </button>
              ) : (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 920,
                    height: 240,
                    borderRadius: 16,
                    border: "1px dashed rgba(148,163,184,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(148,163,184,0.9)",
                  }}
                >
                  No photo
                </div>
              )
            ) : (
              // request hero block (beautiful + subtle)
              <div
                style={{
                  width: "100%",
                  maxWidth: 920,
                  minHeight: 220,
                  borderRadius: 16,
                  border: "1px solid rgba(34,197,94,0.22)",
                  background: "linear-gradient(180deg, rgba(34,197,94,0.10), rgba(0,0,0,0.25))",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div style={{ fontWeight: 950, fontSize: 14, opacity: 0.9 }}>
                  {requestGroupLabel(item.request_group)}
                  {item.request_timeframe ? ` • ${requestTimeframeLabel(item.request_timeframe)}` : ""}
                  {item.request_location ? ` • ${item.request_location}` : ""}
                </div>
                <div style={{ marginTop: 10, opacity: 0.8, lineHeight: 1.5 }}>
                  {item.description || "No extra details provided."}
                </div>
              </div>
            )}
          </div>

          {/* description (for give only; requests already show it in hero) */}
          {postType === "give" && (
            <div
              style={{
                marginTop: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(148,163,184,0.16)",
                borderRadius: 16,
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 950, marginBottom: 8 }}>Description</div>
              <div style={{ opacity: 0.9, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {item.description && item.description.trim().toLowerCase() !== "until i cancel" ? item.description : "—"}
              </div>
            </div>
          )}

          {/* actions */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {postType === "give" ? (
              <>
                <button
                  onClick={() => {
                    if (!isLoggedIn) return router.push("/me");
                    if (isMinePost) return;
                    if (mineInterested) return;
                    setInterestMsg(null);
                    setShowInterest(true);
                  }}
                  disabled={saving || mineInterested || isMinePost || (item.status ?? "available") !== "available"}
                  style={{
                    background: isMinePost ? "rgba(255,255,255,0.03)" : mineInterested ? "rgba(255,255,255,0.05)" : "rgba(16,185,129,0.18)",
                    border: "1px solid rgba(148,163,184,0.22)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 12,
                    cursor: saving || mineInterested || isMinePost ? "not-allowed" : "pointer",
                    fontWeight: 950,
                    opacity: saving ? 0.8 : 1,
                  }}
                >
                  {isMinePost
                    ? "Your listing"
                    : !isLoggedIn
                      ? "Interested (login required)"
                      : mineInterested
                        ? isReserved
                          ? "Reserved ✅"
                          : isAccepted
                            ? "Accepted ✅"
                            : "Request sent"
                        : "Interested"}
                </button>

                <button
                  onClick={withdrawInterest}
                  disabled={saving || !mineInterested || isAccepted || isReserved || isMinePost}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(148,163,184,0.22)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 12,
                    cursor: saving || !mineInterested || isAccepted || isReserved || isMinePost ? "not-allowed" : "pointer",
                    fontWeight: 950,
                    opacity: saving || !mineInterested || isAccepted || isReserved || isMinePost ? 0.55 : 1,
                  }}
                >
                  Withdraw
                </button>

                {isAccepted && !isMinePost && (
                  <button
                    onClick={confirmPickupAndChat}
                    disabled={saving}
                    style={{
                      background: "rgba(20,83,45,1)",
                      border: "1px solid rgba(22,101,52,1)",
                      color: "white",
                      padding: "10px 14px",
                      borderRadius: 12,
                      cursor: saving ? "not-allowed" : "pointer",
                      fontWeight: 950,
                      opacity: saving ? 0.8 : 1,
                    }}
                  >
                    Confirm pickup ✅
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={offerHelpAndChat}
                  disabled={saving || isMinePost}
                  style={{
                    background: isMinePost ? "rgba(255,255,255,0.03)" : "rgba(34,197,94,0.18)",
                    border: "1px solid rgba(34,197,94,0.30)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 12,
                    cursor: saving || isMinePost ? "not-allowed" : "pointer",
                    fontWeight: 950,
                    opacity: saving ? 0.8 : 1,
                  }}
                >
                  {isMinePost ? "Your request" : !isLoggedIn ? "Offer help (login required)" : saving ? "Opening…" : "Offer help"}
                </button>

                <button
                  onClick={() => router.push("/messages")}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(148,163,184,0.22)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: 950,
                  }}
                >
                  Messages
                </button>
              </>
            )}

            <button
              onClick={() => router.push("/me")}
              style={{
                background: "transparent",
                border: "1px solid rgba(148,163,184,0.22)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 950,
              }}
            >
              Account
            </button>
          </div>

          {interestMsg && !showInterest && (
            <div style={{ marginTop: 12, opacity: 0.92, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10 }}>
              {interestMsg}
            </div>
          )}

          {/* GIVE: interest modal */}
          {postType === "give" && showInterest && (
            <div
              onClick={() => setShowInterest(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.65)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                zIndex: 50,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  maxWidth: 520,
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(2,6,23,1)",
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 18, fontWeight: 950 }}>Request this item</div>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(148,163,184,0.22)",
                      color: "white",
                      padding: "6px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                      fontWeight: 950,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ marginTop: 12, opacity: 0.85 }}>Tell the lister when you can pick up.</div>

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Earliest pickup</label>
                  <select
                    value={earliestPickup}
                    onChange={(e) => setEarliestPickup(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "black",
                      color: "white",
                      border: "1px solid rgba(148,163,184,0.22)",
                      padding: "10px 12px",
                      borderRadius: 12,
                    }}
                  >
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="weekend">Weekend</option>
                  </select>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Time window</label>
                  <select
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "black",
                      color: "white",
                      border: "1px solid rgba(148,163,184,0.22)",
                      padding: "10px 12px",
                      borderRadius: 12,
                    }}
                  >
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Optional note</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Example: I can meet at the library after 3pm."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      background: "black",
                      color: "white",
                      border: "1px solid rgba(148,163,184,0.22)",
                      padding: "10px 12px",
                      borderRadius: 12,
                      resize: "vertical",
                    }}
                  />
                </div>

                {interestMsg && (
                  <div style={{ marginTop: 12, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10, opacity: 0.92 }}>
                    {interestMsg}
                  </div>
                )}

                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(148,163,184,0.22)",
                      color: "white",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 950,
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={submitInterest}
                    disabled={saving}
                    style={{
                      background: "rgba(16,185,129,0.22)",
                      border: "1px solid rgba(16,185,129,0.35)",
                      color: "white",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: saving ? "not-allowed" : "pointer",
                      fontWeight: 950,
                      opacity: saving ? 0.8 : 1,
                    }}
                  >
                    {saving ? "Sending..." : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* fullscreen image modal (give only) */}
          {postType === "give" && openImg && (
            <div
              onClick={() => setOpenImg(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.75)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
                zIndex: 9999,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(1000px, 95vw)",
                  maxHeight: "90vh",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(148,163,184,0.18)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(148,163,184,0.15)",
                  }}
                >
                  <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenImg(null)}
                    style={{
                      background: "transparent",
                      color: "white",
                      border: "1px solid rgba(148,163,184,0.25)",
                      padding: "6px 10px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 950,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={openImg}
                  alt={item.title}
                  style={{
                    width: "100%",
                    height: "auto",
                    maxHeight: "80vh",
                    objectFit: "contain",
                    display: "block",
                    background: "black",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}