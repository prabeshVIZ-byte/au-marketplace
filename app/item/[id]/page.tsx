"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread } from "@/lib/ensureThread";

const LOVES_TABLE = "post_likes";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  category: string | null;
  pickup_location: string | null;

  post_type: PostType | null;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
  hide_interest_count?: boolean | null;
  reserved_interest_id?: string | null;
  claimed_at?: string | null;
};

type OwnerProfile = {
  full_name: string | null;
  user_role: string | null;
};

type MyInterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: string | null;
  created_at: string | null;
};

type MyOfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: string | null;
  created_at: string | null;
};

type CompletedInterestQueryRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: string | null;
  completed_at: string | null;
  reserved_at: string | null;
  accepted_at: string | null;
  requester:
    | {
        full_name: string | null;
        email: string | null;
      }
    | {
        full_name: string | null;
        email: string | null;
      }[]
    | null;
};

type CompletedInterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: string | null;
  completed_at: string | null;
  reserved_at: string | null;
  accepted_at: string | null;
  requester: {
    full_name: string | null;
    email: string | null;
  } | null;
};

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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

function giveCategoryLabel(v: string | null) {
  return (v ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function formatDelist(expiresAt: string | null) {
  if (!expiresAt) return "Open-ended";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "Open-ended";

  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFullWhen(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ownerNameLabel(item: ItemRow | null, owner: OwnerProfile | null) {
  if (!item) return "Ashland user";
  if (item.is_anonymous) return "Anonymous";
  const name = (owner?.full_name ?? "").trim();
  return name || "Ashland user";
}

function readableName(
  p: { full_name: string | null; email?: string | null } | null | undefined,
  fallback = "Ashland user"
) {
  const name = (p?.full_name ?? "").trim();
  if (name) return name;
  const email = (p?.email ?? "").trim();
  if (email) return email.split("@")[0];
  return fallback;
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "A";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function normStatus(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= Date.now();
}

function isGiveClosed(item: ItemRow | null) {
  if (!item) return false;
  const st = normStatus(item.status);
  return st === "claimed" || st === "completed" || isExpired(item.expires_at);
}

function isRequestClosed(item: ItemRow | null) {
  if (!item) return false;
  const st = normStatus(item.status);
  return st === "claimed" || st === "completed" || isExpired(item.expires_at);
}

function statusChip(item: ItemRow | null) {
  const st = normStatus(item?.status);

  if (!item) return { label: "Loading", tone: "neutral" as const };
  if (isExpired(item.expires_at) && st !== "claimed" && st !== "completed") {
    return { label: "Expired", tone: "closed" as const };
  }
  if (st === "claimed" || st === "completed") return { label: "Given", tone: "closed" as const };
  if (st === "reserved") return { label: "Reserved", tone: "warn" as const };
  return { label: "Available", tone: "good" as const };
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [owner, setOwner] = useState<OwnerProfile | null>(null);

  const [loveCount, setLoveCount] = useState(0);
  const [myLoved, setMyLoved] = useState(false);

  const [interestCount, setInterestCount] = useState(0);
  const [offerCount, setOfferCount] = useState(0);

  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);
  const [myOffer, setMyOffer] = useState<MyOfferRow | null>(null);
  const [hasAcceptedOther, setHasAcceptedOther] = useState(false);

  const [completedInterest, setCompletedInterest] = useState<CompletedInterestRow | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [openImg, setOpenImg] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postType: PostType = (item?.post_type ?? "give") as PostType;
  const isAshland = !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const ownerLabel = useMemo(() => ownerNameLabel(item, owner), [item, owner]);
  const publicActivityHidden = !!item?.hide_interest_count && !isOwner;
  const itemStateChip = useMemo(() => statusChip(item), [item]);

  const isArchivedGiveOwnerView = useMemo(() => {
    return !!item && postType === "give" && isOwner && isGiveClosed(item);
  }, [item, postType, isOwner]);

  const soldToLabel = useMemo(() => {
    return readableName(completedInterest?.requester, "Recipient");
  }, [completedInterest]);

  const soldAtLabel = useMemo(() => {
    if (!completedInterest) return "—";
    return (
      completedInterest.completed_at ||
      completedInterest.reserved_at ||
      completedInterest.accepted_at ||
      item?.claimed_at ||
      null
    );
  }, [completedInterest, item?.claimed_at]);

  const subtitle = useMemo(() => {
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
      item.category?.trim() ? giveCategoryLabel(item.category) : "",
      item.pickup_location?.trim() ? item.pickup_location : "",
    ]
      .filter(Boolean)
      .join(" • ");
  }, [item, postType]);

  const activityLabel = useMemo(() => {
    if (!item) return "";
    if (publicActivityHidden) {
      return postType === "give" ? "Requests hidden" : "Offers hidden";
    }
    if (postType === "give") {
      return `${interestCount} request${interestCount === 1 ? "" : "s"}`;
    }
    return `${offerCount} offer${offerCount === 1 ? "" : "s"}`;
  }, [item, publicActivityHidden, postType, interestCount, offerCount]);

  const giveFlow = useMemo(() => {
    if (!item || postType !== "give") return null;

    const mine = normStatus(myInterest?.status);

    if (isOwner) {
      if (isGiveClosed(item)) return null;

      return {
        kind: "owner" as const,
        title: "You own this item.",
        body: "Use manage to handle requests, pickup flow, and completion.",
        primary: "Manage item",
        secondary: "Edit item",
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (!isAshland) {
      return {
        kind: "login" as const,
        title: "Log in to request this item.",
        body: "Only Ashland users can request items.",
        primary: "Log in",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (mine === "reserved") {
      return {
        kind: "reserved" as const,
        title: "Pickup confirmed.",
        body: "This item is reserved for you. Continue in chat.",
        primary: "Open chat",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (mine === "accepted") {
      return {
        kind: "accepted" as const,
        title: "Seller accepted your request.",
        body: "Open chat to continue the pickup flow.",
        primary: "Open chat",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (mine === "pending") {
      return {
        kind: "pending" as const,
        title: hasAcceptedOther
          ? "You are on the waitlist."
          : "Your request has been sent.",
        body: hasAcceptedOther
          ? "Someone else is currently being considered first."
          : "The owner has not chosen a requester yet.",
        primary: "Requested",
        secondary: "Withdraw",
        primaryDisabled: true,
        secondaryDisabled: false,
      };
    }

    if (isGiveClosed(item)) {
      return {
        kind: "closed" as const,
        title: "This item is no longer available.",
        body: "You can still view it, but requests are closed.",
        primary: "Unavailable",
        secondary: null,
        primaryDisabled: true,
        secondaryDisabled: true,
      };
    }

    if (normStatus(item.status) === "reserved") {
      return {
        kind: "reserved_other" as const,
        title: "This item is already reserved.",
        body: "A pickup is already in progress.",
        primary: "Unavailable",
        secondary: null,
        primaryDisabled: true,
        secondaryDisabled: true,
      };
    }

    if (hasAcceptedOther) {
      return {
        kind: "waitlist" as const,
        title: "Someone else is being considered.",
        body: "You can still join the waitlist in case it falls through.",
        primary: "Join waitlist",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    return {
      kind: "open" as const,
      title: "This item is open for requests.",
      body: "Send your request to start the pickup process.",
      primary: "Request item",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }, [item, postType, isOwner, isAshland, myInterest, hasAcceptedOther]);

  const requestFlow = useMemo(() => {
    if (!item || postType !== "request") return null;

    const mine = normStatus(myOffer?.status);

    if (isOwner) {
      return {
        kind: "owner" as const,
        title: "You own this request post.",
        body: "Use manage to review incoming helper offers.",
        primary: "Manage request",
        secondary: "Edit request",
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (!isAshland) {
      return {
        kind: "login" as const,
        title: "Log in to offer help.",
        body: "Only Ashland users can respond to requests.",
        primary: "Log in",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (mine === "accepted" || mine === "completed") {
      return {
        kind: "accepted" as const,
        title: "Your help offer was accepted.",
        body: "Continue in chat with the requester.",
        primary: "Open chat",
        secondary: null,
        primaryDisabled: false,
        secondaryDisabled: false,
      };
    }

    if (mine === "pending" || mine === "hold") {
      return {
        kind: "pending" as const,
        title: "Your offer is active.",
        body:
          mine === "hold"
            ? "The requester placed your offer on hold."
            : "Waiting for the requester to decide.",
        primary: "Offer sent",
        secondary: "Withdraw",
        primaryDisabled: true,
        secondaryDisabled: false,
      };
    }

    if (isRequestClosed(item)) {
      return {
        kind: "closed" as const,
        title: "This request is closed.",
        body: "New helper offers are not being accepted.",
        primary: "Closed",
        secondary: null,
        primaryDisabled: true,
        secondaryDisabled: true,
      };
    }

    return {
      kind: "open" as const,
      title: "You can offer help on this request.",
      body: "Send an offer to let the requester know you can help.",
      primary: mine === "declined" ? "Offer again" : "Offer help",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }, [item, postType, isOwner, isAshland, myOffer]);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function loadEverything(uid: string | null, email: string | null) {
    if (!itemId) return;

    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itemErr } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id,hide_interest_count,reserved_interest_id,claimed_at"
        )
        .eq("id", itemId)
        .single();

      if (itemErr) throw new Error(itemErr.message);

      const loaded = it as ItemRow;
      setItem(loaded);

      if (!loaded.is_anonymous && loaded.owner_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", loaded.owner_id)
          .maybeSingle();

        setOwner((prof as OwnerProfile) ?? null);
      } else {
        setOwner(null);
      }

      const { count: lovesCount, error: loveCountErr } = await supabase
        .from(LOVES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("item_id", itemId);

      if (!loveCountErr) setLoveCount(lovesCount ?? 0);
      else setLoveCount(0);

      if (uid) {
        const { data: mineLove, error: mineLoveErr } = await supabase
          .from(LOVES_TABLE)
          .select("item_id")
          .eq("item_id", itemId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!mineLoveErr) setMyLoved(!!mineLove);
        else setMyLoved(false);
      } else {
        setMyLoved(false);
      }

      setMyInterest(null);
      setMyOffer(null);
      setHasAcceptedOther(false);
      setInterestCount(0);
      setOfferCount(0);
      setCompletedInterest(null);

      if ((loaded.post_type ?? "give") === "give") {
        const { data: interestRows, error: interestErr } = await supabase
          .from("interests")
          .select("id,item_id,user_id,status,created_at")
          .eq("item_id", itemId);

        if (!interestErr) {
          const rows = (interestRows as MyInterestRow[]) || [];
          const active = rows.filter((row) =>
            ["pending", "accepted", "reserved"].includes(normStatus(row.status))
          );

          setInterestCount(active.length);
          setHasAcceptedOther(
            rows.some(
              (row) =>
                normStatus(row.status) === "accepted" &&
                (!!uid ? row.user_id !== uid : true)
            )
          );

          if (uid) {
            const mine =
              rows.find((row) => row.user_id === uid && normStatus(row.status) !== "withdrawn") ||
              rows.find((row) => row.user_id === uid) ||
              null;

            setMyInterest(mine);
          }
        }

        if (isGiveClosed(loaded)) {
          const { data: completedRows, error: completedErr } = await supabase
            .from("interests")
            .select(`
              id,
              item_id,
              user_id,
              status,
              completed_at,
              reserved_at,
              accepted_at,
              requester:profiles!interests_user_id_fkey(full_name,email)
            `)
            .eq("item_id", itemId)
            .in("status", ["completed", "reserved", "accepted"]);

          if (!completedErr) {
            const normalizedCompletedRows: CompletedInterestRow[] = (
              (((completedRows ?? []) as CompletedInterestQueryRow[]))
            ).map((row) => ({
              id: row.id,
              item_id: row.item_id,
              user_id: row.user_id,
              status: row.status,
              completed_at: row.completed_at,
              reserved_at: row.reserved_at,
              accepted_at: row.accepted_at,
              requester: singleRelation(row.requester),
            }));

            const candidates = normalizedCompletedRows.sort((a, b) => {
              const aTs = new Date(
                a.completed_at || a.reserved_at || a.accepted_at || "1970-01-01"
              ).getTime();
              const bTs = new Date(
                b.completed_at || b.reserved_at || b.accepted_at || "1970-01-01"
              ).getTime();
              return bTs - aTs;
            });

            const reservedMatch = loaded.reserved_interest_id
              ? candidates.find((x) => x.id === loaded.reserved_interest_id) ?? null
              : null;

            setCompletedInterest(reservedMatch ?? candidates[0] ?? null);
          }
        }
      } else {
        const { data: offerRows, error: offerErr } = await supabase
          .from("request_offers")
          .select("id,request_id,helper_id,status,created_at")
          .eq("request_id", itemId);

        if (!offerErr) {
          const rows = (offerRows as MyOfferRow[]) || [];
          const active = rows.filter((row) =>
            ["pending", "hold", "accepted"].includes(normStatus(row.status))
          );

          setOfferCount(active.length);

          if (uid) {
            const mine = rows.find((row) => row.helper_id === uid) || null;
            setMyOffer(mine);
          }
        }
      }

      setUserId(uid);
      setUserEmail(email);
    } catch (e: any) {
      setErr(e?.message || "Failed to load post.");
      setItem(null);
      setOwner(null);
      setLoveCount(0);
      setMyLoved(false);
      setInterestCount(0);
      setOfferCount(0);
      setMyInterest(null);
      setMyOffer(null);
      setHasAcceptedOther(false);
      setCompletedInterest(null);
    } finally {
      setLoading(false);
    }
  }

  async function syncAuthAndLoad() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    const email = data.session?.user?.email ?? null;
    await loadEverything(uid, email);
  }

  async function toggleLove() {
    if (!item) return;

    if (!userId) {
      router.push("/me");
      return;
    }

    setBusy(true);

    try {
      if (myLoved) {
        const { error } = await supabase
          .from(LOVES_TABLE)
          .delete()
          .eq("item_id", item.id)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);

        setMyLoved(false);
        setLoveCount((c) => Math.max(0, c - 1));
      } else {
        const { error } = await supabase.from(LOVES_TABLE).insert([
          {
            item_id: item.id,
            user_id: userId,
          },
        ]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) {
            throw new Error(error.message);
          }
        }

        setMyLoved(true);
        setLoveCount((c) => c + 1);
      }
    } catch (e: any) {
      showToast(e?.message || "Could not update love.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function openConversation() {
    if (!item || !item.owner_id || !userId) return;

    setActionBusy("chat");

    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: userId,
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(e?.message || "Could not open chat.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function submitGiveInterest() {
    if (!item || postType !== "give") return;

    if (!userId) {
      router.push("/me");
      return;
    }

    if (isOwner) return;
    if (isGiveClosed(item) || normStatus(item.status) === "reserved") {
      showToast("This item is not accepting new requests.", "err");
      return;
    }

    const mine = normStatus(myInterest?.status);

    if (mine === "accepted" || mine === "reserved") {
      await openConversation();
      return;
    }

    if (mine === "pending") return;

    setActionBusy("interest");

    try {
      if (myInterest?.id && ["withdrawn", "declined"].includes(mine)) {
        const { error } = await supabase
          .from("interests")
          .update({
            status: "pending",
            accepted_at: null,
            accepted_expires_at: null,
            reserved_at: null,
            completed_at: null,
          } as any)
          .eq("id", myInterest.id)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("interests").insert([
          {
            item_id: item.id,
            user_id: userId,
            status: "pending",
          },
        ]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) {
            throw new Error(error.message);
          }
        }
      }

      await loadEverything(userId, userEmail);
      showToast(hasAcceptedOther ? "Joined waitlist." : "Request sent.");
    } catch (e: any) {
      showToast(e?.message || "Could not send request.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function withdrawGiveInterest() {
    if (!myInterest?.id || !userId) return;
    if (normStatus(myInterest.status) !== "pending") return;

    setActionBusy("withdraw-interest");

    try {
      const { error } = await supabase
        .from("interests")
        .update({ status: "withdrawn" })
        .eq("id", myInterest.id)
        .eq("user_id", userId);

      if (error) throw new Error(error.message);

      await loadEverything(userId, userEmail);
      showToast("Request withdrawn.");
    } catch (e: any) {
      showToast(e?.message || "Could not withdraw request.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function submitHelpOffer() {
    if (!item || postType !== "request") return;

    if (!userId) {
      router.push("/me");
      return;
    }

    if (isOwner) return;
    if (isRequestClosed(item)) {
      showToast("This request is closed.", "err");
      return;
    }

    const mine = normStatus(myOffer?.status);

    if (mine === "accepted" || mine === "completed") {
      await openConversation();
      return;
    }

    if (mine === "pending" || mine === "hold") return;

    setActionBusy("offer");

    try {
      if (myOffer?.id && mine === "declined") {
        const { error } = await supabase
          .from("request_offers")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", myOffer.id)
          .eq("helper_id", userId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("request_offers").insert([
          {
            request_id: item.id,
            helper_id: userId,
            status: "pending",
          },
        ]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) {
            throw new Error(error.message);
          }
        }
      }

      await loadEverything(userId, userEmail);
      showToast("Offer sent.");
    } catch (e: any) {
      showToast(e?.message || "Could not send offer.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function withdrawHelpOffer() {
    if (!myOffer?.id || !userId) return;

    const mine = normStatus(myOffer.status);
    if (!["pending", "hold"].includes(mine)) return;

    setActionBusy("withdraw-offer");

    try {
      const { error } = await supabase
        .from("request_offers")
        .delete()
        .eq("id", myOffer.id)
        .eq("helper_id", userId);

      if (error) throw new Error(error.message);

      await loadEverything(userId, userEmail);
      showToast("Offer withdrawn.");
    } catch (e: any) {
      showToast(e?.message || "Could not withdraw offer.", "err");
    } finally {
      setActionBusy(null);
    }
  }

  async function toggleCountVisibility() {
    if (!item || !isOwner || !userId || isArchivedGiveOwnerView) return;

    const nextValue = !item.hide_interest_count;
    setBusy(true);
    setMenuOpen(false);

    try {
      const { error } = await supabase
        .from("items")
        .update({ hide_interest_count: nextValue })
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      setItem((prev) => (prev ? { ...prev, hide_interest_count: nextValue } : prev));
      showToast(nextValue ? "Count hidden." : "Count shown.");
    } catch (e: any) {
      showToast(e?.message || "Could not update count visibility.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function deleteListing() {
    if (!item || !isOwner || !userId) return;

    setBusy(true);

    try {
      if (postType === "give") {
        await supabase.from("interests").delete().eq("item_id", item.id);
      } else {
        await supabase.from("request_offers").delete().eq("request_id", item.id);
      }

      await supabase.from(LOVES_TABLE).delete().eq("item_id", item.id);

      const { error } = await supabase
        .from("items")
        .delete()
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      showToast("Listing deleted.");
      router.replace("/feed");
    } catch (e: any) {
      showToast(e?.message || "Could not delete listing.", "err");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  useEffect(() => {
    void syncAuthAndLoad();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
      await loadEverything(uid, email);
    });

    return () => sub.subscription.unsubscribe();
  }, [itemId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setOpenImg(null);
        setConfirmDelete(false);
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

  return (
    <div className={`page page-${postType}`}>
      <div className="shell">
        <header className="topBar">
          <button className="iconBtn" onClick={() => router.back()} aria-label="Back" type="button">
            ←
          </button>

          <div className="topCenter">
            <div className="topTitle">Post</div>
            <div className="topSub">scholarswap</div>
          </div>

          <div className="topRightSpace" />
        </header>

        {err && <div className="alert err">{err}</div>}
        {loading && <div className="alert">Loading…</div>}
        {!loading && !err && !item && <div className="alert err">Post not found.</div>}

        {!loading && item && (
          <section className={`card card-${postType}`}>
            <div className="cardTop">
              <div className="authorSide">
                <div className={`avatar avatar-${postType}`}>{initials(ownerLabel)}</div>

                <div className="authorText">
                  <div className="authorName">{ownerLabel}</div>
                  {subtitle ? <div className="authorSub">{subtitle}</div> : null}
                </div>
              </div>

              {isOwner ? (
                <div className="menuWrap">
                  {menuOpen ? (
                    <button
                      className="menuBackdrop"
                      aria-label="Close menu"
                      onClick={() => setMenuOpen(false)}
                      type="button"
                    />
                  ) : null}

                  <button
                    className="menuBtn"
                    type="button"
                    aria-label="Post options"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    ⋯
                  </button>

                  {menuOpen ? (
                    <div className="menuCard">
                      {!isArchivedGiveOwnerView ? (
                        <>
                          <button
                            className="menuItem"
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              router.push(`/manage/${item.id}`);
                            }}
                          >
                            Manage post
                          </button>

                          <button
                            className="menuItem"
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              router.push(`/item/${item.id}/edit`);
                            }}
                          >
                            Edit post
                          </button>

                          <button className="menuItem" type="button" onClick={toggleCountVisibility}>
                            {item.hide_interest_count ? "Show count" : "Hide count"}
                          </button>
                        </>
                      ) : null}

                      <button
                        className="menuItem danger"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDelete(true);
                        }}
                      >
                        Delete listing
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  className={`loveBtn ${myLoved ? "active" : ""}`}
                  type="button"
                  onClick={toggleLove}
                  disabled={busy}
                  aria-label="Love post"
                >
                  {myLoved ? "♥" : "♡"}
                </button>
              )}
            </div>

            <div className="mediaWrap">
              {item.photo_url ? (
                <button className="imgBtn" type="button" onClick={() => setOpenImg(item.photo_url)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.photo_url} alt={item.title} className="heroImg" />
                </button>
              ) : (
                <div className={`noPhoto noPhoto-${postType}`}>No image</div>
              )}
            </div>

            <div className="body">
              <div className="titleRow">
                <h1 className="title">{item.title}</h1>

                {!isOwner ? (
                  <button
                    className={`loveBtn small ${myLoved ? "active" : ""}`}
                    type="button"
                    onClick={toggleLove}
                    disabled={busy}
                    aria-label="Love post"
                  >
                    {myLoved ? "♥" : "♡"}
                  </button>
                ) : null}
              </div>

              <div className="statsRow">
                <span className="stat">
                  <span className="statIcon">♥</span> {loveCount}
                </span>

                <span className="dot">•</span>

                <span className="stat">{activityLabel}</span>

                <span className="dot">•</span>

                <span className={`statusPill ${itemStateChip.tone} ${postType}`}>
                  {itemStateChip.label}
                </span>

                <span className="dot">•</span>

                <span className="stat">Delists {formatDelist(item.expires_at)}</span>
              </div>

              {isArchivedGiveOwnerView ? (
                <div className="archivedCard">
                  <div className="archivedTitle">Archived handoff</div>
                  <div className="archivedBody">
                    This item has already been given away. Editing and management are disabled.
                  </div>

                  <div className="archivedMetaGrid">
                    <div className="archivedMetaBox">
                      <div className="archivedMetaLabel">Given to</div>
                      <div className="archivedMetaValue">{soldToLabel}</div>
                    </div>

                    <div className="archivedMetaBox">
                      <div className="archivedMetaLabel">Given on</div>
                      <div className="archivedMetaValue">{formatFullWhen(soldAtLabel)}</div>
                    </div>
                  </div>
                </div>
              ) : (postType === "give" && giveFlow) || (postType === "request" && requestFlow) ? (
                <div className={`flowCard flowCard-${postType}`}>
                  <div className="flowTitle">
                    {postType === "give" ? giveFlow?.title : requestFlow?.title}
                  </div>
                  <div className="flowBody">
                    {postType === "give" ? giveFlow?.body : requestFlow?.body}
                  </div>

                  <div className="flowActions">
                    {postType === "give" && giveFlow ? (
                      <>
                        <button
                          className={`primaryAction primaryAction-${postType}`}
                          type="button"
                          disabled={giveFlow.primaryDisabled || !!actionBusy}
                          onClick={() => {
                            if (giveFlow.kind === "owner") {
                              router.push(`/manage/${item.id}`);
                              return;
                            }
                            if (giveFlow.kind === "login") {
                              router.push("/me");
                              return;
                            }
                            if (giveFlow.kind === "accepted" || giveFlow.kind === "reserved") {
                              void openConversation();
                              return;
                            }
                            if (giveFlow.kind === "open" || giveFlow.kind === "waitlist") {
                              void submitGiveInterest();
                            }
                          }}
                        >
                          {actionBusy === "chat"
                            ? "Opening…"
                            : actionBusy === "interest"
                            ? "Sending…"
                            : giveFlow.primary}
                        </button>

                        {giveFlow.secondary ? (
                          <button
                            className="secondaryAction"
                            type="button"
                            disabled={giveFlow.secondaryDisabled || !!actionBusy}
                            onClick={() => {
                              if (giveFlow.kind === "owner") {
                                router.push(`/item/${item.id}/edit`);
                                return;
                              }
                              if (giveFlow.kind === "pending") {
                                void withdrawGiveInterest();
                              }
                            }}
                          >
                            {actionBusy === "withdraw-interest" ? "Working…" : giveFlow.secondary}
                          </button>
                        ) : null}
                      </>
                    ) : null}

                    {postType === "request" && requestFlow ? (
                      <>
                        <button
                          className={`primaryAction primaryAction-${postType}`}
                          type="button"
                          disabled={requestFlow.primaryDisabled || !!actionBusy}
                          onClick={() => {
                            if (requestFlow.kind === "owner") {
                              router.push(`/manage/${item.id}`);
                              return;
                            }
                            if (requestFlow.kind === "login") {
                              router.push("/me");
                              return;
                            }
                            if (requestFlow.kind === "accepted") {
                              void openConversation();
                              return;
                            }
                            if (requestFlow.kind === "open") {
                              void submitHelpOffer();
                            }
                          }}
                        >
                          {actionBusy === "chat"
                            ? "Opening…"
                            : actionBusy === "offer"
                            ? "Sending…"
                            : requestFlow.primary}
                        </button>

                        {requestFlow.secondary ? (
                          <button
                            className="secondaryAction"
                            type="button"
                            disabled={requestFlow.secondaryDisabled || !!actionBusy}
                            onClick={() => {
                              if (requestFlow.kind === "owner") {
                                router.push(`/item/${item.id}/edit`);
                                return;
                              }
                              if (requestFlow.kind === "pending") {
                                void withdrawHelpOffer();
                              }
                            }}
                          >
                            {actionBusy === "withdraw-offer" ? "Working…" : requestFlow.secondary}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {item.description?.trim() ? (
                <div className="caption">
                  <span className="captionName">{ownerLabel}</span> {item.description.trim()}
                </div>
              ) : null}

              {postType === "request" ? (
                <div className="requestInfo">
                  {item.request_timeframe ? (
                    <span className="infoPill">{requestTimeframeLabel(item.request_timeframe)}</span>
                  ) : null}
                  {item.request_location?.trim() ? (
                    <span className="infoPill">{item.request_location.trim()}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>

      {confirmDelete ? (
        <div className="modal" onClick={() => setConfirmDelete(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete listing?</div>
            <div className="modalText">This permanently removes the post.</div>

            <div className="modalActions">
              <button className="ghostBtn" onClick={() => setConfirmDelete(false)} type="button">
                Cancel
              </button>
              <button className="dangerBtn" onClick={deleteListing} disabled={busy} type="button">
                {busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openImg && item ? (
        <div className="imgModal" onClick={() => setOpenImg(null)}>
          <div className="imgCard" onClick={(e) => e.stopPropagation()}>
            <div className="imgTop">
              <div className="imgTitle">{item.title}</div>
              <button className="iconGhost" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={item.title} className="imgFull" />
          </div>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.kind === "err" ? "err" : "ok"}`}>{toast.msg}</div> : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          color: #0f172a;
          padding: 12px 12px 28px;
        }

        .page-give {
          background: #f7f8f7;
        }

        .page-request {
          background: #fbf8f3;
        }

        .shell {
          max-width: 760px;
          margin: 0 auto;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          grid-template-columns: 42px 1fr 42px;
          align-items: center;
          gap: 10px;
          padding: 6px 0 12px;
          backdrop-filter: blur(12px);
        }

        .page-give .topBar {
          background: rgba(247, 248, 247, 0.9);
        }

        .page-request .topBar {
          background: rgba(251, 248, 243, 0.9);
        }

        .iconBtn,
        .iconGhost {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
        }

        .topCenter {
          text-align: center;
          min-width: 0;
        }

        .topTitle {
          font-size: 16px;
          font-weight: 1000;
          line-height: 1.1;
        }

        .topSub {
          margin-top: 2px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
        }

        .topRightSpace {
          width: 42px;
          height: 42px;
        }

        .alert {
          margin: 8px 0 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 11px 13px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .alert.err {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .card {
          margin-top: 8px;
          background: #fff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
        }

        .card-give {
          border: 1px solid rgba(16, 185, 129, 0.2);
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.04), #ffffff 34%);
        }

        .card-request {
          border: 1px solid rgba(245, 158, 11, 0.22);
          background: linear-gradient(180deg, rgba(245, 158, 11, 0.04), #ffffff 34%);
        }

        .cardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid #eef2f7;
        }

        .authorSide {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 1000;
          flex: 0 0 auto;
        }

        .avatar-give {
          border: 1px solid rgba(16, 185, 129, 0.18);
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), #f0fdf4 100%);
          color: #065f46;
        }

        .avatar-request {
          border: 1px solid rgba(245, 158, 11, 0.18);
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), #fffbeb 100%);
          color: #92400e;
        }

        .authorText {
          min-width: 0;
        }

        .authorName {
          font-size: 13px;
          font-weight: 1000;
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .authorSub {
          margin-top: 4px;
          font-size: 11px;
          color: #64748b;
          font-weight: 700;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .menuWrap {
          position: relative;
          flex: 0 0 auto;
        }

        .menuBtn,
        .loveBtn {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 22px;
          line-height: 1;
          font-weight: 900;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .loveBtn.active {
          color: #dc2626;
          border-color: #fecaca;
          background: #fff5f5;
        }

        .loveBtn.small {
          width: 34px;
          height: 34px;
          font-size: 19px;
        }

        .menuBackdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          border: 0;
          padding: 0;
          margin: 0;
        }

        .menuCard {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 200px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.14);
          z-index: 30;
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

        .mediaWrap {
          background: #f8fafc;
        }

        .imgBtn {
          display: block;
          width: 100%;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .heroImg {
          width: 100%;
          height: 420px;
          object-fit: cover;
          display: block;
        }

        .noPhoto {
          height: 220px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }

        .noPhoto-give {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), #f8fafc);
        }

        .noPhoto-request {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), #f8fafc);
        }

        .body {
          padding: 14px 14px 16px;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .title {
          margin: 0;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 1000;
          letter-spacing: -0.04em;
          overflow-wrap: anywhere;
          flex: 1;
          min-width: 0;
        }

        .statsRow {
          margin-top: 10px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          color: #475569;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.4;
        }

        .stat {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .statIcon {
          color: #dc2626;
        }

        .dot {
          color: #cbd5e1;
        }

        .statusPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
        }

        .statusPill.good.give,
        .statusPill.good.request {
          color: #166534;
          border-color: #bbf7d0;
          background: #ecfdf5;
        }

        .statusPill.warn.give,
        .statusPill.warn.request {
          color: #92400e;
          border-color: #fde68a;
          background: #fffbeb;
        }

        .statusPill.closed,
        .statusPill.neutral {
          color: #475569;
          border-color: #e5e7eb;
          background: #f8fafc;
        }

        .flowCard,
        .archivedCard {
          margin-top: 14px;
          padding: 14px;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
        }

        .flowCard-give {
          border-color: rgba(16, 185, 129, 0.16);
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.06), #f8fafc);
        }

        .flowCard-request {
          border-color: rgba(245, 158, 11, 0.16);
          background: linear-gradient(180deg, rgba(245, 158, 11, 0.06), #fffaf0);
        }

        .archivedCard {
          border-color: #dbe4ee;
          background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        }

        .flowTitle,
        .archivedTitle {
          font-size: 14px;
          font-weight: 1000;
          color: #0f172a;
        }

        .flowBody,
        .archivedBody {
          margin-top: 5px;
          font-size: 13px;
          line-height: 1.5;
          color: #475569;
          font-weight: 700;
        }

        .archivedMetaGrid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .archivedMetaBox {
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 12px;
        }

        .archivedMetaLabel {
          font-size: 11px;
          font-weight: 900;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .archivedMetaValue {
          margin-top: 6px;
          font-size: 14px;
          line-height: 1.4;
          font-weight: 900;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .flowActions {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .primaryAction,
        .secondaryAction {
          min-height: 42px;
          padding: 0 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .primaryAction-give {
          border: 1px solid rgba(16, 185, 129, 0.26);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }

        .primaryAction-request {
          border: 1px solid rgba(245, 158, 11, 0.26);
          background: rgba(245, 158, 11, 0.12);
          color: #92400e;
        }

        .secondaryAction {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .primaryAction:disabled,
        .secondaryAction:disabled {
          opacity: 0.58;
          cursor: not-allowed;
        }

        .caption {
          margin-top: 12px;
          font-size: 13px;
          line-height: 1.58;
          color: #334155;
          white-space: pre-wrap;
        }

        .captionName {
          color: #0f172a;
          font-weight: 1000;
        }

        .requestInfo {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .infoPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(245, 158, 11, 0.2);
          background: rgba(245, 158, 11, 0.1);
          color: #92400e;
          font-size: 11px;
          font-weight: 900;
        }

        .modal,
        .imgModal {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(15, 23, 42, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modalCard,
        .imgCard {
          width: 100%;
          max-width: 520px;
          border-radius: 22px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
        }

        .modalCard {
          padding: 16px;
        }

        .modalTitle {
          font-size: 16px;
          font-weight: 1000;
          color: #0f172a;
        }

        .modalText {
          margin-top: 8px;
          font-size: 13px;
          color: #475569;
          font-weight: 700;
          line-height: 1.45;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .ghostBtn,
        .dangerBtn {
          border-radius: 14px;
          padding: 10px 13px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .ghostBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .dangerBtn {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
        }

        .imgTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .imgTitle {
          font-size: 13px;
          font-weight: 1000;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imgFull {
          display: block;
          width: 100%;
          max-height: 80vh;
          object-fit: contain;
          background: #111827;
        }

        .toast {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 120;
          max-width: calc(100vw - 24px);
          padding: 10px 13px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.14);
        }

        .toast.ok {
          border-color: #bbf7d0;
        }

        .toast.err {
          border-color: #fecdd3;
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 320px;
          }

          .title {
            font-size: 20px;
          }

          .authorSub {
            white-space: normal;
          }

          .statsRow {
            gap: 6px;
          }

          .dot {
            display: none;
          }

          .stat {
            width: 100%;
          }

          .flowActions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .primaryAction,
          .secondaryAction {
            width: 100%;
          }

          .archivedMetaGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}