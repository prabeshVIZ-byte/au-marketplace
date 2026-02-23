// /app/item/[id]/page.tsx
"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

  // ✅ keep full interest state, not just boolean
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);
  const mineInterested = !!myInterest?.id;

  const [saving, setSaving] = useState(false);

  // interest modal state
  const [showInterest, setShowInterest] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [note, setNote] = useState("");
  const [interestMsg, setInterestMsg] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

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

      // my interest row (id + status)
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;

      if (uid) {
        const { data: mine, error: mineErr } = await supabase
          .from("interests")
          .select("id,status")
          .eq("item_id", itemId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!mineErr && mine) {
          setMyInterest({ id: (mine as any).id, status: (mine as any).status ?? null });
        } else {
          setMyInterest(null);
        }
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
          // try to refresh myInterest
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyInterest({ id: (data as any).id, status: (data as any).status ?? "pending" });
      setInterestCount((c) => c + 1);
      setInterestMsg("✅ Interest sent! Check Account page for updates.");
      setNote("");
    } catch (e: any) {
      setInterestMsg(e?.message || "Could not send interest.");
    } finally {
      setSaving(false);
    }
  }

  // ✅ NEW: withdraw interest (Uninterested)
  async function withdrawInterest() {
    if (!item) return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    // if accepted, don't allow withdraw (keep your logic strict)
    const st = (myInterest?.status ?? "").toLowerCase();
    if (st === "accepted") {
      setInterestMsg("This request was accepted. You can’t withdraw here.");
      return;
    }

    setSaving(true);
    setInterestMsg(null);

    try {
      const { error } = await supabase
        .from("interests")
        .delete()
        .eq("item_id", item.id)
        .eq("user_id", userId);

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

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showSellerName = item && !item.is_anonymous && seller?.full_name;

  const myStatus = (myInterest?.status ?? "").toLowerCase();
  const isAccepted = myStatus === "accepted";
  const isPending = myStatus === "pending" || (mineInterested && !myStatus);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <button
        onClick={() => router.push("/feed")}
        style={{
          marginBottom: 16,
          background: "transparent",
          color: "white",
          border: "1px solid #333",
          padding: "8px 12px",
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        ← Back to feed
      </button>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.85 }}>Loading…</p>}

      {!loading && item && (
        <div style={{ maxWidth: 820 }}>
          <h1 style={{ fontSize: 34, fontWeight: 900, margin: 0 }}>{item.title}</h1>

          <div style={{ marginTop: 10, opacity: 0.9 }}>
            {item.category && (
              <div style={{ marginTop: 6 }}>
                Category: <b>{item.category}</b>
              </div>
            )}

            {item.pickup_location && (
              <div style={{ marginTop: 6 }}>
                Pickup location: <b>{item.pickup_location}</b>
              </div>
            )}

            <div style={{ opacity: 0.85, marginTop: 10 }}>
              {item.expires_at ? `Available until: ${new Date(item.expires_at).toLocaleString()}` : "Contributor will de-list themselves"}
              {"  "}
              <span style={{ opacity: 0.75 }}>({expiryText})</span>
            </div>

            <div style={{ marginTop: 6 }}>
              Seller: <b>{item.is_anonymous ? "Anonymous" : showSellerName ? seller!.full_name : "Ashland user"}</b>
              {!item.is_anonymous && seller?.user_role ? <span style={{ opacity: 0.8 }}> ({seller.user_role})</span> : null}
            </div>

            <div style={{ marginTop: 6 }}>
              Interested: <b>{interestCount}</b>
            </div>
          </div>

          {item.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.photo_url}
              alt={item.title}
              style={{
                marginTop: 14,
                width: "100%",
                maxWidth: 820,
                height: 420,
                objectFit: "cover",
                borderRadius: 14,
                border: "1px solid #0f223f",
              }}
            />
          ) : (
            <div
              style={{
                marginTop: 14,
                width: "100%",
                maxWidth: 820,
                height: 240,
                borderRadius: 14,
                border: "1px dashed #334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
              }}
            >
              No photo
            </div>
          )}

          <div style={{ marginTop: 14, background: "#0b1730", border: "1px solid #0f223f", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Description</div>
            <div style={{ opacity: 0.9, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {item.description && item.description.trim().toLowerCase() !== "until i cancel" ? item.description : "—"}
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* Primary Interest action */}
            <button
              onClick={() => {
                if (!isLoggedIn) {
                  router.push("/me");
                  return;
                }

                // if already interested -> allow withdraw (Uninterested) with separate button below
                if (mineInterested) return;

                setInterestMsg(null);
                setShowInterest(true);
              }}
              disabled={saving || mineInterested || (item.status ?? "available") !== "available"}
              style={{
                background:
                  !isLoggedIn
                    ? "transparent"
                    : mineInterested
                    ? "#1f2937"
                    : (item.status ?? "available") === "available"
                    ? "#052e16"
                    : "#111827",
                border: "1px solid #334155",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                cursor: saving ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: saving ? 0.75 : 1,
              }}
              title={
                !isLoggedIn
                  ? "Login required"
                  : mineInterested
                  ? "You already sent a request"
                  : (item.status ?? "available") !== "available"
                  ? "Not available"
                  : "Send a pickup-ready request"
              }
            >
              {!isLoggedIn ? "Interested (login required)" : mineInterested ? isAccepted ? "Accepted ✅" : "Request sent" : "Interested"}
            </button>

            {/* ✅ NEW: Uninterested button on item page */}
            <button
              onClick={withdrawInterest}
              disabled={saving || !mineInterested || isAccepted}
              title={!mineInterested ? "No request to remove" : isAccepted ? "Accepted request cannot be withdrawn here" : "Remove your request"}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                cursor: saving || !mineInterested || isAccepted ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: saving || !mineInterested || isAccepted ? 0.55 : 1,
              }}
            >
              Uninterested
            </button>

            <button
              onClick={() => router.push("/me")}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Account
            </button>
          </div>

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
                  border: "1px solid #334155",
                  background: "#020617",
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>Request this item</div>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid #334155",
                      color: "white",
                      padding: "6px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ marginTop: 12, opacity: 0.85 }}>
                  Tell the lister when you can pick up. This helps them choose someone who will actually show up.
                </div>

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontWeight: 800, marginBottom: 6 }}>Earliest pickup</label>
                  <select
                    value={earliestPickup}
                    onChange={(e) => setEarliestPickup(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "black",
                      color: "white",
                      border: "1px solid #334155",
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
                  <label style={{ display: "block", fontWeight: 800, marginBottom: 6 }}>Time window</label>
                  <select
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value as any)}
                    style={{
                      width: "100%",
                      background: "black",
                      color: "white",
                      border: "1px solid #334155",
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
                  <label style={{ display: "block", fontWeight: 800, marginBottom: 6 }}>Optional note</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Example: I can meet at the library after 3pm."
                    style={{
                      width: "100%",
                      minHeight: 90,
                      background: "black",
                      color: "white",
                      border: "1px solid #334155",
                      padding: "10px 12px",
                      borderRadius: 12,
                      resize: "vertical",
                    }}
                  />
                </div>

                {interestMsg && (
                  <div style={{ marginTop: 12, border: "1px solid #334155", borderRadius: 12, padding: 10, opacity: 0.9 }}>
                    {interestMsg}
                  </div>
                )}

                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowInterest(false)}
                    style={{
                      background: "transparent",
                      border: "1px solid #334155",
                      color: "white",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={submitInterest}
                    disabled={saving}
                    style={{
                      background: "#052e16",
                      border: "1px solid #14532d",
                      color: "white",
                      padding: "10px 12px",
                      borderRadius: 12,
                      cursor: saving ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      opacity: saving ? 0.75 : 1,
                    }}
                  >
                    {saving ? "Sending..." : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Inline status (optional) */}
          {interestMsg && !showInterest && (
            <div style={{ marginTop: 12, opacity: 0.9, border: "1px solid #334155", borderRadius: 12, padding: 10 }}>
              {interestMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}