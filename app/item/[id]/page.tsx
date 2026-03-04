"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  // give
  category: string | null;
  pickup_location: string | null;

  // request
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

type OwnerProfile = { full_name: string | null; user_role: string | null };

type MyInterestRow = { id: string; status: string | null };

type OfferStatus = "pending" | "hold" | "accepted" | "completed" | "declined" | "withdrawn";

type OfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | string | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  helper?: { full_name: string | null; user_role: string | null } | null;
};

const APP_NAV_HEIGHT_PX = 86; // 👈 set this to match your global bottom nav height
const ACTION_BAR_HEIGHT_PX = 78; // our sticky CTA bar height (approx)

function isAshlandEmail(email: string | null) {
  return !!email && email.toLowerCase().endsWith("@ashland.edu");
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until delisted";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Until delisted";

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
function statusTone(status: string | null) {
  const k = (status ?? "pending").toLowerCase();
  if (k === "accepted") return "toneGreen";
  if (k === "hold") return "toneBlue";
  if (k === "completed") return "toneAmber";
  if (k === "declined" || k === "withdrawn") return "toneRed";
  return "toneGray";
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  // auth (single source of truth)
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const isLoggedIn = useMemo(() => !!userId && isAshlandEmail(userEmail), [userId, userEmail]);

  // loading/error
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // item
  const [item, setItem] = useState<ItemRow | null>(null);
  const [owner, setOwner] = useState<OwnerProfile | null>(null);

  // give
  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  // request
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [myOffer, setMyOffer] = useState<OfferRow | null>(null);

  // ui
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<any>(null);

  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    actionLabel: string;
    danger?: boolean;
    onYes: () => Promise<void>;
  }>(null);

  // give modal
  const [showInterestModal, setShowInterestModal] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [interestNote, setInterestNote] = useState("");

  // request modal
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAvailability, setOfferAvailability] = useState<"today" | "tomorrow" | "this_week" | "flexible">("today");
  const [offerNote, setOfferNote] = useState("");

  // image modal
  const [openImg, setOpenImg] = useState<string | null>(null);

  const postType: PostType = (item?.post_type ?? "give") as PostType;
  const isMinePost = useMemo(() => !!userId && !!item?.owner_id && item.owner_id === userId, [userId, item?.owner_id]);
  const expiryText = formatExpiry(item?.expires_at ?? null);

  // derived
  const myInterestStatus = (myInterest?.status ?? "").toLowerCase();
  const mineInterested = !!myInterest?.id;
  const interestAccepted = myInterestStatus === "accepted";
  const interestReserved = myInterestStatus === "reserved";

  const myOfferStatus = (myOffer?.status ?? "").toLowerCase();
  const myOfferAccepted = myOfferStatus === "accepted" || myOfferStatus === "completed";

  const loadSeq = useRef(0);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  async function loadEverything(uid: string | null, email: string | null) {
    if (!itemId) return;

    const seq = ++loadSeq.current;
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

      if (seq !== loadSeq.current) return;
      if (itErr) throw new Error(itErr.message);

      const loaded = it as ItemRow;
      loaded.post_type = (loaded.post_type ?? "give") as PostType;
      setItem(loaded);

      // owner profile only if not anonymous
      if (!loaded.is_anonymous && loaded.owner_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", loaded.owner_id)
          .maybeSingle();
        if (seq !== loadSeq.current) return;
        setOwner((prof as OwnerProfile) ?? null);
      } else {
        setOwner(null);
      }

      // branch
      if (loaded.post_type === "give") {
        setOffers([]);
        setMyOffer(null);

        const { count } = await supabase
          .from("interests")
          .select("*", { count: "exact", head: true })
          .eq("item_id", itemId);

        if (seq !== loadSeq.current) return;
        setInterestCount(count ?? 0);

        if (uid && isAshlandEmail(email)) {
          const { data: mine } = await supabase
            .from("interests")
            .select("id,status")
            .eq("item_id", itemId)
            .eq("user_id", uid)
            .maybeSingle();

          if (seq !== loadSeq.current) return;
          setMyInterest(mine ? { id: (mine as any).id, status: (mine as any).status ?? null } : null);
        } else {
          setMyInterest(null);
        }
      } else {
        setInterestCount(0);
        setMyInterest(null);

        if (uid && isAshlandEmail(email)) {
          const { data: mine } = await supabase
            .from("request_offers")
            .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
            .eq("request_id", loaded.id)
            .eq("helper_id", uid)
            .maybeSingle();

          if (seq !== loadSeq.current) return;
          setMyOffer((mine as any) ?? null);
        } else {
          setMyOffer(null);
        }

        if (uid && loaded.owner_id === uid) {
          // If this FK name breaks, see note below.
          const { data: all, error } = await supabase
            .from("request_offers")
            .select(
              `
              id,request_id,helper_id,status,availability,note,created_at,updated_at,
              helper:profiles!request_offers_helper_id_fkey(full_name,user_role)
            `
            )
            .eq("request_id", loaded.id)
            .order("created_at", { ascending: false });

          if (seq !== loadSeq.current) return;
          setOffers(error ? [] : (((all as any[]) ?? []) as OfferRow[]));
        } else {
          setOffers([]);
        }
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setErr(e?.message || "Failed to load.");
      setItem(null);
      setOwner(null);
      setInterestCount(0);
      setMyInterest(null);
      setOffers([]);
      setMyOffer(null);
    } finally {
      if (seq !== loadSeq.current) return;
      setLoading(false);
    }
  }

  // ---------- Actions ----------
  async function submitInterest() {
    if (!item || postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return showToast("This is your listing.", "err");
    if (mineInterested) return showToast("You already requested this item.", "err");

    setBusy(true);
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
            note: interestNote.trim() || null,
          },
        ])
        .select("id,status")
        .single();

      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("duplicate") || m.includes("unique")) {
          showToast("You already requested this item.", "err");
          await loadEverything(userId, userEmail);
          return;
        }
        throw new Error(error.message);
      }

      setMyInterest({ id: (data as any).id, status: (data as any).status ?? "pending" });
      setInterestCount((c) => c + 1);
      setInterestNote("");
      setShowInterestModal(false);
      showToast("Request sent ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not send request.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawInterest() {
    if (!item || postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest?.status ?? "").toLowerCase();
    if (st === "accepted" || st === "reserved") {
      showToast("Already accepted/reserved. You can’t withdraw here.", "err");
      return;
    }

    setConfirm({
      title: "Withdraw request?",
      body: "This removes your request from the lister’s list.",
      actionLabel: "Withdraw",
      danger: true,
      onYes: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          const { error } = await supabase.from("interests").delete().eq("item_id", item.id).eq("user_id", userId);
          if (error) throw new Error(error.message);
          setMyInterest(null);
          setInterestCount((c) => Math.max(0, c - 1));
          setShowInterestModal(false);
          showToast("Removed ✅", "ok");
        } catch (e: any) {
          showToast(e?.message || "Could not remove.", "err");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id || postType !== "give") return;
    if (!isLoggedIn) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest.status ?? "").toLowerCase();
    if (st !== "accepted") return showToast("Confirm only after the lister accepts.", "err");
    if (!item.owner_id) return showToast("Missing lister id.", "err");

    setBusy(true);
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
        body: "✅ Buyer confirmed pickup. Coordinate a time and place here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(e?.message || "Could not confirm pickup.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitOffer() {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return showToast("This is your request.", "err");
    if (myOffer?.id) return showToast("You already offered help.", "err");

    setBusy(true);
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
          showToast("You already offered help.", "err");
          await loadEverything(userId, userEmail);
          return;
        }
        throw new Error(error.message);
      }

      setMyOffer(data as any);
      setShowOfferModal(false);
      setOfferNote("");
      showToast("Offer sent ✅", "ok");
      await loadEverything(userId, userEmail);
    } catch (e: any) {
      showToast(e?.message || "Could not send offer.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawOffer() {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!myOffer?.id) return;

    const st = (myOffer.status ?? "").toLowerCase();
    if (st === "accepted" || st === "completed") {
      showToast("You can’t withdraw after acceptance.", "err");
      return;
    }

    setConfirm({
      title: "Withdraw offer?",
      body: "This removes your offer from the requester’s list.",
      actionLabel: "Withdraw",
      danger: true,
      onYes: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          const { error } = await supabase.from("request_offers").delete().eq("id", myOffer.id).eq("helper_id", userId);
          if (error) throw new Error(error.message);
          setMyOffer(null);
          showToast("Removed ✅", "ok");
          await loadEverything(userId, userEmail);
        } catch (e: any) {
          showToast(e?.message || "Could not withdraw.", "err");
        } finally {
          setBusy(false);
        }
      },
    });
  }

  async function acceptOfferAsRequester(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc("accept_request_offer_keep_others", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);
      await loadEverything(userId, userEmail);
      showToast("Accepted ✅ Chat unlocked.", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not accept.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function setOfferStatusAsRequester(offer: OfferRow, status: OfferStatus) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setBusy(true);
    try {
      const { error } = await supabase.from("request_offers").update({ status }).eq("id", offer.id);
      if (error) throw new Error(error.message);
      await loadEverything(userId, userEmail);
      showToast("Updated ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not update.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function completeOfferAsRequester(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc("complete_request_offer", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);
      await loadEverything(userId, userEmail);
      showToast("Marked completed ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not complete.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function openChatForOffer(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");

    const st = (offer.status ?? "").toLowerCase();
    if (st !== "accepted" && st !== "completed") {
      showToast("Chat unlocks only after acceptance.", "err");
      return;
    }
    if (!item.owner_id) return showToast("Missing requester id.", "err");

    setBusy(true);
    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: offer.helper_id,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Chat opened for an accepted offer. Coordinate details here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(e?.message || "Could not open chat.", "err");
    } finally {
      setBusy(false);
    }
  }

  // -------- Boot: single session + auth listener --------
  useEffect(() => {
    if (!itemId) return;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      const uid = s?.user?.id ?? null;
      const email = s?.user?.email ?? null;
      setUserId(uid);
      setUserEmail(email);
      await loadEverything(uid, email);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
      setUserId(uid);
      setUserEmail(email);
      await loadEverything(uid, email);
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // esc closes modals
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenImg(null);
        setShowInterestModal(false);
        setShowOfferModal(false);
        setConfirm(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const headerSubtitle = useMemo(() => {
    if (!item) return "";
    if (postType === "request") {
      const parts = [
        requestGroupLabel(item.request_group),
        item.request_timeframe ? requestTimeframeLabel(item.request_timeframe) : "",
        item.request_location ? item.request_location : "",
      ].filter(Boolean);
      return parts.join(" • ");
    }
    const parts = [item.category ? `Category: ${item.category}` : "", item.pickup_location ? `Pickup: ${item.pickup_location}` : ""].filter(Boolean);
    return parts.join(" • ");
  }, [item, postType]);

  const ownerLabel = useMemo(() => {
    if (!item) return "Ashland user";
    if (item.is_anonymous) return "Anonymous";
    const nm = (owner?.full_name ?? "").trim();
    return nm ? nm : "Ashland user";
  }, [item, owner]);

  const ownerRole = useMemo(() => {
    if (!item || item.is_anonymous) return "";
    return (owner?.user_role ?? "").trim();
  }, [item, owner]);

  const primaryCTA = useMemo(() => {
    if (!item) return { label: "Loading…", disabled: true, onClick: () => {} };
    const itemStatus = (item.status ?? "available").toLowerCase();

    if (postType === "give") {
      if (isMinePost) return { label: "Your listing", disabled: true, onClick: () => {} };
      if (!isLoggedIn) return { label: "Request (login)", disabled: false, onClick: () => router.push("/me") };
      if (mineInterested) {
        if (interestReserved) return { label: "Reserved ✅", disabled: true, onClick: () => {} };
        if (interestAccepted) return { label: "Accepted ✅", disabled: true, onClick: () => {} };
        return { label: "Request sent", disabled: true, onClick: () => {} };
      }
      if (itemStatus !== "available") return { label: "Unavailable", disabled: true, onClick: () => {} };
      return { label: "Request item", disabled: false, onClick: () => setShowInterestModal(true) };
    }

    // request
    if (isMinePost) return { label: "View offers below", disabled: true, onClick: () => {} };
    if (!isLoggedIn) return { label: "Offer help (login)", disabled: false, onClick: () => router.push("/me") };
    if (myOffer?.id) return { label: `Offer sent • ${offerStatusLabel(myOffer.status ?? "pending")}`, disabled: true, onClick: () => {} };
    return { label: "Offer help", disabled: false, onClick: () => setShowOfferModal(true) };
  }, [
    item,
    postType,
    isMinePost,
    isLoggedIn,
    mineInterested,
    interestReserved,
    interestAccepted,
    router,
    myOffer,
  ]);

  // ✅ This is the key: action bar sits ABOVE your global nav
  const bottomOffset = `calc(${APP_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 10px)`;

  // ✅ This is the key: page gets enough bottom padding for BOTH bars
  const pageBottomPad = `calc(${APP_NAV_HEIGHT_PX}px + ${ACTION_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom) + 20px)`;

  return (
    <div className="page" style={{ paddingBottom: pageBottomPad as any }}>
      <header className="top">
        <button className="navBtn" onClick={() => router.back()} aria-label="Back">
          ←
        </button>

        <div className="brand">
          <div className="brandTitle">ScholarSwap</div>
          <div className="brandSub">Exchange • Help • Reuse</div>
        </div>

        {/* Desktop-only quick buttons (mobile already has bottom nav) */}
        <div className="navRight">
          <button className="navChip" onClick={() => router.push("/feed")}>
            Feed
          </button>
          <button className="navChip" onClick={() => router.push("/me")}>
            Account
          </button>
        </div>
      </header>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="alert">Loading…</div>}

      {!loading && item && (
        <main className="wrap">
          <div className="titleRow">
            <div className="titleLeft">
              <h1 className="h1">{item.title}</h1>
              {headerSubtitle ? <div className="sub">{headerSubtitle}</div> : null}

              <div className="metaLine">
                <span className="metaKey">{postType === "give" ? "Lister" : "Poster"}:</span>{" "}
                <span className="metaVal">
                  {ownerLabel}
                  {ownerRole ? <span className="muted"> ({ownerRole})</span> : null}
                </span>

                {postType === "give" ? (
                  <>
                    <span className="dot">•</span>
                    <span className="metaVal">{interestCount} requests</span>
                  </>
                ) : null}

                <span className="dot">•</span>
                <span className="metaVal">
                  Auto-archives: {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : "—"}{" "}
                  <span className="muted">({expiryText})</span>
                </span>
              </div>
            </div>

            <span className={`typePill ${postType === "request" ? "req" : "give"}`}>
              {postType === "request" ? "REQUEST" : "ITEM"}
            </span>
          </div>

          <section className="hero">
            {postType === "give" ? (
              item.photo_url ? (
                <button className="heroMediaBtn" onClick={() => setOpenImg(item.photo_url!)} type="button" aria-label="Open photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.photo_url} alt={item.title} className="heroImg" />
                </button>
              ) : (
                <div className="heroEmpty">No photo</div>
              )
            ) : (
              <div className="heroReq">
                <div className="heroReqLine">{headerSubtitle || "Request details"}</div>
                <div className="heroReqBody">{item.description?.trim() ? item.description : "No extra details provided."}</div>
              </div>
            )}
          </section>

          {postType === "give" ? (
            <section className="panel">
              <div className="panelTitle">Description</div>
              <div className="panelBody">{item.description?.trim() ? item.description : "—"}</div>
            </section>
          ) : null}

          {/* REQUEST: offers list */}
          {postType === "request" && isMinePost ? (
            <section className="panel">
              <div className="panelTop">
                <div className="panelTitle">Offers</div>
                <div className="smallMuted">{offers.length} total</div>
              </div>

              {offers.length === 0 ? (
                <div className="smallMuted">No offers yet.</div>
              ) : (
                <div className="offerList">
                  {offers.map((o) => {
                    const st = (o.status ?? "pending").toLowerCase();
                    const helperName = o.helper?.full_name?.trim() ? o.helper.full_name : "Ashland user";
                    const helperRole = o.helper?.user_role ? ` (${o.helper.user_role})` : "";
                    const tone = statusTone(o.status ?? "pending");

                    return (
                      <div key={o.id} className="offerCard">
                        <div className="offerTop">
                          <div className="offerName">
                            {helperName}
                            <span className="muted">{helperRole}</span>
                          </div>
                          <span className={`pill ${tone}`}>{offerStatusLabel(o.status)}</span>
                        </div>

                        <div className="offerMeta">{o.availability ? `Availability: ${o.availability}` : "Availability: —"}</div>
                        <div className="offerNote">{o.note ? o.note : <span className="muted">No note.</span>}</div>

                        <div className="offerActions">
                          {(st === "pending" || st === "hold") && (
                            <button className="btn primary" onClick={() => acceptOfferAsRequester(o)} disabled={busy}>
                              Accept
                            </button>
                          )}
                          {st === "pending" && (
                            <button className="btn softBlue" onClick={() => setOfferStatusAsRequester(o, "hold")} disabled={busy}>
                              Hold
                            </button>
                          )}
                          {st === "hold" && (
                            <button className="btn ghost" onClick={() => setOfferStatusAsRequester(o, "pending")} disabled={busy}>
                              Move to pending
                            </button>
                          )}
                          {(st === "accepted" || st === "completed") && (
                            <button className="btn softGreen" onClick={() => openChatForOffer(o)} disabled={busy}>
                              Open chat
                            </button>
                          )}
                          {st === "accepted" && (
                            <button className="btn softAmber" onClick={() => completeOfferAsRequester(o)} disabled={busy}>
                              Mark completed
                            </button>
                          )}
                          {(st === "pending" || st === "hold") && (
                            <button className="btn danger" onClick={() => setOfferStatusAsRequester(o, "declined")} disabled={busy}>
                              Decline
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
        </main>
      )}

      {/* ✅ ACTION BAR ABOVE GLOBAL NAV */}
      {!loading && item && (
        <div className="actionBar" style={{ bottom: bottomOffset as any }}>
          <div className="barInner">
            <button className={`cta ${primaryCTA.disabled ? "disabled" : ""}`} onClick={primaryCTA.onClick} disabled={primaryCTA.disabled || busy}>
              {busy ? "Working…" : primaryCTA.label}
            </button>

            {postType === "give" ? (
              <>
                {interestAccepted && !isMinePost ? (
                  <button className="cta ghost" onClick={confirmPickupAndChat} disabled={busy}>
                    Confirm pickup & chat
                  </button>
                ) : (
                  <button
                    className={`cta ghost ${(!mineInterested || interestAccepted || interestReserved || isMinePost) ? "disabled" : ""}`}
                    onClick={withdrawInterest}
                    disabled={busy || !mineInterested || interestAccepted || interestReserved || isMinePost}
                  >
                    Withdraw
                  </button>
                )}
              </>
            ) : (
              <>
                {isMinePost ? (
                  <button className="cta ghost" onClick={() => router.push("/messages")} disabled={busy}>
                    Messages
                  </button>
                ) : myOffer?.id ? (
                  myOfferAccepted ? (
                    <button className="cta ghost" onClick={() => openChatForOffer(myOffer)} disabled={busy}>
                      Start chat
                    </button>
                  ) : (
                    <button className="cta ghost" onClick={withdrawOffer} disabled={busy}>
                      Withdraw
                    </button>
                  )
                ) : (
                  <button className="cta ghost" onClick={() => router.push("/me")} disabled={busy}>
                    Account
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* GIVE modal */}
      {postType === "give" && showInterestModal && (
        <div className="modal" onClick={() => setShowInterestModal(false)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">Request this item</div>
              <button className="x" onClick={() => setShowInterestModal(false)}>
                ✕
              </button>
            </div>

            <div className="modalHint">Tell the lister when you can pick up.</div>

            <div className="field">
              <label>Earliest pickup</label>
              <select value={earliestPickup} onChange={(e) => setEarliestPickup(e.target.value as any)}>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="weekend">Weekend</option>
              </select>
            </div>

            <div className="field">
              <label>Time window</label>
              <select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value as any)}>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>

            <div className="field">
              <label>Optional note</label>
              <textarea value={interestNote} onChange={(e) => setInterestNote(e.target.value)} placeholder="Example: I can meet at the library after 3pm." />
            </div>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setShowInterestModal(false)}>
                Cancel
              </button>
              <button className="btn softGreen" onClick={submitInterest} disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REQUEST modal */}
      {postType === "request" && showOfferModal && (
        <div className="modal" onClick={() => setShowOfferModal(false)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">Offer help</div>
              <button className="x" onClick={() => setShowOfferModal(false)}>
                ✕
              </button>
            </div>

            <div className="modalHint">Chat unlocks only if the requester accepts your offer.</div>

            <div className="field">
              <label>Availability</label>
              <select value={offerAvailability} onChange={(e) => setOfferAvailability(e.target.value as any)}>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="this_week">This week</option>
                <option value="flexible">Flexible</option>
              </select>
            </div>

            <div className="field">
              <label>Optional note</label>
              <textarea value={offerNote} onChange={(e) => setOfferNote(e.target.value)} placeholder="Example: I can drive after 5pm. I have room for 2 bags." />
            </div>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setShowOfferModal(false)}>
                Cancel
              </button>
              <button className="btn softGreen" onClick={submitOffer} disabled={busy}>
                {busy ? "Sending…" : "Send offer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">{confirm.title}</div>
              <button className="x" onClick={() => setConfirm(null)}>
                ✕
              </button>
            </div>
            <div className="modalHint">{confirm.body}</div>
            <div className="modalActions">
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className={`btn ${confirm.danger ? "danger" : "softGreen"}`} onClick={confirm.onYes}>
                {confirm.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image modal */}
      {openImg && item && (
        <div className="imgModal" onClick={() => setOpenImg(null)}>
          <div className="imgInner" onClick={(e) => e.stopPropagation()}>
            <div className="imgTop">
              <div className="imgTitle">{item.title}</div>
              <button className="x" onClick={() => setOpenImg(null)}>
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={item.title} className="imgFull" />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.kind === "err" ? "toastErr" : "toastOk"}`}>
          {toast.kind === "err" ? "⚠ " : "✓ "}
          {toast.msg}
        </div>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f7f7f8;
          color: #111827;
          padding: 14px 14px 0;
        }

        .top {
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 0;
          background: rgba(247, 247, 248, 0.86);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(17, 24, 39, 0.08);
        }

        .navBtn {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          cursor: pointer;
          font-weight: 950;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
        }

        .brand {
          display: grid;
          justify-items: center;
          line-height: 1.1;
          user-select: none;
        }
        .brandTitle {
          font-weight: 950;
          letter-spacing: -0.2px;
        }
        .brandSub {
          font-size: 11px;
          opacity: 0.7;
          font-weight: 900;
        }

        .navRight {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .navChip {
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 9px 10px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.05);
        }

        .wrap {
          max-width: 920px;
          margin: 0 auto;
        }

        .alert {
          margin: 10px 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 10px 12px;
          border-radius: 14px;
          font-weight: 900;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
        }
        .alert.err {
          border-color: rgba(185, 28, 28, 0.25);
          background: rgba(185, 28, 28, 0.06);
          color: #991b1b;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-top: 8px;
        }

        .h1 {
          margin: 0;
          font-size: 32px;
          font-weight: 950;
          letter-spacing: -0.5px;
          line-height: 1.05;
        }

        .sub {
          margin-top: 8px;
          opacity: 0.75;
          font-weight: 900;
          color: #374151;
          overflow-wrap: anywhere;
        }

        .metaLine {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          color: #374151;
          font-weight: 800;
        }
        .metaKey {
          opacity: 0.7;
          font-weight: 900;
        }
        .metaVal {
          font-weight: 900;
        }
        .dot {
          opacity: 0.35;
        }

        .typePill {
          flex: 0 0 auto;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 950;
          border: 1px solid #e5e7eb;
          background: #fff;
        }
        .typePill.give {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(16, 185, 129, 0.10);
          color: #065f46;
        }
        .typePill.req {
          border-color: rgba(34, 197, 94, 0.3);
          background: rgba(34, 197, 94, 0.10);
          color: #166534;
        }

        .muted {
          opacity: 0.75;
          font-weight: 900;
          color: #374151;
        }

        .hero {
          margin-top: 14px;
        }

        .heroMediaBtn {
          width: 100%;
          border: none;
          background: transparent;
          padding: 0;
          cursor: zoom-in;
        }

        .heroImg {
          width: 100%;
          height: 420px;
          object-fit: cover;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          display: block;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.10);
        }

        .heroEmpty {
          width: 100%;
          height: 260px;
          border-radius: 18px;
          border: 1px dashed rgba(107, 114, 128, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #6b7280;
          font-weight: 950;
          background: #ffffff;
        }

        .heroReq {
          width: 100%;
          min-height: 230px;
          border-radius: 18px;
          border: 1px solid rgba(16, 185, 129, 0.25);
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.10), rgba(255, 255, 255, 0.92));
          padding: 16px;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.08);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }

        .heroReqLine {
          font-weight: 950;
          font-size: 13px;
          opacity: 0.9;
          color: #065f46;
        }

        .heroReqBody {
          margin-top: 10px;
          opacity: 0.9;
          line-height: 1.55;
          white-space: pre-wrap;
          color: #111827;
        }

        .panel {
          margin-top: 14px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.06);
        }

        .panelTop {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }

        .panelTitle {
          font-weight: 950;
          font-size: 16px;
        }

        .panelBody {
          opacity: 0.92;
          line-height: 1.6;
          white-space: pre-wrap;
          color: #111827;
        }

        .smallMuted {
          font-size: 13px;
          opacity: 0.7;
          font-weight: 900;
          color: #374151;
        }

        .offerList {
          display: grid;
          gap: 10px;
        }

        .offerCard {
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 12px;
          background: #fff;
        }

        .offerTop {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .offerName {
          font-weight: 950;
          color: #111827;
        }

        .offerMeta {
          margin-top: 8px;
          opacity: 0.85;
          font-size: 13px;
          font-weight: 900;
          color: #374151;
        }

        .offerNote {
          margin-top: 8px;
          opacity: 0.92;
          white-space: pre-wrap;
          color: #111827;
        }

        .offerActions {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 950;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #111827;
        }
        .toneGray {
          border-color: rgba(107, 114, 128, 0.25);
          background: rgba(107, 114, 128, 0.08);
          color: #374151;
        }
        .toneGreen {
          border-color: rgba(16, 185, 129, 0.30);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }
        .toneBlue {
          border-color: rgba(59, 130, 246, 0.30);
          background: rgba(59, 130, 246, 0.10);
          color: #1d4ed8;
        }
        .toneAmber {
          border-color: rgba(234, 179, 8, 0.35);
          background: rgba(234, 179, 8, 0.10);
          color: #92400e;
        }
        .toneRed {
          border-color: rgba(248, 113, 113, 0.35);
          background: rgba(239, 68, 68, 0.08);
          color: #991b1b;
        }

        .btn {
          border-radius: 14px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 950;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #111827;
        }
        .btn.primary {
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }
        .btn.softGreen {
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }
        .btn.softBlue {
          border-color: rgba(59, 130, 246, 0.35);
          background: rgba(59, 130, 246, 0.10);
          color: #1d4ed8;
        }
        .btn.softAmber {
          border-color: rgba(234, 179, 8, 0.35);
          background: rgba(234, 179, 8, 0.10);
          color: #92400e;
        }
        .btn.danger {
          border-color: rgba(185, 28, 28, 0.35);
          background: rgba(185, 28, 28, 0.08);
          color: #991b1b;
        }
        .btn.ghost {
          background: #fff;
        }

        /* ✅ Action bar ABOVE global nav */
        .actionBar {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 70;
          padding: 10px 14px;
          background: rgba(247, 247, 248, 0.92);
          backdrop-filter: blur(14px);
          border: 1px solid rgba(17, 24, 39, 0.08);
          border-left: none;
          border-right: none;
          box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.10);
        }

        .barInner {
          max-width: 920px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 10px;
        }

        .cta {
          height: 48px;
          border-radius: 16px;
          border: 1px solid rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.14);
          color: #065f46;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 18px 44px rgba(16, 185, 129, 0.12);
        }
        .cta.ghost {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #111827;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.06);
        }
        .cta.disabled {
          opacity: 0.65;
          cursor: not-allowed;
          box-shadow: none;
        }

        /* Modals */
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 90;
        }

        .modalInner {
          width: 100%;
          max-width: 520px;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 14px;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.18);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .modalTitle {
          font-size: 16px;
          font-weight: 950;
          color: #111827;
        }

        .x {
          background: #fff;
          border: 1px solid #e5e7eb;
          color: #111827;
          padding: 6px 10px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
        }

        .modalHint {
          margin-top: 10px;
          opacity: 0.85;
          line-height: 1.45;
          color: #374151;
          font-weight: 700;
        }

        .field {
          margin-top: 12px;
        }

        .field label {
          display: block;
          font-weight: 900;
          margin-bottom: 6px;
          color: #111827;
        }

        .field select,
        .field textarea {
          width: 100%;
          background: #fff;
          color: #111827;
          border: 1px solid #e5e7eb;
          padding: 10px 12px;
          border-radius: 14px;
          outline: none;
          font-weight: 800;
        }

        .field textarea {
          min-height: 90px;
          resize: vertical;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        /* Image modal */
        .imgModal {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.70);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
        }

        .imgInner {
          width: min(1000px, 95vw);
          max-height: 90vh;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.22);
        }

        .imgTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #e5e7eb;
        }

        .imgTitle {
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #111827;
        }

        .imgFull {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #111827;
        }

        /* Toast */
        .toast {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10000;
          border-radius: 14px;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          background: #fff;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.14);
          font-weight: 950;
          max-width: min(720px, calc(100vw - 24px));
          width: fit-content;
          color: #111827;
        }
        .toastOk {
          border-color: rgba(16, 185, 129, 0.28);
        }
        .toastErr {
          border-color: rgba(185, 28, 28, 0.28);
        }

        @media (max-width: 820px) {
          /* hide top-right quick buttons on smaller screens; bottom nav already exists */
          .navRight {
            display: none;
          }
        }

        @media (max-width: 520px) {
          .h1 {
            font-size: 26px;
          }
          .heroImg {
            height: 320px;
          }
          .barInner {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}