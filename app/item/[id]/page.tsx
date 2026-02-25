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

type OfferStatus = "pending" | "hold" | "accepted" | "completed" | "declined" | "withdrawn";

type OfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | string;
  availability: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  helper?: { id: string; full_name: string | null; user_role: string | null } | null;
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

function offerStatusLabel(s: string | null) {
  const k = (s ?? "pending").toLowerCase();
  if (k === "pending") return "Pending";
  if (k === "hold") return "On hold";
  if (k === "accepted") return "Accepted";
  if (k === "completed") return "Completed";
  if (k === "declined") return "Declined";
  if (k === "withdrawn") return "Withdrawn";
  return k;
}

function statusPillStyle(status: string | null): React.CSSProperties {
  const k = (status ?? "pending").toLowerCase();
  const base: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.85)",
  };

  if (k === "accepted") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.35)",
      background: "rgba(34,197,94,0.14)",
      color: "rgba(209,250,229,0.95)",
    };
  }
  if (k === "hold") {
    return {
      ...base,
      border: "1px solid rgba(59,130,246,0.35)",
      background: "rgba(59,130,246,0.14)",
      color: "rgba(191,219,254,0.95)",
    };
  }
  if (k === "completed") {
    return {
      ...base,
      border: "1px solid rgba(234,179,8,0.35)",
      background: "rgba(234,179,8,0.12)",
      color: "rgba(254,249,195,0.95)",
    };
  }
  if (k === "declined" || k === "withdrawn") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.35)",
      background: "rgba(239,68,68,0.10)",
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

  // GIVE only
  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  // REQUEST only
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [myOffer, setMyOffer] = useState<OfferRow | null>(null);

  const [saving, setSaving] = useState(false);

  // GIVE modal
  const [showInterest, setShowInterest] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // REQUEST modal
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAvailability, setOfferAvailability] = useState<"today" | "tomorrow" | "this_week" | "flexible">("today");
  const [offerNote, setOfferNote] = useState("");

  // photo modal (give only)
  const [openImg, setOpenImg] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isMinePost = useMemo(() => {
    return !!userId && !!item?.owner_id && item.owner_id === userId;
  }, [userId, item?.owner_id]);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showName = item && !item.is_anonymous && seller?.full_name;

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadOffersForRequest(loaded: ItemRow, uid: string | null) {
    if (loaded.post_type !== "request") return;

    // my offer (if logged in)
    if (uid) {
      const { data: mine } = await supabase
        .from("request_offers")
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .eq("request_id", loaded.id)
        .eq("helper_id", uid)
        .maybeSingle();

      setMyOffer((mine as any) ?? null);
    } else {
      setMyOffer(null);
    }

    // requester sees all offers
    if (uid && loaded.owner_id === uid) {
      const { data: all, error } = await supabase
        .from("request_offers")
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .eq("request_id", loaded.id)
        .order("created_at", { ascending: false });

      if (error) {
        setOffers([]);
        return;
      }

      const rows = (all as OfferRow[]) || [];
      const helperIds = Array.from(new Set(rows.map((r) => r.helper_id).filter(Boolean)));

      let profileMap = new Map<string, any>();
      if (helperIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id,full_name,user_role").in("id", helperIds);
        for (const p of (profs as any[]) || []) profileMap.set(p.id, p);
      }

      const merged = rows.map((r) => ({ ...r, helper: profileMap.get(r.helper_id) ?? null }));
      setOffers(merged);
    } else {
      setOffers([]);
    }
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
      loaded.post_type = (loaded.post_type ?? "give") as PostType;
      setItem(loaded);

      // seller/poster profile (if not anonymous)
      const ownerId = loaded.owner_id ?? null;
      const anon = !!loaded.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof } = await supabase.from("profiles").select("full_name,user_role").eq("id", ownerId).single();
        setSeller((prof as SellerProfile) || null);
      } else {
        setSeller(null);
      }

      // auth uid
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;

      if (loaded.post_type === "give") {
        const { count } = await supabase.from("interests").select("*", { count: "exact", head: true }).eq("item_id", itemId);
        setInterestCount(count ?? 0);

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

        // clear request-only state
        setOffers([]);
        setMyOffer(null);
      } else {
        // request
        setInterestCount(0);
        setMyInterest(null);
        await loadOffersForRequest(loaded, uid);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load item.");
      setItem(null);
      setSeller(null);
      setMyInterest(null);
      setOffers([]);
      setMyOffer(null);
    } finally {
      setLoading(false);
    }
  }

  // -------------------
  // GIVE FLOW (unchanged)
  // -------------------
  async function submitInterest() {
    if (!item) return;
    if (postType !== "give") return;

    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return setMsg("This is your listing.");

    setSaving(true);
    setMsg(null);

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
        const m = error.message.toLowerCase();
        if (m.includes("duplicate") || m.includes("unique")) {
          setMsg("You already sent an interest request for this item.");
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyInterest({ id: (data as any).id, status: (data as any).status ?? "pending" });
      setInterestCount((c) => c + 1);
      setMsg("✅ Request sent. Wait for seller acceptance.");
      setNote("");
      setShowInterest(false);
    } catch (e: any) {
      setMsg(e?.message || "Could not send request.");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawInterest() {
    if (!item) return;
    if (postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest?.status ?? "").toLowerCase();
    if (st === "accepted" || st === "reserved") {
      setMsg("This request is already accepted/reserved. You can’t withdraw here.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("interests").delete().eq("item_id", item.id).eq("user_id", userId);
      if (error) throw new Error(error.message);

      setMyInterest(null);
      setInterestCount((c) => Math.max(0, c - 1));
      setShowInterest(false);
      setMsg("Removed ✅");
    } catch (e: any) {
      setMsg(e?.message || "Could not remove your request.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id) return;
    if (postType !== "give") return;

    if (!isLoggedIn) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest.status ?? "").toLowerCase();
    if (st !== "accepted") return setMsg("You can confirm only after the seller accepts.");
    if (!item.owner_id) return setMsg("Missing seller id. Cannot start chat.");

    setSaving(true);
    setMsg(null);

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
      setMsg(e?.message || "Could not confirm pickup.");
    } finally {
      setSaving(false);
    }
  }

  // -------------------
  // REQUEST FLOW (new)
  // -------------------
  async function submitOffer() {
    if (!item) return;
    if (postType !== "request") return;

    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return setMsg("This is your request.");

    setSaving(true);
    setMsg(null);

    try {
      const { data, error } = await supabase
        .from("request_offers")
        .insert([
          {
            request_id: item.id,
            helper_id: userId,
            status: "pending",
            availability: offerAvailability,
            note: offerNote.trim() || null,
          },
        ])
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .single();

      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("duplicate") || m.includes("unique")) {
          setMsg("You already offered help. The requester will pick from the list.");
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyOffer(data as any);
      setShowOfferModal(false);
      setOfferNote("");
      setMsg("✅ Offer sent. You’ll be notified if accepted.");
    } catch (e: any) {
      setMsg(e?.message || "Could not send offer.");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawOffer() {
    if (!item) return;
    if (postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!myOffer?.id) return;

    const st = (myOffer.status ?? "").toLowerCase();
    if (st === "accepted" || st === "completed") {
      setMsg("You can’t withdraw after being accepted/completed.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("request_offers").delete().eq("id", myOffer.id).eq("helper_id", userId);
      if (error) throw new Error(error.message);

      setMyOffer(null);
      setMsg("Removed ✅");
      await loadItem();
    } catch (e: any) {
      setMsg(e?.message || "Could not withdraw.");
    } finally {
      setSaving(false);
    }
  }

  async function acceptOfferAsRequester(offer: OfferRow) {
    if (!item) return;
    if (postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("accept_request_offer_keep_others", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadItem();
      setMsg("✅ Accepted. You can now chat with this helper.");
    } catch (e: any) {
      setMsg(e?.message || "Could not accept offer.");
    } finally {
      setSaving(false);
    }
  }

  async function setOfferStatusAsRequester(offer: OfferRow, status: OfferStatus) {
    if (!item) return;
    if (postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("request_offers").update({ status }).eq("id", offer.id);
      if (error) throw new Error(error.message);

      await loadItem();
    } catch (e: any) {
      setMsg(e?.message || "Could not update offer.");
    } finally {
      setSaving(false);
    }
  }

  async function completeOfferAsRequester(offer: OfferRow) {
    if (!item) return;
    if (postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("complete_request_offer", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadItem();
      setMsg("✅ Marked completed.");
    } catch (e: any) {
      setMsg(e?.message || "Could not complete.");
    } finally {
      setSaving(false);
    }
  }

  async function openChatForOffer(offer: OfferRow) {
    if (!item) return;
    if (postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");

    // requester can open chat with accepted helper; helper can open chat only if their offer accepted
    const st = (offer.status ?? "").toLowerCase();
    if (st !== "accepted" && st !== "completed") {
      setMsg("Chat unlocks only after acceptance.");
      return;
    }

    if (!item.owner_id) return setMsg("Missing requester id.");

    setSaving(true);
    setMsg(null);

    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id, // request poster
        requesterId: offer.helper_id, // helper
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Chat opened for an accepted offer. Coordinate details here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setMsg(e?.message || "Could not open chat.");
    } finally {
      setSaving(false);
    }
  }

  // initial load + auth
  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadItem();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadItem();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // realtime (give interests)
  useEffect(() => {
    if (!itemId || !userId) return;
    if (postType !== "give") return;

    const channel = supabase
      .channel(`interest-${itemId}-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interests", filter: `item_id=eq.${itemId}` },
        (payload) => {
          const row: any = payload.new;
          if (row?.user_id === userId) setMyInterest({ id: row.id, status: row.status ?? null });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId, postType]);

  // realtime (request offers)
  useEffect(() => {
    if (!itemId || !userId) return;
    if (postType !== "request") return;

    const channel = supabase
      .channel(`offers-${itemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "request_offers", filter: `request_id=eq.${itemId}` },
        () => {
          // simplest + safest: reload (small volume)
          loadItem();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId, postType]);

  // esc closes image
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // derived give status
  const myInterestStatus = (myInterest?.status ?? "").toLowerCase();
  const mineInterested = !!myInterest?.id;
  const isAccepted = myInterestStatus === "accepted";
  const isReserved = myInterestStatus === "reserved";

  // derived request status
  const myOfferStatus = (myOffer?.status ?? "").toLowerCase();
  const myOfferAccepted = myOfferStatus === "accepted" || myOfferStatus === "completed";

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

          {/* media / request hero */}
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
                <div style={{ marginTop: 10, opacity: 0.85, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {item.description || "No extra details provided."}
                </div>
              </div>
            )}
          </div>

          {/* give description */}
          {postType === "give" && (
            <div style={{ marginTop: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 16, padding: 14 }}>
              <div style={{ fontWeight: 950, marginBottom: 8 }}>Description</div>
              <div style={{ opacity: 0.9, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {item.description && item.description.trim().toLowerCase() !== "until i cancel" ? item.description : "—"}
              </div>
            </div>
          )}

          {/* REQUEST: offers panel for requester */}
          {postType === "request" && isMinePost && (
            <div style={{ marginTop: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 16, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontWeight: 950 }}>Offers</div>
                <div style={{ opacity: 0.7, fontSize: 13, fontWeight: 900 }}>{offers.length} total</div>
              </div>

              {offers.length === 0 ? (
                <div style={{ marginTop: 10, opacity: 0.75 }}>No offers yet.</div>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {offers.map((o) => {
                    const st = (o.status ?? "pending").toLowerCase();
                    const helperName = o.helper?.full_name || "Ashland user";
                    const helperRole = o.helper?.user_role ? ` (${o.helper.user_role})` : "";

                    return (
                      <div
                        key={o.id}
                        style={{
                          border: "1px solid rgba(148,163,184,0.18)",
                          borderRadius: 14,
                          padding: 12,
                          background: "rgba(0,0,0,0.22)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 950 }}>
                            {helperName}
                            {helperRole}
                          </div>
                          <span style={statusPillStyle(o.status)}>{offerStatusLabel(o.status)}</span>
                        </div>

                        <div style={{ marginTop: 8, opacity: 0.85, fontSize: 13 }}>
                          {o.availability ? `Availability: ${o.availability}` : "Availability: —"}
                        </div>

                        {o.note ? (
                          <div style={{ marginTop: 8, opacity: 0.85, whiteSpace: "pre-wrap" }}>{o.note}</div>
                        ) : (
                          <div style={{ marginTop: 8, opacity: 0.6 }}>No note.</div>
                        )}

                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {(st === "pending" || st === "hold") && (
                            <button
                              onClick={() => acceptOfferAsRequester(o)}
                              disabled={saving}
                              style={{
                                background: "rgba(34,197,94,0.18)",
                                border: "1px solid rgba(34,197,94,0.30)",
                                color: "white",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Accept
                            </button>
                          )}

                          {st === "pending" && (
                            <button
                              onClick={() => setOfferStatusAsRequester(o, "hold")}
                              disabled={saving}
                              style={{
                                background: "rgba(59,130,246,0.12)",
                                border: "1px solid rgba(59,130,246,0.25)",
                                color: "white",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Put on hold
                            </button>
                          )}

                          {st === "hold" && (
                            <button
                              onClick={() => setOfferStatusAsRequester(o, "pending")}
                              disabled={saving}
                              style={{
                                background: "transparent",
                                border: "1px solid rgba(148,163,184,0.22)",
                                color: "white",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Move to pending
                            </button>
                          )}

                          {(st === "accepted" || st === "completed") && (
                            <button
                              onClick={() => openChatForOffer(o)}
                              disabled={saving}
                              style={{
                                background: "rgba(16,185,129,0.22)",
                                border: "1px solid rgba(16,185,129,0.30)",
                                color: "white",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Open chat
                            </button>
                          )}

                          {st === "accepted" && (
                            <button
                              onClick={() => completeOfferAsRequester(o)}
                              disabled={saving}
                              style={{
                                background: "rgba(234,179,8,0.14)",
                                border: "1px solid rgba(234,179,8,0.25)",
                                color: "white",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Mark completed
                            </button>
                          )}

                          {(st === "pending" || st === "hold") && (
                            <button
                              onClick={() => setOfferStatusAsRequester(o, "declined")}
                              disabled={saving}
                              style={{
                                background: "transparent",
                                border: "1px solid rgba(248,113,113,0.30)",
                                color: "rgba(254,202,202,0.95)",
                                padding: "10px 12px",
                                borderRadius: 12,
                                cursor: saving ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: saving ? 0.75 : 1,
                              }}
                            >
                              Decline
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                    setMsg(null);
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
                {!isMinePost && (
                  <>
                    <button
                      onClick={() => {
                        if (!isLoggedIn) return router.push("/me");
                        if (myOffer?.id) return;
                        setMsg(null);
                        setShowOfferModal(true);
                      }}
                      disabled={saving || !!myOffer?.id}
                      style={{
                        background: !!myOffer?.id ? "rgba(255,255,255,0.05)" : "rgba(34,197,94,0.18)",
                        border: "1px solid rgba(34,197,94,0.30)",
                        color: "white",
                        padding: "10px 14px",
                        borderRadius: 12,
                        cursor: saving || !!myOffer?.id ? "not-allowed" : "pointer",
                        fontWeight: 950,
                        opacity: saving ? 0.8 : 1,
                      }}
                    >
                      {!isLoggedIn ? "Offer help (login required)" : myOffer?.id ? `Offer sent • ${offerStatusLabel(myOffer.status)}` : "Offer help"}
                    </button>

                    {myOffer?.id && (
                      <>
                        {myOfferAccepted ? (
                          <button
                            onClick={() => openChatForOffer(myOffer)}
                            disabled={saving}
                            style={{
                              background: "rgba(16,185,129,0.22)",
                              border: "1px solid rgba(16,185,129,0.30)",
                              color: "white",
                              padding: "10px 14px",
                              borderRadius: 12,
                              cursor: saving ? "not-allowed" : "pointer",
                              fontWeight: 950,
                              opacity: saving ? 0.8 : 1,
                            }}
                          >
                            Start chat
                          </button>
                        ) : (
                          <button
                            onClick={withdrawOffer}
                            disabled={saving}
                            style={{
                              background: "transparent",
                              border: "1px solid rgba(148,163,184,0.22)",
                              color: "white",
                              padding: "10px 14px",
                              borderRadius: 12,
                              cursor: saving ? "not-allowed" : "pointer",
                              fontWeight: 950,
                              opacity: saving ? 0.8 : 1,
                            }}
                          >
                            Withdraw offer
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {isMinePost && (
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
                )}
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

          {msg && !showInterest && !showOfferModal && (
            <div style={{ marginTop: 12, opacity: 0.92, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10 }}>
              {msg}
            </div>
          )}

          {/* GIVE: interest modal */}
          {postType === "give" && showInterest && (
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
                    style={{ width: "100%", minHeight: 90, background: "black", color: "white", border: "1px solid rgba(148,163,184,0.22)", padding: "10px 12px", borderRadius: 12, resize: "vertical" }}
                  />
                </div>

                {msg && <div style={{ marginTop: 12, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10, opacity: 0.92 }}>{msg}</div>}

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
                    style={{ background: "rgba(16,185,129,0.22)", border: "1px solid rgba(16,185,129,0.35)", color: "white", padding: "10px 12px", borderRadius: 12, cursor: saving ? "not-allowed" : "pointer", fontWeight: 950, opacity: saving ? 0.8 : 1 }}
                  >
                    {saving ? "Sending..." : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* REQUEST: offer modal */}
          {postType === "request" && showOfferModal && (
            <div
              onClick={() => setShowOfferModal(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 520, borderRadius: 18, border: "1px solid rgba(34,197,94,0.22)", background: "rgba(2,6,23,1)", padding: 16 }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 18, fontWeight: 950 }}>Offer help</div>
                  <button
                    onClick={() => setShowOfferModal(false)}
                    style={{ background: "transparent", border: "1px solid rgba(148,163,184,0.22)", color: "white", padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 950 }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ marginTop: 12, opacity: 0.85 }}>
                  Your offer will appear in the requester’s list. Chat unlocks only after you’re accepted.
                </div>

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Availability</label>
                  <select
                    value={offerAvailability}
                    onChange={(e) => setOfferAvailability(e.target.value as any)}
                    style={{ width: "100%", background: "black", color: "white", border: "1px solid rgba(148,163,184,0.22)", padding: "10px 12px", borderRadius: 12 }}
                  >
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="this_week">This week</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontWeight: 900, marginBottom: 6 }}>Optional note</label>
                  <textarea
                    value={offerNote}
                    onChange={(e) => setOfferNote(e.target.value)}
                    placeholder="Example: I can drive after 5pm. I have room for 2 bags."
                    style={{ width: "100%", minHeight: 90, background: "black", color: "white", border: "1px solid rgba(148,163,184,0.22)", padding: "10px 12px", borderRadius: 12, resize: "vertical" }}
                  />
                </div>

                {msg && <div style={{ marginTop: 12, border: "1px solid rgba(148,163,184,0.22)", borderRadius: 12, padding: 10, opacity: 0.92 }}>{msg}</div>}

                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowOfferModal(false)}
                    style={{ background: "transparent", border: "1px solid rgba(148,163,184,0.22)", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer", fontWeight: 950 }}
                  >
                    Cancel
                  </button>

                  <button
                    onClick={submitOffer}
                    disabled={saving}
                    style={{ background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.30)", color: "white", padding: "10px 12px", borderRadius: 12, cursor: saving ? "not-allowed" : "pointer", fontWeight: 950, opacity: saving ? 0.8 : 1 }}
                  >
                    {saving ? "Sending..." : "Send offer"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* fullscreen image modal (give only) */}
          {postType === "give" && openImg && (
            <div onClick={() => setOpenImg(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 9999 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1000px, 95vw)", maxHeight: "90vh", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.18)", borderRadius: 16, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                  <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                  <button type="button" onClick={() => setOpenImg(null)} style={{ background: "transparent", color: "white", border: "1px solid rgba(148,163,184,0.25)", padding: "6px 10px", borderRadius: 12, cursor: "pointer", fontWeight: 950 }}>
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