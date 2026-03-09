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

  hide_interest_count: boolean | null;
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
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startEnd = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate()
  ).getTime();
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

function initialsFromName(name: string) {
  const clean = name.trim();
  if (!clean) return "A";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const isLoggedIn = useMemo(
    () => !!userId && isAshlandEmail(userEmail),
    [userId, userEmail]
  );

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
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isMinePost = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const itemStatus = (item?.status ?? "available").toLowerCase();
  const expiryText = formatExpiry(item?.expires_at ?? null);
  const activityHidden = !!item?.hide_interest_count;

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
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id,hide_interest_count"
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

  async function toggleActivityVisibility() {
    if (!item || !isMinePost || !userId) return;

    const nextValue = !item.hide_interest_count;
    setBusy(true);
    setOwnerMenuOpen(false);

    try {
      const { error } = await supabase
        .from("items")
        .update({ hide_interest_count: nextValue })
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      setItem((prev) => (prev ? { ...prev, hide_interest_count: nextValue } : prev));
      showToast(nextValue ? "Count hidden ✅" : "Count shown ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not update visibility.", "err");
    } finally {
      setBusy(false);
    }
  }

  function askDeleteListing() {
    if (!item || !isMinePost || !userId) return;

    setOwnerMenuOpen(false);
    setConfirm({
      title: "Delete listing?",
      body: "This permanently removes the listing.",
      actionLabel: "Delete",
      danger: true,
      onYes: async () => {
        setConfirm(null);
        setBusy(true);

        try {
          if (postType === "give") {
            await supabase.from("interests").delete().eq("item_id", item.id);
          } else {
            await supabase.from("request_offers").delete().eq("request_id", item.id);
          }

          const { error } = await supabase
            .from("items")
            .delete()
            .eq("id", item.id)
            .eq("owner_id", userId);

          if (error) throw new Error(error.message);

          showToast("Listing deleted ✅", "ok");
          router.replace("/feed");
        } catch (e: any) {
          showToast(
            e?.message || "Could not delete listing. Check related foreign keys.",
            "err"
          );
        } finally {
          setBusy(false);
        }
      },
    });
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
        setOwnerMenuOpen(false);
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

  const ownerAvatarText = useMemo(() => {
    return item?.is_anonymous ? "A" : initialsFromName(ownerLabel);
  }, [item?.is_anonymous, ownerLabel]);

  const activityText = useMemo(() => {
    if (!item) return "";
    if (activityHidden) {
      return postType === "give" ? "Interest hidden" : "Offer count hidden";
    }
    if (postType === "give") {
      return `${interestCount} request${interestCount === 1 ? "" : "s"}`;
    }
    if (isMinePost) {
      return `${offers.length} offer${offers.length === 1 ? "" : "s"}`;
    }
    return myOffer?.id ? "Offer sent" : "Open request";
  }, [activityHidden, postType, interestCount, offers.length, isMinePost, myOffer?.id, item]);

  const visibilityMenuLabel = useMemo(() => {
    if (postType === "give") {
      return activityHidden ? "Show interest count" : "Hide interest count";
    }
    return activityHidden ? "Show offer count" : "Hide offer count";
  }, [postType, activityHidden]);

  const primaryCTA = useMemo(() => {
    if (!item) return { label: "Loading…", disabled: true, onClick: () => {} };

    if (postType === "give") {
      if (isMinePost) return { label: "Your listing", disabled: true, onClick: () => {} };
      if (!isLoggedIn) {
        return { label: "Request item", disabled: false, onClick: () => router.push("/me") };
      }
      if (mineInterested) {
        if (interestReserved) return { label: "Reserved ✅", disabled: true, onClick: () => {} };
        if (interestAccepted) return { label: "Accepted ✅", disabled: true, onClick: () => {} };
        return { label: "Request sent", disabled: true, onClick: () => {} };
      }
      if (itemStatus !== "available") {
        return { label: "Unavailable", disabled: true, onClick: () => {} };
      }
      return {
        label: "Request item",
        disabled: false,
        onClick: () => setShowInterestModal(true),
      };
    }

    if (isMinePost) return { label: "Your request", disabled: true, onClick: () => {} };
    if (!isLoggedIn) {
      return { label: "Offer help", disabled: false, onClick: () => router.push("/me") };
    }
    if (myOffer?.id) {
      return {
        label: `Offer sent • ${offerStatusLabel(myOffer.status ?? "pending")}`,
        disabled: true,
        onClick: () => {},
      };
    }

    return {
      label: "Offer help",
      disabled: false,
      onClick: () => setShowOfferModal(true),
    };
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

  const secondaryCTA = useMemo(() => {
    if (!item) return null;

    if (postType === "give") {
      if (isMinePost) return null;
      if (interestAccepted) {
        return {
          label: "Confirm & chat",
          disabled: false,
          onClick: confirmPickupAndChat,
        };
      }
      if (mineInterested && !interestAccepted && !interestReserved) {
        return {
          label: "Withdraw",
          disabled: false,
          onClick: withdrawInterest,
        };
      }
      return null;
    }

    if (isMinePost) return null;

    if (myOffer?.id) {
      if (myOfferAccepted) {
        return {
          label: "Start chat",
          disabled: false,
          onClick: () => openChatForOffer(myOffer),
        };
      }

      return {
        label: "Withdraw",
        disabled: false,
        onClick: withdrawOffer,
      };
    }

    if (!isLoggedIn) {
      return {
        label: "Account",
        disabled: false,
        onClick: () => router.push("/me"),
      };
    }

    return null;
  }, [
    item,
    postType,
    isMinePost,
    interestAccepted,
    mineInterested,
    interestReserved,
    myOffer,
    myOfferAccepted,
    isLoggedIn,
    router,
  ]);

  const bottomOffset = `calc(${APP_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 10px)`;
  const pageBottomPad = `calc(${APP_NAV_HEIGHT_PX}px + ${ACTION_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom) + 24px)`;

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

        <div className="topSpacer" />
      </header>

      {err && <div className="alert err">{err}</div>}
      {loading && <div className="alert">Loading…</div>}

      {!loading && item && (
        <main className="wrap">
          <section className="heroCard">
            <div className="cardHead">
              <div className="ownerMini">
                <div className="ownerAvatar">{ownerAvatarText}</div>

                <div className="ownerText">
                  <div className="ownerName">{ownerLabel}</div>
                  <div className="ownerSub">
                    {postType === "give" ? "Item" : "Request"}
                    {ownerRole ? ` • ${ownerRole}` : ""}
                  </div>
                </div>
              </div>

              {isMinePost ? (
                <div className="menuWrap">
                  {ownerMenuOpen && (
                    <button
                      className="menuOverlay"
                      aria-label="Close menu"
                      onClick={() => setOwnerMenuOpen(false)}
                    />
                  )}

                  <button
                    className="menuBtn"
                    aria-label="More options"
                    onClick={() => setOwnerMenuOpen((v) => !v)}
                    disabled={busy}
                    type="button"
                  >
                    ⋯
                  </button>

                  {ownerMenuOpen && (
                    <div className="menuCard">
                      <button
                        className="menuItem"
                        onClick={() => {
                          setOwnerMenuOpen(false);
                          router.push(`/edit/${item.id}`);
                        }}
                        type="button"
                      >
                        Edit
                      </button>

                      <button
                        className="menuItem"
                        onClick={toggleActivityVisibility}
                        type="button"
                      >
                        {visibilityMenuLabel}
                      </button>

                      <button
                        className="menuItem danger"
                        onClick={askDeleteListing}
                        type="button"
                      >
                        Delete listing
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="headRightPill">{itemStatusLabel(item.status)}</div>
              )}
            </div>

            <div className="heroMedia">
              {postType === "give" ? (
                item.photo_url ? (
                  <button
                    className="imgBtn"
                    onClick={() => setOpenImg(item.photo_url!)}
                    type="button"
                  >
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
                      <span className="miniPill blue">
                        {requestTimeframeLabel(item.request_timeframe)}
                      </span>
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

              {postType === "give" && item.description?.trim() ? (
                <div className="caption">{item.description.trim()}</div>
              ) : null}

              <div className="metaRow">
                <div className="miniMeta">
                  <span className="metaKey">Closes</span>
                  <span className="metaVal">
                    {item.expires_at ? prettyDate(item.expires_at) : "Until canceled"}
                  </span>
                </div>

                <div className="miniMeta">
                  <span className="metaKey">Status</span>
                  <span className="metaVal">{expiryText}</span>
                </div>

                <div className="miniMeta">
                  <span className="metaKey">{postType === "give" ? "Interest" : "Offers"}</span>
                  <span className="metaVal">{activityText}</span>
                </div>
              </div>
            </div>
          </section>

          {postType === "request" && !isMinePost && (
            <section className="panel compactPanel">
              <div className="compactGrid">
                <div className="compactBox">
                  <div className="compactKey">Type</div>
                  <div className="compactVal">{requestGroupLabel(item.request_group)}</div>
                </div>

                <div className="compactBox">
                  <div className="compactKey">Timeframe</div>
                  <div className="compactVal">
                    {requestTimeframeLabel(item.request_timeframe) || "—"}
                  </div>
                </div>

                <div className="compactBox full">
                  <div className="compactKey">Location</div>
                  <div className="compactVal">
                    {item.request_location?.trim() || "No location provided"}
                  </div>
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
                            <button
                              className="btn green"
                              onClick={() => acceptOfferAsRequester(offer)}
                              disabled={busy}
                            >
                              Accept
                            </button>
                          )}

                          {st === "pending" && (
                            <button
                              className="btn blue"
                              onClick={() => setOfferStatusAsRequester(offer, "hold")}
                              disabled={busy}
                            >
                              Hold
                            </button>
                          )}

                          {st === "hold" && (
                            <button
                              className="btn ghost"
                              onClick={() => setOfferStatusAsRequester(offer, "pending")}
                              disabled={busy}
                            >
                              Move back
                            </button>
                          )}

                          {(st === "accepted" || st === "completed") && (
                            <button
                              className="btn greenSoft"
                              onClick={() => openChatForOffer(offer)}
                              disabled={busy}
                            >
                              Open chat
                            </button>
                          )}

                          {st === "accepted" && (
                            <button
                              className="btn amber"
                              onClick={() => completeOfferAsRequester(offer)}
                              disabled={busy}
                            >
                              Complete
                            </button>
                          )}

                          {(st === "pending" || st === "hold") && (
                            <button
                              className="btn danger"
                              onClick={() => setOfferStatusAsRequester(offer, "declined")}
                              disabled={busy}
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
            </section>
          )}
        </main>
      )}

      {!loading && item && (
        <div className="actionBar" style={{ bottom: bottomOffset as any }}>
          <div
            className="barInner"
            style={{
              gridTemplateColumns: secondaryCTA ? "1.45fr 1fr" : "1fr",
            }}
          >
            <button
              className={`cta primary ${primaryCTA.disabled ? "disabled" : ""}`}
              onClick={primaryCTA.onClick}
              disabled={primaryCTA.disabled || busy}
            >
              {busy ? "Working…" : primaryCTA.label}
            </button>

            {secondaryCTA ? (
              <button
                className={`cta secondary ${secondaryCTA.disabled ? "disabled" : ""}`}
                onClick={secondaryCTA.onClick}
                disabled={secondaryCTA.disabled || busy}
              >
                {busy ? "Working…" : secondaryCTA.label}
              </button>
            ) : null}
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

            <div className="modalHint">Let the owner know when you can meet.</div>

            <div className="field">
              <label>Earliest pickup</label>
              <select
                value={earliestPickup}
                onChange={(e) => setEarliestPickup(e.target.value as any)}
              >
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="weekend">Weekend</option>
              </select>
            </div>

            <div className="field">
              <label>Time window</label>
              <select
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value as any)}
              >
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
              <select
                value={offerAvailability}
                onChange={(e) => setOfferAvailability(e.target.value as any)}
              >
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
              <button
                className={`btn ${confirm.danger ? "danger" : "green"}`}
                onClick={confirm.onYes}
              >
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
          background: #f6f7fb;
          color: #0f172a;
          padding: 12px 12px 0;
        }

        .top {
          position: sticky;
          top: 0;
          z-index: 40;
          display: grid;
          grid-template-columns: 44px 1fr 44px;
          align-items: center;
          gap: 10px;
          padding: 8px 0 10px;
          background: rgba(246, 247, 251, 0.88);
          backdrop-filter: blur(14px);
        }

        .iconBtn {
          width: 44px;
          height: 44px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.96);
          color: #0f172a;
          border-radius: 14px;
          font-size: 20px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
        }

        .topSpacer {
          width: 44px;
          height: 44px;
        }

        .brandBlock {
          min-width: 0;
          display: grid;
          justify-items: center;
          line-height: 1.05;
        }

        .brandEyebrow {
          font-size: 10px;
          font-weight: 1000;
          color: #64748b;
          letter-spacing: 0.14em;
        }

        .brandTitle {
          font-size: 15px;
          font-weight: 1000;
          letter-spacing: -0.03em;
        }

        .wrap {
          max-width: 920px;
          margin: 0 auto;
        }

        .alert {
          margin: 10px 0 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 11px 13px;
          border-radius: 16px;
          font-weight: 800;
          font-size: 13px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .alert.err {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .heroCard {
          margin-top: 8px;
          background: #fff;
          border: 1px solid #e8ebf0;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
        }

        .cardHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px 10px;
          border-bottom: 1px solid #f0f2f6;
          background: #fff;
        }

        .ownerMini {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .ownerAvatar {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          background: linear-gradient(135deg, #dbeafe 0%, #eef2ff 100%);
          border: 1px solid #dbe3f0;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 1000;
          color: #0f172a;
          flex: 0 0 auto;
        }

        .ownerText {
          min-width: 0;
        }

        .ownerName {
          font-size: 13px;
          font-weight: 900;
          line-height: 1.1;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ownerSub {
          margin-top: 3px;
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
          line-height: 1.1;
        }

        .headRightPill {
          padding: 6px 10px;
          border-radius: 999px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          font-size: 11px;
          font-weight: 900;
          color: #475569;
          white-space: nowrap;
        }

        .menuWrap {
          position: relative;
          flex: 0 0 auto;
          z-index: 120;
        }

        .menuBtn {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 24px;
          line-height: 0;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
        }

        .menuOverlay {
          position: fixed;
          inset: 0;
          z-index: 0;
          background: transparent;
          border: 0;
          padding: 0;
          margin: 0;
          cursor: default;
        }

        .menuCard {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 196px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 18px;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.14);
          overflow: hidden;
          z-index: 2;
        }

        .menuItem {
          width: 100%;
          border: 0;
          background: #fff;
          text-align: left;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 900;
          color: #0f172a;
          cursor: pointer;
        }

        .menuItem + .menuItem {
          border-top: 1px solid #eef2f7;
        }

        .menuItem.danger {
          color: #b91c1c;
        }

        .heroMedia {
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
          font-size: 13px;
          font-weight: 900;
          background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
        }

        .requestHero {
          padding: 14px;
          min-height: 170px;
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
          margin-top: 14px;
          font-size: 13px;
          line-height: 1.55;
          color: #0f172a;
          white-space: pre-wrap;
        }

        .heroBody {
          padding: 14px;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .titleWrap {
          min-width: 0;
          flex: 1;
        }

        .h1 {
          margin: 0;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 1000;
          letter-spacing: -0.04em;
          overflow-wrap: anywhere;
        }

        .sub {
          margin-top: 6px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.4;
        }

        .caption {
          margin-top: 10px;
          color: #334155;
          font-size: 13px;
          line-height: 1.55;
          white-space: pre-wrap;
        }

        .metaRow {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .miniMeta {
          border: 1px solid #eef2f7;
          border-radius: 16px;
          background: #fafbfc;
          padding: 10px 11px;
          min-width: 0;
        }

        .metaKey {
          display: block;
          font-size: 10px;
          font-weight: 1000;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #64748b;
        }

        .metaVal {
          display: block;
          margin-top: 5px;
          font-size: 12px;
          line-height: 1.3;
          font-weight: 900;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .panel {
          margin-top: 12px;
          background: #fff;
          border: 1px solid #e8ebf0;
          border-radius: 22px;
          padding: 14px;
          box-shadow: 0 16px 38px rgba(15, 23, 42, 0.04);
        }

        .compactPanel {
          padding: 12px;
        }

        .compactGrid {
          display: grid;
          gap: 8px;
          grid-template-columns: 1fr 1fr;
        }

        .compactBox {
          border: 1px solid #eef2f7;
          border-radius: 16px;
          background: #fafbfc;
          padding: 10px 11px;
        }

        .compactBox.full {
          grid-column: 1 / -1;
        }

        .compactKey {
          font-size: 10px;
          color: #64748b;
          font-weight: 1000;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .compactVal {
          margin-top: 5px;
          font-size: 12px;
          color: #0f172a;
          font-weight: 900;
          line-height: 1.35;
        }

        .panelTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
        }

        .panelTitle {
          font-size: 15px;
          font-weight: 1000;
        }

        .smallMuted {
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }

        .emptyState {
          border: 1px dashed #cbd5e1;
          border-radius: 18px;
          background: #f8fafc;
          padding: 16px;
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
          text-align: center;
        }

        .offerList {
          display: grid;
          gap: 10px;
        }

        .offerCard {
          border: 1px solid #eef2f7;
          background: #fff;
          border-radius: 18px;
          padding: 12px;
        }

        .offerTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        }

        .offerName {
          font-size: 13px;
          font-weight: 1000;
          color: #0f172a;
        }

        .offerMeta {
          margin-top: 8px;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }

        .offerNote {
          margin-top: 8px;
          color: #334155;
          font-size: 13px;
          white-space: pre-wrap;
          line-height: 1.5;
        }

        .offerActions {
          margin-top: 10px;
          display: flex;
          gap: 8px;
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
          padding: 6px 10px;
          font-size: 11px;
          border: 1px solid #e5e7eb;
          white-space: nowrap;
        }

        .miniPill {
          padding: 6px 10px;
          font-size: 11px;
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

        .muted {
          color: #64748b;
          font-weight: 800;
        }

        .btn {
          border-radius: 14px;
          padding: 9px 12px;
          font-size: 12px;
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
          background: rgba(246, 247, 251, 0.92);
          backdrop-filter: blur(14px);
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow: 0 -16px 36px rgba(15, 23, 42, 0.08);
        }

        .barInner {
          max-width: 920px;
          margin: 0 auto;
          display: grid;
          gap: 10px;
        }

        .cta {
          height: 48px;
          border-radius: 16px;
          font-size: 14px;
          font-weight: 1000;
          cursor: pointer;
          border: none;
          white-space: nowrap;
        }

        .cta.primary {
          background: #03133d;
          color: #fff;
          box-shadow: 0 16px 32px rgba(3, 19, 61, 0.18);
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
          border-radius: 22px;
          padding: 15px;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .modalTitle {
          font-size: 15px;
          font-weight: 1000;
          color: #0f172a;
        }

        .xBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          padding: 7px 10px;
          border-radius: 12px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 1000;
        }

        .modalHint {
          margin-top: 10px;
          color: #475569;
          font-size: 13px;
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
          font-size: 12px;
          font-weight: 900;
        }

        .field select,
        .field textarea {
          width: 100%;
          background: #fff;
          color: #0f172a;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 11px 12px;
          outline: none;
          font-size: 13px;
          font-weight: 800;
        }

        .field textarea {
          min-height: 96px;
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
          font-size: 13px;
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
          top: 14px;
          z-index: 10000;
          border-radius: 14px;
          padding: 10px 12px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.14);
          font-size: 13px;
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
            height: 430px;
          }

          .requestHero {
            min-height: 220px;
          }
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 300px;
          }

          .h1 {
            font-size: 20px;
          }

          .metaRow {
            grid-template-columns: 1fr;
          }

          .compactGrid {
            grid-template-columns: 1fr;
          }

          .barInner {
            grid-template-columns: 1fr !important;
          }

          .menuCard {
            right: 0;
            width: 188px;
          }
        }
      `}</style>
    </div>
  );
}