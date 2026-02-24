"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  pickup_location: string | null;
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

function pillStyle() {
  return {
    fontSize: 12,
    fontWeight: 950,
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(148,163,184,0.18)",
    color: "rgba(255,255,255,0.85)",
    whiteSpace: "nowrap" as const,
  };
}

function statusPill(status: string | null) {
  const st = (status ?? "available").toLowerCase();
  const base = pillStyle();

  if (st === "reserved") {
    return {
      ...base,
      border: "1px solid rgba(96,165,250,0.35)",
      background: "rgba(59,130,246,0.16)",
      color: "rgba(191,219,254,0.95)",
    };
  }
  if (st === "available") {
    return {
      ...base,
      border: "1px solid rgba(52,211,153,0.35)",
      background: "rgba(16,185,129,0.14)",
      color: "rgba(209,250,229,0.95)",
    };
  }
  if (st === "expired") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.35)",
      background: "rgba(239,68,68,0.12)",
      color: "rgba(254,202,202,0.95)",
    };
  }
  return base;
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

  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  const [saving, setSaving] = useState(false);

  // interest modal
  const [showInterest, setShowInterest] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [note, setNote] = useState("");
  const [interestMsg, setInterestMsg] = useState<string | null>(null);

  // photo modal (same UX as feed)
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState<string>("");

  const mineInterested = !!myInterest?.id;

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const isOwner = useMemo(() => {
    if (!item?.owner_id || !userId) return false;
    return item.owner_id === userId;
  }, [item?.owner_id, userId]);

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const isAccepted = myStatus === "accepted";
  const isReserved = myStatus === "reserved";

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
        .select("id,title,description,category,pickup_location,is_anonymous,expires_at,photo_url,status,owner_id")
        .eq("id", itemId)
        .single();

      if (itErr) throw new Error(itErr.message);
      setItem(it as ItemRow);

      const { count, error: cntErr } = await supabase
        .from("interests")
        .select("*", { count: "exact", head: true })
        .eq("item_id", itemId);

      if (!cntErr) setInterestCount(count ?? 0);

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

      const ownerId = (it as any)?.owner_id ?? null;
      const anon = !!(it as any)?.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof, error: pErr } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", ownerId)
          .single();

        if (!pErr) setSeller(prof as SellerProfile);
        else setSeller(null);
      } else {
        setSeller(null);
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

  async function submitInterest() {
    if (!item) return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    if (item.owner_id && item.owner_id === userId) {
      setInterestMsg("You can’t request your own listing.");
      setShowInterest(false);
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
          setInterestMsg("You already sent a request for this item.");
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

  async function withdrawInterest() {
    if (!item) return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

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

  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id) return;

    if (!isLoggedIn) {
      router.push("/me");
      return;
    }

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
        body: `✅ Pickup confirmed for “${item.title}”. Let’s coordinate time & location here.`,
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not confirm pickup.");
    } finally {
      setSaving(false);
    }
  }

  // auth + load
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

  // realtime: update my interest quickly
  useEffect(() => {
    if (!itemId || !userId) return;

    const channel = supabase
      .channel(`interest-${itemId}-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interests", filter: `item_id=eq.${itemId}` },
        (payload) => {
          const row: any = payload.new;
          if (row?.user_id === userId) {
            setMyInterest({ id: row.id, status: row.status ?? null });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId]);

  // escape closes image modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showSellerName = item && !item.is_anonymous && seller?.full_name;

  const canRequest =
    !!item &&
    (item.status ?? "available") === "available" &&
    isLoggedIn &&
    !isOwner &&
    !mineInterested &&
    !saving;

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button
          onClick={() => router.push("/feed")}
          style={{
            background: "transparent",
            color: "white",
            border: "1px solid rgba(148,163,184,0.25)",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          ← Back
        </button>

        {isOwner && item ? (
          <button
            onClick={() => router.push(`/manage/${item.id}`)}
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "white",
              border: "1px solid rgba(148,163,184,0.25)",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 950,
              whiteSpace: "nowrap",
            }}
          >
            Manage requests
          </button>
        ) : (
          <button
            onClick={() => router.push("/messages")}
            style={{
              background: "transparent",
              color: "white",
              border: "1px solid rgba(148,163,184,0.25)",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            Messages
          </button>
        )}
      </div>

      {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}
      {loading && <p style={{ marginTop: 12, opacity: 0.8 }}>Loading…</p>}

      {!loading && item && (
        <div style={{ maxWidth: 980, marginTop: 14 }}>
          {/* HEADER: compact + non-intimidating */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 34, fontWeight: 950, letterSpacing: -0.4 }}>{item.title}</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={statusPill(item.status)}>{(item.status ?? "available").toLowerCase()}</span>
              {item.category ? <span style={pillStyle()}>Category: {item.category}</span> : null}
              {item.pickup_location ? <span style={pillStyle()}>Pickup: {item.pickup_location}</span> : null}
              <span style={pillStyle()}>Requests: {interestCount}</span>
              <span style={pillStyle()}>
                {item.expires_at ? `Until: ${new Date(item.expires_at).toLocaleString()}` : "De-list: manual"}{" "}
                <span style={{ opacity: 0.75 }}>({expiryText})</span>
              </span>
              <span style={pillStyle()}>
                Seller:{" "}
                <b>
                  {item.is_anonymous ? "Anonymous" : showSellerName ? seller!.full_name : "Ashland user"}
                </b>
                {!item.is_anonymous && seller?.user_role ? (
                  <span style={{ opacity: 0.75 }}> • {seller.user_role}</span>
                ) : null}
              </span>
            </div>
          </div>

          {/* IMAGE: clickable -> modal like feed */}
          <div style={{ marginTop: 14 }}>
            {item.photo_url ? (
              <button
                type="button"
                onClick={() => {
                  setOpenImg(item.photo_url!);
                  setOpenTitle(item.title);
                }}
                style={{
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  width: "100%",
                  maxWidth: 980,
                }}
                title="Open photo"
                aria-label="Open photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.photo_url}
                  alt={item.title}
                  style={{
                    width: "100%",
                    maxWidth: 980,
                    height: 440,
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
                  maxWidth: 980,
                  height: 260,
                  borderRadius: 16,
                  border: "1px dashed rgba(148,163,184,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.55)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                No photo
              </div>
            )}
          </div>

          {/* DESCRIPTION */}
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
            <div style={{ opacity: 0.88, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {item.description && item.description.trim().toLowerCase() !== "until i cancel"
                ? item.description
                : "—"}
            </div>
          </div>

          {/* ACTIONS */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* Owner shouldn’t request */}
            {isOwner ? (
              <div
                style={{
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 12px",
                  borderRadius: 14,
                  fontWeight: 900,
                  opacity: 0.9,
                }}
              >
                You listed this item.
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (!isLoggedIn) {
                      router.push("/me");
                      return;
                    }
                    if (mineInterested) return;
                    setInterestMsg(null);
                    setShowInterest(true);
                  }}
                  disabled={!canRequest}
                  style={{
                    border: "1px solid rgba(52,211,153,0.25)",
                    background: mineInterested ? "rgba(255,255,255,0.05)" : "rgba(16,185,129,0.18)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 14,
                    cursor: canRequest ? "pointer" : "not-allowed",
                    fontWeight: 950,
                    opacity: canRequest ? 1 : 0.6,
                  }}
                  title={
                    !isLoggedIn
                      ? "Login required"
                      : mineInterested
                      ? "You already requested"
                      : (item.status ?? "available") !== "available"
                      ? "Not available"
                      : "Send a request"
                  }
                >
                  {!isLoggedIn
                    ? "Request (login required)"
                    : mineInterested
                    ? isReserved
                      ? "Reserved ✅"
                      : isAccepted
                      ? "Accepted ✅"
                      : "Requested"
                    : "Request item"}
                </button>

                <button
                  onClick={withdrawInterest}
                  disabled={saving || !mineInterested || isAccepted || isReserved}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(148,163,184,0.25)",
                    color: "white",
                    padding: "10px 14px",
                    borderRadius: 14,
                    cursor: saving || !mineInterested || isAccepted || isReserved ? "not-allowed" : "pointer",
                    fontWeight: 900,
                    opacity: saving || !mineInterested || isAccepted || isReserved ? 0.55 : 1,
                  }}
                >
                  Cancel request
                </button>

                {isAccepted && (
                  <button
                    onClick={confirmPickupAndChat}
                    disabled={saving}
                    style={{
                      background: "rgba(16,185,129,0.24)",
                      border: "1px solid rgba(52,211,153,0.35)",
                      color: "white",
                      padding: "10px 14px",
                      borderRadius: 14,
                      cursor: saving ? "not-allowed" : "pointer",
                      fontWeight: 950,
                      opacity: saving ? 0.75 : 1,
                    }}
                  >
                    Confirm pickup & chat ✅
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => router.push("/me")}
              style={{
                background: "transparent",
                border: "1px solid rgba(148,163,184,0.25)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 14,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Account
            </button>
          </div>

          {/* Messages */}
          {interestMsg && (
            <div style={{ marginTop: 12, border: "1px solid rgba(148,163,184,0.2)", borderRadius: 14, padding: 12, opacity: 0.92 }}>
              {interestMsg}
            </div>
          )}

          {/* INTEREST MODAL */}
          {showInterest && (
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
                  background: "rgba(2,6,23,0.98)",
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 18, fontWeight: 950 }}>Request this item</div>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(148,163,184,0.25)",
                      color: "white",
                      padding: "6px 10px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 950,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ marginTop: 10, opacity: 0.82 }}>
                  Quick details so the lister picks someone who will actually show up.
                </div>

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Earliest pickup</label>
                  <select
                    value={earliestPickup}
                    onChange={(e) => setEarliestPickup(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "black",
                      color: "white",
                      border: "1px solid rgba(148,163,184,0.25)",
                      padding: "10px 12px",
                      borderRadius: 12,
                      fontWeight: 900,
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
                      border: "1px solid rgba(148,163,184,0.25)",
                      padding: "10px 12px",
                      borderRadius: 12,
                      fontWeight: 900,
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
                      border: "1px solid rgba(148,163,184,0.25)",
                      padding: "10px 12px",
                      borderRadius: 12,
                      resize: "vertical",
                    }}
                  />
                </div>

                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(148,163,184,0.25)",
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
                      border: "1px solid rgba(52,211,153,0.35)",
                      color: "white",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: saving ? "not-allowed" : "pointer",
                      fontWeight: 950,
                      opacity: saving ? 0.75 : 1,
                    }}
                  >
                    {saving ? "Sending..." : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* FULLSCREEN IMAGE MODAL (copied UX from feed) */}
          {openImg && (
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
                    {openTitle || "Photo"}
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
                  alt={openTitle || "Full photo"}
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