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

  category: string | null;
  pickup_location: string | null;

  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
};

type OwnerProfile = {
  full_name: string | null;
  user_role: string | null;
};

type MyInterestRow = {
  id: string;
  status: string | null;
};

type OfferStatus =
  | "pending"
  | "hold"
  | "accepted"
  | "completed"
  | "declined"
  | "withdrawn";

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

const APP_NAV_HEIGHT_PX = 86;
const ACTION_BAR_HEIGHT_PX = 84;

function isAshlandEmail(email: string | null) {
  return !!email && email.toLowerCase().endsWith("@ashland.edu");
}

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until canceled";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Until canceled";

  const now = new Date();
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return "Expired";

  const oneDay = 24 * 60 * 60 * 1000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const dayDiff = Math.round((startEnd - startToday) / oneDay);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff < 7) return `In ${dayDiff} days`;

  return end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function requestGroupLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  if (k === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

function offerStatusLabel(v: string | null) {
  const k = (v ?? "pending").toLowerCase();
  if (k === "pending") return "Pending";
  if (k === "hold") return "On hold";
  if (k === "accepted") return "Accepted";
  if (k === "completed") return "Completed";
  if (k === "declined") return "Declined";
  if (k === "withdrawn") return "Withdrawn";
  return "Pending";
}

function itemStatusLabel(v: string | null) {
  const k = (v ?? "available").toLowerCase();
  if (k === "available") return "Available";
  if (k === "reserved") return "Reserved";
  if (k === "claimed") return "Claimed";
  return "Available";
}

function toneClassForOffer(status: string | null) {
  const k = (status ?? "pending").toLowerCase();
  if (k === "accepted") return "toneGreen";
  if (k === "hold") return "toneBlue";
  if (k === "completed") return "toneAmber";
  if (k === "declined" || k === "withdrawn") return "toneRed";
  return "toneGray";
}

function toneClassForItem(status: string | null) {
  const k = (status ?? "available").toLowerCase();
  if (k === "available") return "toneGreen";
  if (k === "reserved") return "toneBlue";
  if (k === "claimed") return "toneGray";
  return "toneGray";
}

function prettyDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => !!userId && isAshlandEmail(userEmail), [userId, userEmail]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [owner, setOwner] = useState<OwnerProfile | null>(null);

  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [myOffer, setMyOffer] = useState<OfferRow | null>(null);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    actionLabel: string;
    danger?: boolean;
    onYes: () => Promise<void>;
  }>(null);

  const [showInterestModal, setShowInterestModal] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [interestNote, setInterestNote] = useState("");

  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAvailability, setOfferAvailability] = useState<
    "today" | "tomorrow" | "this_week" | "flexible"
  >("today");
  const [offerNote, setOfferNote] = useState("");

  const [openImg, setOpenImg] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);
  const loadSeq = useRef(0);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isMinePost = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const itemStatus = (item?.status ?? "available").toLowerCase();
  const expiryText = formatExpiry(item?.expires_at ?? null);

  const mineInterested = !!myInterest?.id;
  const myInterestStatus = (myInterest?.status ?? "").toLowerCase();
  const interestAccepted = myInterestStatus === "accepted";
  const interestReserved = myInterestStatus === "reserved";

  const myOfferStatus = (myOffer?.status ?? "").toLowerCase();
  const myOfferAccepted = myOfferStatus === "accepted" || myOfferStatus === "completed";

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function loadEverything(uid: string | null, email: string | null) {
    if (!itemId) return;

    const seq = ++loadSeq.current;
    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itemErr } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id"
        )
        .eq("id", itemId)
        .single();

      if (seq !== loadSeq.current) return;
      if (itemErr) throw new Error(itemErr.message);

      const loaded = it as ItemRow;
      loaded.post_type = (loaded.post_type ?? "give") as PostType;
      setItem(loaded);

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
          setMyInterest(
            mine ? { id: (mine as any).id, status: (mine as any).status ?? null } : null
          );
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
          const { data: all, error } = await supabase
            .from("request_offers")
            .select(`
              id,request_id,helper_id,status,availability,note,created_at,updated_at,
              helper:profiles!request_offers_helper_id_fkey(full_name,user_role)
            `)
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
      setErr(e?.message || "Failed to load item.");
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

  async function submitInterest() {
    if (!item || postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return showToast("This is your own listing.", "err");
    if (mineInterested) return showToast("You already requested this item.", "err");
    if (itemStatus !== "available") return showToast("This item is not available.", "err");

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
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
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
      showToast("Already accepted or reserved. You cannot withdraw here.", "err");
      return;
    }

    setConfirm({
      title: "Withdraw request?",
      body: "This removes your request from the owner’s list.",
      actionLabel: "Withdraw",
      danger: true,
      onYes: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          const { error } = await supabase
            .from("interests")
            .delete()
            .eq("item_id", item.id)
            .eq("user_id", userId);

          if (error) throw new Error(error.message);

          setMyInterest(null);
          setInterestCount((c) => Math.max(0, c - 1));
          showToast("Removed ✅", "ok");
        } catch (e: any) {
          showToast(e?.message || "Could not remove request.", "err");
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
    if (st !== "accepted") {
      showToast("You can confirm only after the owner accepts.", "err");
      return;
    }
    if (!item.owner_id) return showToast("Missing owner id.", "err");

    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", {
        p_interest_id: myInterest.id,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: userId,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Pickup confirmed. Coordinate details here.",
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
    if (isMinePost) return showToast("This is your own request.", "err");
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
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          showToast("You already offered help.", "err");
          await loadEverything(userId, userEmail);
          return;
        }
        throw new Error(error.message);
      }

      setMyOffer(data as any);
      setOfferNote("");
      setShowOfferModal(false);
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
      showToast("You cannot withdraw after acceptance.", "err");
      return;
    }

    setConfirm({
      title: "Withdraw offer?",
      body: "This removes your offer from the request.",
      actionLabel: "Withdraw",
      danger: true,
      onYes: async () => {
        setConfirm(null);
        setBusy(true);
        try {
          const { error } = await supabase
            .from("request_offers")
            .delete()
            .eq("id", myOffer.id)
            .eq("helper_id", userId);

          if (error) throw new Error(error.message);

          setMyOffer(null);
          showToast("Removed ✅", "ok");
          await loadEverything(userId, userEmail);
        } catch (e: any) {
          showToast(e?.message || "Could not withdraw offer.", "err");
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
      const { error: rpcErr } = await supabase.rpc("accept_request_offer_keep_others", {
        p_offer_id: offer.id,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadEverything(userId, userEmail);
      showToast("Accepted ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not accept offer.", "err");
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
      const { error } = await supabase
        .from("request_offers")
        .update({ status })
        .eq("id", offer.id);

      if (error) throw new Error(error.message);

      await loadEverything(userId, userEmail);
      showToast("Updated ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not update offer.", "err");
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
      const { error: rpcErr } = await supabase.rpc("complete_request_offer", {
        p_offer_id: offer.id,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadEverything(userId, userEmail);
      showToast("Marked completed ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not complete offer.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function openChatForOffer(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");

    const st = (offer.status ?? "").toLowerCase();
    if (st !== "accepted" && st !== "completed") {
      showToast("Chat opens only after acceptance.", "err");
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
        body: "✅ Chat opened for an accepted offer.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(e?.message || "Could not open chat.", "err");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!itemId) return;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
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
  }, [itemId]);

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

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const headerSubtitle = useMemo(() => {
    if (!item) return "";
    if (postType === "request") {
      return [
        requestGroupLabel(item.request_group),
        item.request_timeframe ? requestTimeframeLabel(item.request_timeframe) : "",
        item.request_location?.trim() ? item.request_location : "",
      ]
        .filter(Boolean)
        .join(" • ");
    }

    return [
      item.category?.trim() ? item.category : "",
      item.pickup_location?.trim() ? item.pickup_location : "",
    ]
      .filter(Boolean)
      .join(" • ");
  }, [item, postType]);

  const ownerLabel = useMemo(() => {
    if (!item) return "Ashland user";
    if (item.is_anonymous) return "Anonymous";
    const name = (owner?.full_name ?? "").trim();
    return name || "Ashland user";
  }, [item, owner]);

  const ownerRole = useMemo(() => {
    if (!item || item.is_anonymous) return "";
    return (owner?.user_role ?? "").trim();
  }, [item, owner]);

  const primaryCTA = useMemo(() => {
    if (!item) return { label: "Loading…", disabled: true, onClick: () => {} };

    if (postType === "give") {
      if (isMinePost) return { label: "Your listing", disabled: true, onClick: () => {} };
      if (!isLoggedIn)
        return { label: "Request item", disabled: false, onClick: () => router.push("/me") };
      if (mineInterested) {
        if (interestReserved) return { label: "Reserved ✅", disabled: true, onClick: () => {} };
        if (interestAccepted) return { label: "Accepted ✅", disabled: true, onClick: () => {} };
        return { label: "Request sent", disabled: true, onClick: () => {} };
      }
      if (itemStatus !== "available") return { label: "Unavailable", disabled: true, onClick: () => {} };
      return { label: "Request item", disabled: false, onClick: () => setShowInterestModal(true) };
    }

    if (isMinePost) return { label: "View offers below", disabled: true, onClick: () => {} };
    if (!isLoggedIn)
      return { label: "Offer help", disabled: false, onClick: () => router.push("/me") };
    if (myOffer?.id)
      return {
        label: `Offer sent • ${offerStatusLabel(myOffer.status ?? "pending")}`,
        disabled: true,
        onClick: () => {},
      };

    return { label: "Offer help", disabled: false, onClick: () => setShowOfferModal(true) };
  }, [
    item,
    postType,
    isMinePost,
    isLoggedIn,
    mineInterested,
    interestReserved,
    interestAccepted,
    itemStatus,
    router,
    myOffer,
  ]);

  const bottomOffset = `calc(${APP_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 10px)`;
  const pageBottomPad = `calc(${APP_NAV_HEIGHT_PX}px + ${ACTION_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom) + 22px)`;

  return (
    <div className="page" style={{ paddingBottom: pageBottomPad as any }}>
      <header className="top">
        <button className="iconBtn" onClick={() => router.back()} aria-label="Back">
          ←
        </button>

        <div className="brandBlock">
          <div className="brandEyebrow">{postType === "request" ? "REQUEST" : "ITEM"}</div>
          <div className="brandTitle">ScholarSwap</div>
        </div>

        <div className="topRight">
          {isMinePost ? (
            <button className="chipBtn" onClick={() => router.push(`/edit/${itemId}`)}>
              Edit
            </button>
          ) : (
            <button className="chipBtn" onClick={() => router.push("/feed")}>
              Feed
            </button>
          )}
        </div>
      </header>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="alert">Loading…</div>}

      {!loading && item && (
        <main className="wrap">
          <section className="heroCard">
            <div className="heroMedia">
              {postType === "give" ? (
                item.photo_url ? (
                  <button className="imgBtn" onClick={() => setOpenImg(item.photo_url!)} type="button">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.photo_url} alt={item.title} className="heroImg" />
                  </button>
                ) : (
                  <div className="emptyMedia">No photo uploaded</div>
                )
              ) : (
                <div className="requestHero">
                  <div className="requestHeroPills">
                    <span className="miniPill blue">{requestGroupLabel(item.request_group)}</span>
                    {item.request_timeframe ? (
                      <span className="miniPill blue">{requestTimeframeLabel(item.request_timeframe)}</span>
                    ) : null}
                  </div>
                  <div className="requestHeroText">
                    {item.description?.trim() || "No extra details provided."}
                  </div>
                </div>
              )}
            </div>

            <div className="heroBody">
              <div className="titleRow">
                <div className="titleWrap">
                  <h1 className="h1">{item.title}</h1>
                  {headerSubtitle ? <div className="sub">{headerSubtitle}</div> : null}
                </div>

                <span className={`pill ${toneClassForItem(item.status)}`}>
                  {itemStatusLabel(item.status)}
                </span>
              </div>

              <div className="metaStack">
                <div className="metaCard">
                  <div className="metaLabel">{postType === "give" ? "Posted by" : "Requester"}</div>
                  <div className="metaValue">
                    {ownerLabel}
                    {ownerRole ? <span className="muted"> ({ownerRole})</span> : null}
                  </div>
                </div>

                <div className="metaCard">
                  <div className="metaLabel">Closes</div>
                  <div className="metaValue">
                    {item.expires_at ? prettyDate(item.expires_at) : "Until canceled"}
                    <span className="muted"> • {expiryText}</span>
                  </div>
                </div>

                {postType === "give" ? (
                  <div className="metaCard">
                    <div className="metaLabel">Interest</div>
                    <div className="metaValue">{interestCount} request{interestCount === 1 ? "" : "s"}</div>
                  </div>
                ) : (
                  <div className="metaCard">
                    <div className="metaLabel">Offers</div>
                    <div className="metaValue">{isMinePost ? offers.length : myOffer?.id ? "1 sent" : "Open"}</div>
                  </div>
                )}
              </div>

              {isMinePost && (
                <div className="ownerActions">
                  <button className="softBtn" onClick={() => router.push(`/edit/${item.id}`)}>
                    Edit post
                  </button>

                  {postType === "give" ? (
                    <button className="softBtn" onClick={() => router.push(`/manage/${item.id}`)}>
                      Manage requests
                    </button>
                  ) : (
                    <button className="softBtn" onClick={() => router.push("/messages")}>
                      Messages
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {postType === "give" && (
            <section className="panel">
              <div className="panelTitle">Description</div>
              <div className="panelBody">{item.description?.trim() || "No description added."}</div>
            </section>
          )}

          {postType === "request" && !isMinePost && (
            <section className="panel">
              <div className="panelTitle">What this person needs</div>
              <div className="infoGrid">
                <div className="infoBox">
                  <div className="infoKey">Request type</div>
                  <div className="infoVal">{requestGroupLabel(item.request_group)}</div>
                </div>
                <div className="infoBox">
                  <div className="infoKey">Timeframe</div>
                  <div className="infoVal">{requestTimeframeLabel(item.request_timeframe) || "—"}</div>
                </div>
                <div className="infoBox full">
                  <div className="infoKey">Location</div>
                  <div className="infoVal">{item.request_location?.trim() || "No location provided"}</div>
                </div>
              </div>
            </section>
          )}

          {postType === "request" && isMinePost && (
            <section className="panel">
              <div className="panelTop">
                <div className="panelTitle">Offers</div>
                <div className="smallMuted">{offers.length} total</div>
              </div>

              {offers.length === 0 ? (
                <div className="emptyState">No offers yet.</div>
              ) : (
                <div className="offerList">
                  {offers.map((offer) => {
                    const st = (offer.status ?? "pending").toLowerCase();
                    const helperName = offer.helper?.full_name?.trim() || "Ashland user";
                    const helperRole = offer.helper?.user_role ? ` (${offer.helper.user_role})` : "";

                    return (
                      <div key={offer.id} className="offerCard">
                        <div className="offerTop">
                          <div className="offerName">
                            {helperName}
                            <span className="muted">{helperRole}</span>
                          </div>
                          <span className={`pill ${toneClassForOffer(offer.status)}`}>
                            {offerStatusLabel(offer.status)}
                          </span>
                        </div>

                        <div className="offerMeta">
                          Availability: {offer.availability || "—"}
                        </div>

                        <div className="offerNote">
                          {offer.note?.trim() || <span className="muted">No note added.</span>}
                        </div>

                        <div className="offerActions">
                          {(st === "pending" || st === "hold") && (
                            <button className="btn green" onClick={() => acceptOfferAsRequester(offer)} disabled={busy}>
                              Accept
                            </button>
                          )}

                          {st === "pending" && (
                            <button className="btn blue" onClick={() => setOfferStatusAsRequester(offer, "hold")} disabled={busy}>
                              Hold
                            </button>
                          )}

                          {st === "hold" && (
                            <button className="btn ghost" onClick={() => setOfferStatusAsRequester(offer, "pending")} disabled={busy}>
                              Move back
                            </button>
                          )}

                          {(st === "accepted" || st === "completed") && (
                            <button className="btn greenSoft" onClick={() => openChatForOffer(offer)} disabled={busy}>
                              Open chat
                            </button>
                          )}

                          {st === "accepted" && (
                            <button className="btn amber" onClick={() => completeOfferAsRequester(offer)} disabled={busy}>
                              Mark completed
                            </button>
                          )}

                          {(st === "pending" || st === "hold") && (
                            <button className="btn danger" onClick={() => setOfferStatusAsRequester(offer, "declined")} disabled={busy}>
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
          )}
        </main>
      )}

      {!loading && item && (
        <div className="actionBar" style={{ bottom: bottomOffset as any }}>
          <div className="barInner">
            <button
              className={`cta primary ${primaryCTA.disabled ? "disabled" : ""}`}
              onClick={primaryCTA.onClick}
              disabled={primaryCTA.disabled || busy}
            >
              {busy ? "Working…" : primaryCTA.label}
            </button>

            {postType === "give" ? (
              interestAccepted && !isMinePost ? (
                <button className="cta secondary" onClick={confirmPickupAndChat} disabled={busy}>
                  Confirm & chat
                </button>
              ) : (
                <button
                  className={`cta secondary ${(!mineInterested || interestAccepted || interestReserved || isMinePost) ? "disabled" : ""}`}
                  onClick={withdrawInterest}
                  disabled={busy || !mineInterested || interestAccepted || interestReserved || isMinePost}
                >
                  Withdraw
                </button>
              )
            ) : isMinePost ? (
              <button className="cta secondary" onClick={() => router.push(`/edit/${item.id}`)} disabled={busy}>
                Edit request
              </button>
            ) : myOffer?.id ? (
              myOfferAccepted ? (
                <button className="cta secondary" onClick={() => openChatForOffer(myOffer)} disabled={busy}>
                  Start chat
                </button>
              ) : (
                <button className="cta secondary" onClick={withdrawOffer} disabled={busy}>
                  Withdraw
                </button>
              )
            ) : (
              <button className="cta secondary" onClick={() => router.push("/me")} disabled={busy}>
                Account
              </button>
            )}
          </div>
        </div>
      )}

      {postType === "give" && showInterestModal && (
        <div className="modal" onClick={() => setShowInterestModal(false)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">Request this item</div>
              <button className="xBtn" onClick={() => setShowInterestModal(false)}>
                ✕
              </button>
            </div>

            <div className="modalHint">
              Let the owner know when you can meet.
            </div>

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
              <textarea
                value={interestNote}
                onChange={(e) => setInterestNote(e.target.value)}
                placeholder="Example: I can meet after class near the library."
              />
            </div>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setShowInterestModal(false)}>
                Cancel
              </button>
              <button className="btn green" onClick={submitInterest} disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {postType === "request" && showOfferModal && (
        <div className="modal" onClick={() => setShowOfferModal(false)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">Offer help</div>
              <button className="xBtn" onClick={() => setShowOfferModal(false)}>
                ✕
              </button>
            </div>

            <div className="modalHint">
              Chat unlocks only if the requester accepts your offer.
            </div>

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
              <textarea
                value={offerNote}
                onChange={(e) => setOfferNote(e.target.value)}
                placeholder="Example: I can help after 5pm."
              />
            </div>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setShowOfferModal(false)}>
                Cancel
              </button>
              <button className="btn green" onClick={submitOffer} disabled={busy}>
                {busy ? "Sending…" : "Send offer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">{confirm.title}</div>
              <button className="xBtn" onClick={() => setConfirm(null)}>
                ✕
              </button>
            </div>

            <div className="modalHint">{confirm.body}</div>

            <div className="modalActions">
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className={`btn ${confirm.danger ? "danger" : "green"}`} onClick={confirm.onYes}>
                {confirm.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {openImg && item && (
        <div className="imgModal" onClick={() => setOpenImg(null)}>
          <div className="imgInner" onClick={(e) => e.stopPropagation()}>
            <div className="imgTop">
              <div className="imgTitle">{item.title}</div>
              <button className="xBtn" onClick={() => setOpenImg(null)}>
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={item.title} className="imgFull" />
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind === "err" ? "toastErr" : "toastOk"}`}>
          {toast.kind === "err" ? "⚠ " : "✓ "}
          {toast.msg}
        </div>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: linear-gradient(180deg, #f8fafc 0%, #f6f7fb 42%, #f8fafc 100%);
          color: #0f172a;
          padding: 14px 14px 0;
        }

        .top {
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          background: rgba(248, 250, 252, 0.9);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        }

        .iconBtn,
        .chipBtn {
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.92);
          color: #0f172a;
          border-radius: 16px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }

        .iconBtn {
          width: 44px;
          height: 44px;
        }

        .chipBtn {
          padding: 10px 14px;
          white-space: nowrap;
        }

        .brandBlock {
          min-width: 0;
          flex: 1;
          display: grid;
          justify-items: center;
          line-height: 1.05;
        }

        .brandEyebrow {
          font-size: 11px;
          font-weight: 1000;
          color: #64748b;
          letter-spacing: 0.12em;
        }

        .brandTitle {
          font-size: 16px;
          font-weight: 1000;
          letter-spacing: -0.03em;
        }

        .topRight {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          min-width: 64px;
        }

        .wrap {
          max-width: 980px;
          margin: 0 auto;
        }

        .alert {
          margin: 12px 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 12px 14px;
          border-radius: 18px;
          font-weight: 900;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
        }

        .alert.err {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .heroCard {
          margin-top: 12px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #e5e7eb;
          border-radius: 28px;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.06);
        }

        .heroMedia {
          border-bottom: 1px solid #eef2f7;
          background: #f8fafc;
        }

        .imgBtn {
          width: 100%;
          border: none;
          background: transparent;
          padding: 0;
          cursor: zoom-in;
        }

        .heroImg {
          display: block;
          width: 100%;
          height: 360px;
          object-fit: cover;
        }

        .emptyMedia {
          height: 220px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-weight: 900;
          background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
        }

        .requestHero {
          padding: 18px;
          min-height: 190px;
          background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .requestHeroPills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .requestHeroText {
          margin-top: 18px;
          font-size: 15px;
          line-height: 1.6;
          color: #0f172a;
          white-space: pre-wrap;
        }

        .heroBody {
          padding: 18px;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .titleWrap {
          min-width: 0;
          flex: 1;
        }

        .h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.05;
          font-weight: 1000;
          letter-spacing: -0.05em;
          overflow-wrap: anywhere;
        }

        .sub {
          margin-top: 8px;
          color: #64748b;
          font-weight: 800;
          line-height: 1.45;
        }

        .metaStack {
          margin-top: 16px;
          display: grid;
          gap: 10px;
        }

        .metaCard {
          border: 1px solid #eef2f7;
          background: #fff;
          border-radius: 18px;
          padding: 12px 14px;
        }

        .metaLabel {
          font-size: 12px;
          color: #64748b;
          font-weight: 900;
        }

        .metaValue {
          margin-top: 6px;
          font-size: 14px;
          color: #0f172a;
          font-weight: 900;
          line-height: 1.4;
        }

        .muted {
          color: #64748b;
          font-weight: 800;
        }

        .ownerActions {
          margin-top: 16px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .softBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          padding: 11px 14px;
          border-radius: 16px;
          font-weight: 900;
          cursor: pointer;
        }

        .panel {
          margin-top: 14px;
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          padding: 16px;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.05);
        }

        .panelTop {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
          margin-bottom: 12px;
        }

        .panelTitle {
          font-size: 16px;
          font-weight: 1000;
        }

        .panelBody {
          color: #334155;
          line-height: 1.65;
          white-space: pre-wrap;
        }

        .infoGrid {
          display: grid;
          gap: 10px;
          grid-template-columns: 1fr;
        }

        .infoBox {
          border: 1px solid #eef2f7;
          border-radius: 18px;
          background: #fff;
          padding: 12px 14px;
        }

        .infoBox.full {
          grid-column: 1 / -1;
        }

        .infoKey {
          font-size: 12px;
          color: #64748b;
          font-weight: 900;
        }

        .infoVal {
          margin-top: 6px;
          font-size: 14px;
          color: #0f172a;
          font-weight: 900;
        }

        .smallMuted {
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
        }

        .emptyState {
          border: 1px dashed #cbd5e1;
          border-radius: 18px;
          background: #f8fafc;
          padding: 18px;
          color: #64748b;
          font-weight: 900;
          text-align: center;
        }

        .offerList {
          display: grid;
          gap: 12px;
        }

        .offerCard {
          border: 1px solid #eef2f7;
          background: #fff;
          border-radius: 20px;
          padding: 14px;
        }

        .offerTop {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }

        .offerName {
          font-weight: 1000;
          color: #0f172a;
        }

        .offerMeta {
          margin-top: 10px;
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
        }

        .offerNote {
          margin-top: 10px;
          color: #334155;
          white-space: pre-wrap;
          line-height: 1.5;
        }

        .offerActions {
          margin-top: 12px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .pill,
        .miniPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-weight: 1000;
        }

        .pill {
          padding: 7px 11px;
          font-size: 12px;
          border: 1px solid #e5e7eb;
        }

        .miniPill {
          padding: 6px 10px;
          font-size: 12px;
          border: 1px solid #bfdbfe;
          background: #dbeafe;
          color: #1d4ed8;
        }

        .toneGray {
          border-color: #d1d5db;
          background: #f8fafc;
          color: #475569;
        }

        .toneGreen {
          border-color: #bbf7d0;
          background: #ecfdf5;
          color: #166534;
        }

        .toneBlue {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }

        .toneAmber {
          border-color: #fde68a;
          background: #fffbeb;
          color: #92400e;
        }

        .toneRed {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .btn {
          border-radius: 16px;
          padding: 10px 13px;
          font-weight: 900;
          cursor: pointer;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .btn.green {
          border-color: #bbf7d0;
          background: #ecfdf5;
          color: #166534;
        }

        .btn.greenSoft {
          border-color: #bbf7d0;
          background: #ecfdf5;
          color: #166534;
        }

        .btn.blue {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }

        .btn.amber {
          border-color: #fde68a;
          background: #fffbeb;
          color: #92400e;
        }

        .btn.danger {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .btn.ghost {
          background: #fff;
        }

        .actionBar {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 70;
          padding: 10px 12px;
          background: rgba(248, 250, 252, 0.92);
          backdrop-filter: blur(14px);
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow: 0 -18px 44px rgba(15, 23, 42, 0.08);
        }

        .barInner {
          max-width: 980px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 10px;
        }

        .cta {
          height: 50px;
          border-radius: 18px;
          font-weight: 1000;
          cursor: pointer;
          border: none;
          white-space: nowrap;
        }

        .cta.primary {
          background: #03133d;
          color: #fff;
          box-shadow: 0 18px 35px rgba(3, 19, 61, 0.2);
        }

        .cta.secondary {
          background: #fff;
          color: #0f172a;
          border: 1px solid #e5e7eb;
        }

        .cta.disabled {
          opacity: 0.55;
          cursor: not-allowed;
          box-shadow: none;
        }

        .modal {
          position: fixed;
          inset: 0;
          z-index: 90;
          background: rgba(15, 23, 42, 0.44);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modalInner {
          width: 100%;
          max-width: 520px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          padding: 16px;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .modalTitle {
          font-size: 16px;
          font-weight: 1000;
          color: #0f172a;
        }

        .xBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          padding: 7px 11px;
          border-radius: 14px;
          cursor: pointer;
          font-weight: 1000;
        }

        .modalHint {
          margin-top: 10px;
          color: #475569;
          font-weight: 700;
          line-height: 1.45;
        }

        .field {
          margin-top: 12px;
        }

        .field label {
          display: block;
          margin-bottom: 6px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
        }

        .field select,
        .field textarea {
          width: 100%;
          background: #fff;
          color: #0f172a;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 12px 13px;
          outline: none;
          font-weight: 800;
        }

        .field textarea {
          min-height: 100px;
          resize: vertical;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .imgModal {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(15, 23, 42, 0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .imgInner {
          width: min(1000px, 96vw);
          max-height: 90vh;
          border-radius: 22px;
          overflow: hidden;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.22);
        }

        .imgTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          padding: 12px 14px;
          border-bottom: 1px solid #e5e7eb;
        }

        .imgTitle {
          font-weight: 1000;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imgFull {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #111827;
        }

        .toast {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          top: 16px;
          z-index: 10000;
          border-radius: 16px;
          padding: 10px 13px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14);
          font-weight: 1000;
          max-width: min(720px, calc(100vw - 24px));
        }

        .toastOk {
          border-color: #bbf7d0;
        }

        .toastErr {
          border-color: #fecdd3;
        }

        @media (min-width: 760px) {
          .heroImg {
            height: 420px;
          }

          .metaStack {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .infoGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 520px) {
          .h1 {
            font-size: 26px;
          }

          .heroImg {
            height: 300px;
          }

          .barInner {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}