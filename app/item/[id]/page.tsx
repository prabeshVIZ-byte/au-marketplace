"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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

  // interest modal state
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

  const isMineListing = useMemo(() => {
    return !!userId && !!item?.owner_id && item.owner_id === userId;
  }, [userId, item?.owner_id]);

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

      const ownerId = (it as any)?.owner_id ?? null;
      const anon = !!(it as any)?.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof } = await supabase.from("profiles").select("full_name,user_role").eq("id", ownerId).single();
        setSeller((prof as SellerProfile) || null);
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

    if (isMineListing) {
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

  async function withdrawInterest() {
    if (!item) return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    if (isMineListing) return;

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

  // ✅ Buyer confirm: reserve via RPC + ensure thread + system msg + redirect to chat thread
  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id) return;

    if (!isLoggedIn) {
      router.push("/me");
      return;
    }

    if (isMineListing) return;

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
      // 1) reserve atomically
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", { p_interest_id: myInterest.id });
      if (rpcErr) throw new Error(rpcErr.message);

      // 2) create/find thread
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: userId,
      });

      // 3) "notify" seller inside the thread
      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Buyer confirmed pickup. Let’s coordinate a time and place here.",
      });

      // 4) go to chat
      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not confirm pickup.");
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

  // ✅ realtime interest updates: buyer sees acceptance instantly
  useEffect(() => {
    if (!itemId || !userId) return;

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
  }, [itemId, userId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showSellerName = item && !item.is_anonymous && seller?.full_name;

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const mineInterested = !!myInterest?.id;
  const isAccepted = myStatus === "accepted";
  const isReserved = myStatus === "reserved";

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <button
        onClick={() => router.back()}
        style={{ marginBottom: 14, background: "transparent", color: "white", border: "1px solid rgba(148,163,184,0.25)", padding: "8px 12px", borderRadius: 12, cursor: "pointer", fontWeight: 900 }}
      >
        ← Back
      </button>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.85 }}>Loading…</p>}

      {!loading && item && (
        <div style={{ maxWidth: 920 }}>
          <h1 style={{ fontSize: 38, fontWeight: 950, margin: 0, letterSpacing: -0.4 }}>{item.title}</h1>

          {/* ✅ Less wordy: chip row */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {item.category ? <Chip>Category: {item.category}</Chip> : null}
            {item.pickup_location ? <Chip>Pickup: {item.pickup_location}</Chip> : null}

            <Chip>
              Seller:{" "}
              {item.is_anonymous ? "Anonymous" : showSellerName ? seller!.full_name : "Ashland user"}
              {!item.is_anonymous && seller?.user_role ? ` (${seller.user_role})` : ""}
            </Chip>

            <Chip>{interestCount} interested</Chip>

            <Chip>
              {item.expires_at ? `Available • ${new Date(item.expires_at).toLocaleDateString()}` : "Available • until delisted"}{" "}
              <span style={{ opacity: 0.75 }}>({expiryText})</span>
            </Chip>
          </div>

          {/* photo */}
          <div style={{ marginTop: 14 }}>
            {item.photo_url ? (
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
            )}
          </div>

          {/* description */}
          <div style={{ marginTop: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 16, padding: 14 }}>
            <div style={{ fontWeight: 950, marginBottom: 8 }}>Description</div>
            <div style={{ opacity: 0.9, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
              {item.description && item.description.trim().toLowerCase() !== "until i cancel" ? item.description : "—"}
            </div>
          </div>

          {/* actions */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* Interested */}
            <button
              onClick={() => {
                if (!isLoggedIn) return router.push("/me");
                if (isMineListing) return;
                if (mineInterested) return;
                setInterestMsg(null);
                setShowInterest(true);
              }}
              disabled={saving || mineInterested || isMineListing || (item.status ?? "available") !== "available"}
              style={{
                background: isMineListing ? "rgba(255,255,255,0.03)" : mineInterested ? "rgba(255,255,255,0.05)" : "rgba(16,185,129,0.18)",
                border: "1px solid rgba(148,163,184,0.22)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 12,
                cursor: saving || mineInterested || isMineListing ? "not-allowed" : "pointer",
                fontWeight: 950,
                opacity: saving ? 0.8 : 1,
              }}
            >
              {isMineListing
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

            {/* Uninterested */}
            <button
              onClick={withdrawInterest}
              disabled={saving || !mineInterested || isAccepted || isReserved || isMineListing}
              style={{
                background: "transparent",
                border: "1px solid rgba(148,163,184,0.22)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 12,
                cursor: saving || !mineInterested || isAccepted || isReserved || isMineListing ? "not-allowed" : "pointer",
                fontWeight: 950,
                opacity: saving || !mineInterested || isAccepted || isReserved || isMineListing ? 0.55 : 1,
              }}
            >
              Withdraw
            </button>

            {/* Confirm pickup */}
            {isAccepted && !isMineListing && (
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

            <button
              onClick={() => router.push("/me")}
              style={{ background: "transparent", border: "1px solid rgba(148,163,184,0.22)", color: "white", padding: "10px 14px", borderRadius: 12, cursor: "pointer", fontWeight: 950 }}
            >
              Account
            </button>
          </div>

          {interestMsg && !showInterest && (
            <div style={{ marginTop: 12, opacity: 0.92, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10 }}>
              {interestMsg}
            </div>
          )}

          {/* interest modal */}
          {showInterest && (
            <div
              onClick={() => setShowInterest(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 520, borderRadius: 18, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(2,6,23,1)", padding: 16 }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 18, fontWeight: 950 }}>Request this item</div>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{ background: "transparent", border: "1px solid rgba(148,163,184,0.22)", color: "white", padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 950 }}
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
                    style={{ width: "100%", background: "black", color: "white", border: "1px solid rgba(148,163,184,0.22)", padding: "10px 12px", borderRadius: 12 }}
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
                    style={{ width: "100%", background: "black", color: "white", border: "1px solid rgba(148,163,184,0.22)", padding: "10px 12px", borderRadius: 12 }}
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

                {interestMsg && <div style={{ marginTop: 12, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10, opacity: 0.92 }}>{interestMsg}</div>}

                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{ background: "transparent", border: "1px solid rgba(148,163,184,0.22)", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer", fontWeight: 950 }}
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

          {/* fullscreen image modal */}
          {openImg && (
            <div
              onClick={() => setOpenImg(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 9999 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "min(1000px, 95vw)", maxHeight: "90vh", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.18)", borderRadius: 16, overflow: "hidden" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                  <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                  <button
                    type="button"
                    onClick={() => setOpenImg(null)}
                    style={{ background: "transparent", color: "white", border: "1px solid rgba(148,163,184,0.25)", padding: "6px 10px", borderRadius: 12, cursor: "pointer", fontWeight: 950 }}
                  >
                    ✕
                  </button>
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={openImg} alt={item.title} style={{ width: "100%", height: "auto", maxHeight: "80vh", objectFit: "contain", display: "block", background: "black" }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}