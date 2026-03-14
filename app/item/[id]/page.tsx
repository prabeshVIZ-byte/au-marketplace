"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread } from "@/lib/ensureThread";

const LOVES_TABLE = "post_likes";

/* =========================
   TYPES
========================= */

type PostType = "give" | "request";

type InterestStatus =
  | "pending"
  | "accepted"
  | "reserved"
  | "declined"
  | "withdrawn"
  | "expired"
  | "completed"
  | null;

type OfferStatus =
  | "pending"
  | "hold"
  | "accepted"
  | "declined"
  | "completed"
  | null;

type ItemStatus =
  | "available"
  | "reserved"
  | "claimed"
  | "completed"
  | string
  | null;

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
  request_willing_to_pay: boolean | null;
  request_budget: number | null;

  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: ItemStatus;
  owner_id: string | null;
  price: number | null;
  is_negotiable: boolean | null;
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
  status: InterestStatus;
  created_at: string | null;
};

type MyOfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus;
  created_at: string | null;
};

type CompletedInterestQueryRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: InterestStatus;
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
  status: InterestStatus;
  completed_at: string | null;
  reserved_at: string | null;
  accepted_at: string | null;
  requester: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type LoadedItemDetail = {
  item: ItemRow | null;
  owner: OwnerProfile | null;
  loveCount: number;
  myLoved: boolean;
  interestCount: number;
  offerCount: number;
  myInterest: MyInterestRow | null;
  myOffer: MyOfferRow | null;
  hasAcceptedOther: boolean;
  completedInterest: CompletedInterestRow | null;
};

type ToastState = {
  msg: string;
  kind: "ok" | "err";
} | null;

type FlowConfig = {
  kind:
    | "owner"
    | "login"
    | "reserved"
    | "accepted"
    | "pending"
    | "closed"
    | "reserved_other"
    | "waitlist"
    | "open";
  title: string;
  body: string;
  primary: string;
  secondary: string | null;
  primaryDisabled: boolean;
  secondaryDisabled: boolean;
};

type SlideActionProps = {
  label: string;
  sentLabel: string;
  busyLabel: string;
  disabled?: boolean;
  busy?: boolean;
  tone: "give" | "request";
  successKey: string;
  activeSuccessKey: string | null;
  onComplete: () => Promise<void> | void;
};

/* =========================
   HELPERS
========================= */

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normStatus(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase();
}

function requestGroupLabel(v: string | null) {
  const k = normStatus(v);
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  if (k === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(v: string | null) {
  const k = normStatus(v);
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

function formatPrice(price: number | null | undefined) {
  if (price === null || price === undefined) return "Free";
  const n = Number(price);
  if (!Number.isFinite(n)) return "Free";
  return `$${n.toFixed(2)}`;
}

function formatPriceWithNegotiable(
  price: number | null | undefined,
  isNegotiable: boolean | null | undefined
) {
  const base = formatPrice(price);
  if (price === null || price === undefined) return base;
  return isNegotiable ? `${base} • Negotiable` : `${base} • Fixed`;
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

function getStatusChip(item: ItemRow | null) {
  if (!item) return { label: "Loading", tone: "neutral" as const };

  const st = normStatus(item.status);
  const isGive = (item.post_type ?? "give") === "give";

  if (isExpired(item.expires_at) && st !== "claimed" && st !== "completed") {
    return { label: "Expired", tone: "closed" as const };
  }

  if (st === "reserved") {
    return {
      label: isGive ? "Reserved" : "In progress",
      tone: "warn" as const,
    };
  }

  if (st === "claimed" || st === "completed") {
    return {
      label: isGive ? "Given" : "Fulfilled",
      tone: "closed" as const,
    };
  }

  return {
    label: isGive ? "Available" : "Open",
    tone: "good" as const,
  };
}

function getSubtitle(item: ItemRow | null, postType: PostType) {
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
}

function getActivityLabel(args: {
  item: ItemRow | null;
  publicActivityHidden: boolean;
  postType: PostType;
  interestCount: number;
  offerCount: number;
}) {
  const { item, publicActivityHidden, postType, interestCount, offerCount } = args;
  if (!item) return "";

  if (publicActivityHidden) {
    return postType === "give" ? "Requests hidden" : "Offers hidden";
  }

  if (postType === "give") {
    return `${interestCount} request${interestCount === 1 ? "" : "s"}`;
  }

  return `${offerCount} offer${offerCount === 1 ? "" : "s"}`;
}

function getGiveFlow(args: {
  item: ItemRow | null;
  isOwner: boolean;
  isAshland: boolean;
  myInterest: MyInterestRow | null;
  hasAcceptedOther: boolean;
}): FlowConfig | null {
  const { item, isOwner, isAshland, myInterest, hasAcceptedOther } = args;
  if (!item || (item.post_type ?? "give") !== "give") return null;

  const mine = normStatus(myInterest?.status);

  if (isOwner) {
    if (isGiveClosed(item)) return null;

    return {
      kind: "owner",
      title: "You own this item",
      body: "Review requests, manage pickup, or update the listing.",
      primary: "Manage item",
      secondary: "Edit item",
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (!isAshland) {
    return {
      kind: "login",
      title: "Log in to request this item",
      body: "Only Ashland users can request items.",
      primary: "Log in",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (mine === "reserved") {
    return {
      kind: "reserved",
      title: "Pickup confirmed",
      body: "This item is reserved for you. Continue in chat.",
      primary: "Open chat",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (mine === "accepted") {
    return {
      kind: "accepted",
      title: "Your request was accepted",
      body: "Open chat to continue the handoff.",
      primary: "Open chat",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (mine === "pending") {
    return {
      kind: "pending",
      title: hasAcceptedOther ? "You are on the waitlist" : "Request sent",
      body: hasAcceptedOther
        ? "The owner is already working with another requester, but you are still in line."
        : "The owner has not picked a requester yet.",
      primary: "Requested",
      secondary: "Withdraw",
      primaryDisabled: true,
      secondaryDisabled: false,
    };
  }

  if (isGiveClosed(item)) {
    return {
      kind: "closed",
      title: "This item is no longer available",
      body: "Requests are closed for this listing.",
      primary: "Unavailable",
      secondary: null,
      primaryDisabled: true,
      secondaryDisabled: true,
    };
  }

  if (normStatus(item.status) === "reserved") {
    return {
      kind: "reserved_other",
      title: "This item is already reserved",
      body: "A handoff is already in progress.",
      primary: "Unavailable",
      secondary: null,
      primaryDisabled: true,
      secondaryDisabled: true,
    };
  }

  if (hasAcceptedOther) {
    return {
      kind: "waitlist",
      title: "Waitlist only",
      body: "Another requester is currently being considered, but you can still join the backup queue.",
      primary: "slide to send your request",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  return {
    kind: "open",
    title: "This item is available",
    body: "Slide to send your request.",
    primary: "slide to send your request",
    secondary: null,
    primaryDisabled: false,
    secondaryDisabled: false,
  };
}

function getRequestFlow(args: {
  item: ItemRow | null;
  isOwner: boolean;
  isAshland: boolean;
  myOffer: MyOfferRow | null;
}): FlowConfig | null {
  const { item, isOwner, isAshland, myOffer } = args;
  if (!item || (item.post_type ?? "give") !== "request") return null;

  const mine = normStatus(myOffer?.status);

  if (isOwner) {
    if (isRequestClosed(item)) return null;

    return {
      kind: "owner",
      title: "You own this request",
      body: "Review helper offers or update the request.",
      primary: "Manage request",
      secondary: "Edit request",
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (!isAshland) {
    return {
      kind: "login",
      title: "Log in to offer help",
      body: "Only Ashland users can respond to requests.",
      primary: "Log in",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (mine === "accepted" || mine === "completed") {
    return {
      kind: "accepted",
      title: "Your offer was accepted",
      body: "Continue in chat with the requester.",
      primary: "Open chat",
      secondary: null,
      primaryDisabled: false,
      secondaryDisabled: false,
    };
  }

  if (mine === "pending" || mine === "hold") {
    return {
      kind: "pending",
      title: "Your offer is active",
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
      kind: "closed",
      title: "This request is closed",
      body: "New helper offers are not being accepted.",
      primary: "Closed",
      secondary: null,
      primaryDisabled: true,
      secondaryDisabled: true,
    };
  }

  return {
    kind: "open",
    title: "You can help with this request",
    body: "Slide to send your offer.",
    primary: "slide to offer help",
    secondary: null,
    primaryDisabled: false,
    secondaryDisabled: false,
  };
}

async function loadItemDetail(itemId: string, uid: string | null): Promise<LoadedItemDetail> {
  const { data: it, error: itemErr } = await supabase
    .from("items")
    .select(
      "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,request_willing_to_pay,request_budget,is_anonymous,expires_at,photo_url,status,owner_id,price,is_negotiable,hide_interest_count,reserved_interest_id,claimed_at"
    )
    .eq("id", itemId)
    .single();

  if (itemErr) throw new Error(itemErr.message);

  const item = it as ItemRow;

  let owner: OwnerProfile | null = null;
  if (!item.is_anonymous && item.owner_id) {
    const { data: prof, error: ownerErr } = await supabase
      .from("profiles")
      .select("full_name,user_role")
      .eq("id", item.owner_id)
      .maybeSingle();

    if (ownerErr) throw new Error(ownerErr.message);
    owner = (prof as OwnerProfile) ?? null;
  }

  const { count: lovesCount, error: loveCountErr } = await supabase
    .from(LOVES_TABLE)
    .select("*", { count: "exact", head: true })
    .eq("item_id", itemId);

  if (loveCountErr) throw new Error(loveCountErr.message);

  let myLoved = false;
  if (uid) {
    const { data: mineLove, error: mineLoveErr } = await supabase
      .from(LOVES_TABLE)
      .select("item_id")
      .eq("item_id", itemId)
      .eq("user_id", uid)
      .maybeSingle();

    if (mineLoveErr) throw new Error(mineLoveErr.message);
    myLoved = !!mineLove;
  }

  let interestCount = 0;
  let offerCount = 0;
  let myInterest: MyInterestRow | null = null;
  let myOffer: MyOfferRow | null = null;
  let hasAcceptedOther = false;
  let completedInterest: CompletedInterestRow | null = null;

  if ((item.post_type ?? "give") === "give") {
    const { data: interestRows, error: interestErr } = await supabase
      .from("interests")
      .select("id,item_id,user_id,status,created_at")
      .eq("item_id", itemId);

    if (interestErr) throw new Error(interestErr.message);

    const rows = ((interestRows ?? []) as MyInterestRow[]) || [];
    const active = rows.filter((row) =>
      ["pending", "accepted", "reserved"].includes(normStatus(row.status))
    );

    interestCount = active.length;
    hasAcceptedOther = rows.some(
      (row) =>
        normStatus(row.status) === "accepted" &&
        (!!uid ? row.user_id !== uid : true)
    );

    if (uid) {
      myInterest =
        rows.find((row) => row.user_id === uid && normStatus(row.status) !== "withdrawn") ||
        rows.find((row) => row.user_id === uid) ||
        null;
    }

    if (isGiveClosed(item)) {
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

      if (completedErr) throw new Error(completedErr.message);

      const normalizedCompletedRows: CompletedInterestRow[] = (
        ((completedRows ?? []) as CompletedInterestQueryRow[])
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

      const reservedMatch = item.reserved_interest_id
        ? candidates.find((x) => x.id === item.reserved_interest_id) ?? null
        : null;

      completedInterest = reservedMatch ?? candidates[0] ?? null;
    }
  } else {
    const { data: offerRows, error: offerErr } = await supabase
      .from("request_offers")
      .select("id,request_id,helper_id,status,created_at")
      .eq("request_id", itemId);

    if (offerErr) throw new Error(offerErr.message);

    const rows = ((offerRows ?? []) as MyOfferRow[]) || [];
    const active = rows.filter((row) =>
      ["pending", "hold", "accepted"].includes(normStatus(row.status))
    );

    offerCount = active.length;

    if (uid) {
      myOffer = rows.find((row) => row.helper_id === uid) || null;
    }
  }

  return {
    item,
    owner,
    loveCount: lovesCount ?? 0,
    myLoved,
    interestCount,
    offerCount,
    myInterest,
    myOffer,
    hasAcceptedOther,
    completedInterest,
  };
}

/* =========================
   SLIDE ACTION
========================= */

function SlideAction({
  label,
  sentLabel,
  busyLabel,
  disabled = false,
  busy = false,
  tone,
  successKey,
  activeSuccessKey,
  onComplete,
}: SlideActionProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const knobSize = 64;
  const threshold = 0.84;

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [localSuccess, setLocalSuccess] = useState(false);

  const isSuccess = activeSuccessKey === successKey || localSuccess;

  const getMaxOffset = () => {
    const trackWidth = trackRef.current?.offsetWidth ?? 0;
    return Math.max(0, trackWidth - knobSize - 12);
  };

  useEffect(() => {
    if (busy || isSuccess) {
      setOffset(getMaxOffset());
    } else if (!dragging) {
      setOffset(0);
    }
  }, [busy, isSuccess, dragging]);

  const beginDrag = () => {
    if (disabled || busy || isSuccess) return;
    setDragging(true);
  };

  const updateDrag = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const max = getMaxOffset();
    const raw = clientX - rect.left - knobSize / 2;
    const next = Math.min(Math.max(0, raw), max);
    setOffset(next);
  };

  const endDrag = async () => {
    if (!dragging) return;
    setDragging(false);

    const max = getMaxOffset();
    const ratio = max <= 0 ? 0 : offset / max;

    if (ratio >= threshold) {
      setOffset(max);
      try {
        await onComplete();
        setLocalSuccess(true);
      } catch {
        setLocalSuccess(false);
        setOffset(0);
      }
    } else {
      setOffset(0);
    }
  };

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => updateDrag(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      const point = e.touches[0];
      if (!point) return;
      updateDrag(point.clientX);
    };
    const onMouseUp = () => void endDrag();
    const onTouchEnd = () => void endDrag();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [dragging, offset]);

  return (
    <>
      <div
        ref={trackRef}
        className={`slideAction slideAction-${tone} ${disabled ? "disabled" : ""} ${busy ? "busy" : ""} ${isSuccess ? "done" : ""}`}
        aria-disabled={disabled || busy || isSuccess}
      >
        <div className="slideText">
          {busy ? busyLabel : isSuccess ? sentLabel : label}
        </div>

        {!busy && !isSuccess ? <div className="slideTextGlow" /> : null}

        <button
          type="button"
          className="slideKnob"
          onMouseDown={beginDrag}
          onTouchStart={beginDrag}
          onDragStart={(e) => e.preventDefault()}
          disabled={disabled || busy || isSuccess}
          aria-label={label}
          style={{ transform: `translateX(${offset}px)` }}
        >
          <span className={`slideKnobGlyph ${tone}`}>
            {isSuccess ? "✓" : "➜"}
          </span>
        </button>
      </div>

      <style jsx>{`
        .slideAction {
          position: relative;
          width: min(100%, 430px);
          height: 76px;
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(196, 181, 253, 0.55);
          background: linear-gradient(90deg, #c084fc 0%, #d8b4fe 45%, #f9a8d4 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.4),
            0 12px 28px rgba(168, 85, 247, 0.18);
          flex: 0 0 auto;
        }

        .slideAction-give {
          background: linear-gradient(90deg, #c084fc 0%, #d8b4fe 45%, #f9a8d4 100%);
        }

        .slideAction-request {
          background: linear-gradient(90deg, #c4b5fd 0%, #e9d5ff 48%, #fbcfe8 100%);
        }

        .slideAction.disabled,
        .slideAction.busy {
          opacity: 0.72;
        }

        .slideText {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 26px 0 102px;
          font-size: 16px;
          font-weight: 500;
          letter-spacing: -0.02em;
          color: rgba(30, 20, 44, 0.88);
          white-space: nowrap;
          user-select: none;
          pointer-events: none;
          z-index: 1;
        }

        .slideTextGlow {
          position: absolute;
          top: 10px;
          bottom: 10px;
          left: 98px;
          width: 130px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.3) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          filter: blur(8px);
          animation: slideGlow 2s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }

        .slideKnob {
          position: absolute;
          top: 6px;
          left: 6px;
          width: 64px;
          height: 64px;
          border-radius: 999px;
          border: 0;
          background: linear-gradient(180deg, #ffffff 0%, #f7f7fb 100%);
          box-shadow:
            0 8px 22px rgba(76, 29, 149, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
          display: grid;
          place-items: center;
          cursor: grab;
          touch-action: none;
          z-index: 2;
          transition: transform 0.18s ease;
        }

        .slideKnob:active {
          cursor: grabbing;
        }

        .slideKnob:disabled {
          cursor: not-allowed;
        }

        .slideKnobGlyph {
          font-size: 24px;
          line-height: 1;
          font-weight: 900;
          transform: translateX(1px);
        }

        .slideKnobGlyph.give {
          color: #22c55e;
        }

        .slideKnobGlyph.request {
          color: #f97316;
        }

        .slideAction.done .slideKnobGlyph {
          color: #16a34a;
          transform: none;
        }

        @keyframes slideGlow {
          0%,
          100% {
            opacity: 0.45;
            transform: translateX(0);
          }
          50% {
            opacity: 0.95;
            transform: translateX(20px);
          }
        }

        @media (max-width: 720px) {
          .slideAction {
            width: 100%;
            height: 72px;
          }

          .slideText {
            padding: 0 18px 0 96px;
            font-size: 15px;
          }

          .slideKnob {
            width: 60px;
            height: 60px;
          }

          .slideTextGlow {
            left: 92px;
            width: 100px;
          }
        }
      `}</style>
    </>
  );
}

/* =========================
   PAGE
========================= */

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
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
  const [toast, setToast] = useState<ToastState>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postType: PostType = (item?.post_type ?? "give") as PostType;
  const isAshland = !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const ownerLabel = useMemo(() => ownerNameLabel(item, owner), [item, owner]);
  const publicActivityHidden = !!item?.hide_interest_count && !isOwner;
  const itemStateChip = useMemo(() => getStatusChip(item), [item]);

  const isArchivedGiveOwnerView = useMemo(() => {
    return !!item && postType === "give" && isOwner && isGiveClosed(item);
  }, [item, postType, isOwner]);

  const soldToLabel = useMemo(() => {
    return readableName(completedInterest?.requester, "Recipient");
  }, [completedInterest]);

  const soldAtLabel = useMemo(() => {
    if (!completedInterest) return item?.claimed_at || null;
    return (
      completedInterest.completed_at ||
      completedInterest.reserved_at ||
      completedInterest.accepted_at ||
      item?.claimed_at ||
      null
    );
  }, [completedInterest, item?.claimed_at]);

  const subtitle = useMemo(() => getSubtitle(item, postType), [item, postType]);

  const activityLabel = useMemo(() => {
    return getActivityLabel({
      item,
      publicActivityHidden,
      postType,
      interestCount,
      offerCount,
    });
  }, [item, publicActivityHidden, postType, interestCount, offerCount]);

  const giveFlow = useMemo(() => {
    return getGiveFlow({
      item,
      isOwner,
      isAshland,
      myInterest,
      hasAcceptedOther,
    });
  }, [item, isOwner, isAshland, myInterest, hasAcceptedOther]);

  const requestFlow = useMemo(() => {
    return getRequestFlow({
      item,
      isOwner,
      isAshland,
      myOffer,
    });
  }, [item, isOwner, isAshland, myOffer]);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  function applyLoadedState(detail: LoadedItemDetail, uid: string | null, email: string | null) {
    setItem(detail.item);
    setOwner(detail.owner);
    setLoveCount(detail.loveCount);
    setMyLoved(detail.myLoved);
    setInterestCount(detail.interestCount);
    setOfferCount(detail.offerCount);
    setMyInterest(detail.myInterest);
    setMyOffer(detail.myOffer);
    setHasAcceptedOther(detail.hasAcceptedOther);
    setCompletedInterest(detail.completedInterest);
    setUserId(uid);
    setUserEmail(email);
  }

  async function loadEverything(uid: string | null, email: string | null) {
    if (!itemId) return;

    setLoading(true);
    setErr(null);

    try {
      const detail = await loadItemDetail(itemId, uid);
      applyLoadedState(detail, uid, email);
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

  async function runAction(key: string, fn: () => Promise<void>) {
    setActionBusy(key);
    try {
      await fn();
      setActionSuccess(key);
    } catch (e: any) {
      setActionSuccess(null);
      showToast(e?.message || "Something went wrong.", "err");
      throw e;
    } finally {
      setActionBusy(null);
    }
  }

  async function toggleLove() {
    if (!item) return;

    const currentItemId = item.id;
    const currentUserId = userId;

    if (!currentUserId) {
      router.push("/me");
      return;
    }

    setBusy(true);

    try {
      if (myLoved) {
        const { error } = await supabase
          .from(LOVES_TABLE)
          .delete()
          .eq("item_id", currentItemId)
          .eq("user_id", currentUserId);

        if (error) throw new Error(error.message);

        setMyLoved(false);
        setLoveCount((c) => Math.max(0, c - 1));
      } else {
        const { error } = await supabase.from(LOVES_TABLE).insert([
          {
            item_id: currentItemId,
            user_id: currentUserId,
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

    const currentItemId = item.id;
    const currentOwnerId = item.owner_id;
    const currentRequesterId = userId;

    await runAction("chat", async () => {
      const threadId = await ensureThread({
        itemId: currentItemId,
        ownerId: currentOwnerId,
        requesterId: currentRequesterId,
      });

      router.push(`/messages/${threadId}`);
    });
  }

  async function submitGiveInterest() {
    if (!item || postType !== "give") return;

    const currentUserId = userId;
    const currentUserEmail = userEmail;
    const currentItem = item;
    const currentInterest = myInterest;
    const mine = normStatus(currentInterest?.status);

    if (!currentUserId) {
      router.push("/me");
      return;
    }

    if (isOwner) return;
    if (isGiveClosed(currentItem) || normStatus(currentItem.status) === "reserved") {
      showToast("This item is not accepting new requests.", "err");
      throw new Error("This item is not accepting new requests.");
    }

    if (mine === "accepted" || mine === "reserved") {
      await openConversation();
      return;
    }

    if (mine === "pending") return;

    await runAction("interest", async () => {
      if (currentInterest?.id && ["withdrawn", "declined"].includes(mine)) {
        const { error } = await supabase
          .from("interests")
          .update({
            status: "pending",
            accepted_at: null,
            accepted_expires_at: null,
            reserved_at: null,
            completed_at: null,
          } as any)
          .eq("id", currentInterest.id)
          .eq("user_id", currentUserId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("interests").insert([
          {
            item_id: currentItem.id,
            user_id: currentUserId,
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

      await loadEverything(currentUserId, currentUserEmail);
      showToast(hasAcceptedOther ? "Joined waitlist." : "Request sent.");
    });
  }

  async function withdrawGiveInterest() {
    if (!myInterest?.id || !userId) return;
    if (normStatus(myInterest.status) !== "pending") return;

    const interestId = myInterest.id;
    const currentUserId = userId;
    const currentUserEmail = userEmail;

    await runAction("withdraw-interest", async () => {
      const { error } = await supabase
        .from("interests")
        .update({ status: "withdrawn" } as any)
        .eq("id", interestId)
        .eq("user_id", currentUserId);

      if (error) throw new Error(error.message);

      await loadEverything(currentUserId, currentUserEmail);
      showToast("Request withdrawn.");
    });
  }

  async function submitHelpOffer() {
    if (!item || postType !== "request") return;

    const currentUserId = userId;
    const currentUserEmail = userEmail;
    const currentItem = item;
    const currentOffer = myOffer;
    const mine = normStatus(currentOffer?.status);

    if (!currentUserId) {
      router.push("/me");
      return;
    }

    if (isOwner) return;
    if (isRequestClosed(currentItem)) {
      showToast("This request is closed.", "err");
      throw new Error("This request is closed.");
    }

    if (mine === "accepted" || mine === "completed") {
      await openConversation();
      return;
    }

    if (mine === "pending" || mine === "hold") return;

    await runAction("offer", async () => {
      if (currentOffer?.id && mine === "declined") {
        const { error } = await supabase
          .from("request_offers")
          .update({ status: "pending", updated_at: new Date().toISOString() } as any)
          .eq("id", currentOffer.id)
          .eq("helper_id", currentUserId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("request_offers").insert([
          {
            request_id: currentItem.id,
            helper_id: currentUserId,
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

      await loadEverything(currentUserId, currentUserEmail);
      showToast("Offer sent.");
    });
  }

  async function withdrawHelpOffer() {
    if (!myOffer?.id || !userId) return;

    const mine = normStatus(myOffer.status);
    if (!["pending", "hold"].includes(mine)) return;

    const offerId = myOffer.id;
    const currentUserId = userId;
    const currentUserEmail = userEmail;

    await runAction("withdraw-offer", async () => {
      const { error } = await supabase
        .from("request_offers")
        .delete()
        .eq("id", offerId)
        .eq("helper_id", currentUserId);

      if (error) throw new Error(error.message);

      await loadEverything(currentUserId, currentUserEmail);
      showToast("Offer withdrawn.");
    });
  }

  async function toggleCountVisibility() {
    if (!item || !isOwner || !userId || (postType === "give" && isArchivedGiveOwnerView)) return;

    const nextValue = !item.hide_interest_count;
    const currentItemId = item.id;
    const currentUserId = userId;

    setBusy(true);
    setMenuOpen(false);

    try {
      const { error } = await supabase
        .from("items")
        .update({ hide_interest_count: nextValue })
        .eq("id", currentItemId)
        .eq("owner_id", currentUserId);

      if (error) throw new Error(error.message);

      setItem((prev) => (prev ? { ...prev, hide_interest_count: nextValue } : prev));
      showToast(
        postType === "give"
          ? nextValue
            ? "Requests hidden."
            : "Requests shown."
          : nextValue
            ? "Offers hidden."
            : "Offers shown."
      );
    } catch (e: any) {
      showToast(e?.message || "Could not update visibility.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function deleteListing() {
    if (!item || !isOwner || !userId) return;

    const currentItemId = item.id;
    const currentUserId = userId;

    setBusy(true);

    try {
      if (postType === "give") {
        const { error: interestDeleteErr } = await supabase
          .from("interests")
          .delete()
          .eq("item_id", currentItemId);

        if (interestDeleteErr) throw new Error(interestDeleteErr.message);
      } else {
        const { error: offerDeleteErr } = await supabase
          .from("request_offers")
          .delete()
          .eq("request_id", currentItemId);

        if (offerDeleteErr) throw new Error(offerDeleteErr.message);
      }

      const { error: loveDeleteErr } = await supabase
        .from(LOVES_TABLE)
        .delete()
        .eq("item_id", currentItemId);

      if (loveDeleteErr) throw new Error(loveDeleteErr.message);

      const { error: itemDeleteErr } = await supabase
        .from("items")
        .delete()
        .eq("id", currentItemId)
        .eq("owner_id", currentUserId);

      if (itemDeleteErr) throw new Error(itemDeleteErr.message);

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

  useEffect(() => {
    setActionSuccess(null);
  }, [itemId, myInterest?.status, myOffer?.status, item?.status]);

  const isRequestArchivedOwnerView =
    !!item && postType === "request" && isOwner && isRequestClosed(item);

  const budgetLabel =
    item?.request_willing_to_pay
      ? item.request_budget !== null && item.request_budget !== undefined
        ? `Budget ${formatPrice(item.request_budget)}`
        : "Willing to pay"
      : "Unpaid help";

  const showGiveSlide =
    postType === "give" &&
    !!giveFlow &&
    (giveFlow.kind === "open" || giveFlow.kind === "waitlist");

  const showRequestSlide =
    postType === "request" &&
    !!requestFlow &&
    requestFlow.kind === "open";

  return (
    <div className={`page page-${postType}`}>
      <div className="shell">
        <header className="topBar">
          <div className="topLeft">
            <button className="iconBtn" onClick={() => router.back()} aria-label="Back" type="button">
              ←
            </button>
          </div>

          <div className="topCenter">
            <div className="topTitle">Post details</div>
            <div className="topSub">ScholarSwap</div>
          </div>

          <div className="topRight">
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
                  className="iconBtn"
                  type="button"
                  aria-label="Post options"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  ⋯
                </button>

                {menuOpen ? (
                  <div className="menuCard">
                    {!isArchivedGiveOwnerView && !isRequestArchivedOwnerView ? (
                      <>
                        <button
                          className="menuItem"
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push(`/manage/${item?.id}`);
                          }}
                        >
                          {postType === "give" ? "Manage item" : "Manage request"}
                        </button>

                        <button
                          className="menuItem"
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            router.push(`/item/${item?.id}/edit`);
                          }}
                        >
                          {postType === "give" ? "Edit item" : "Edit request"}
                        </button>

                        <button className="menuItem" type="button" onClick={() => void toggleCountVisibility()}>
                          {postType === "give"
                            ? item?.hide_interest_count
                              ? "Show requests"
                              : "Hide requests"
                            : item?.hide_interest_count
                              ? "Show offers"
                              : "Hide offers"}
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
                className={`iconBtn loveTop ${myLoved ? "active" : ""}`}
                onClick={toggleLove}
                disabled={busy}
                aria-label="Love post"
                type="button"
              >
                {myLoved ? "♥" : "♡"}
              </button>
            )}
          </div>
        </header>

        {err ? <div className="notice error">{err}</div> : null}
        {loading ? <div className="notice">Loading…</div> : null}
        {!loading && !err && !item ? <div className="notice error">Post not found.</div> : null}

        {!loading && !err && item ? (
          <section className="detailCard">
            <div className="detailGrid">
              <div className="mediaCol">
                {item.photo_url ? (
                  <button className="mediaButton" type="button" onClick={() => setOpenImg(item.photo_url!)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.photo_url} alt={item.title} className="heroImg" />
                  </button>
                ) : (
                  <div className={`noPhoto noPhoto-${postType}`}>No image</div>
                )}
              </div>

              <div className="infoCol">
                <div className="ownerRow">
                  <div className={`avatar avatar-${postType}`}>{initials(ownerLabel)}</div>

                  <div className="ownerText">
                    <div className="ownerName">{ownerLabel}</div>
                    {subtitle ? <div className="ownerSub">{subtitle}</div> : null}
                  </div>
                </div>

                <div className="titleRow">
                  <h1 className="title">{item.title}</h1>
                </div>

                <div className="pillRow">
                  {postType === "give" ? (
                    <span className="pricePill">
                      {formatPriceWithNegotiable(item.price, item.is_negotiable)}
                    </span>
                  ) : (
                    <span className="budgetPill">{budgetLabel}</span>
                  )}

                  <span className={`statusPill ${itemStateChip.tone}`}>{itemStateChip.label}</span>
                </div>

                <div className="metaRow">
                  <span>♥ {loveCount}</span>
                  <span>•</span>
                  <span>{activityLabel}</span>
                  <span>•</span>
                  <span>Delists {formatDelist(item.expires_at)}</span>
                </div>

                {isArchivedGiveOwnerView ? (
                  <div className="archivePanel">
                    <div className="panelTitle">Completed handoff</div>
                    <div className="panelBody">
                      This listing has been completed and moved to archive.
                    </div>

                    <div className="archiveGrid">
                      <div className="archiveBox">
                        <div className="archiveLabel">Given to</div>
                        <div className="archiveValue">{soldToLabel}</div>
                      </div>
                      <div className="archiveBox">
                        <div className="archiveLabel">Given on</div>
                        <div className="archiveValue">{formatFullWhen(soldAtLabel)}</div>
                      </div>
                    </div>
                  </div>
                ) : postType === "give" && giveFlow ? (
                  <div className="actionPanel">
                    <div className="panelTitle">{giveFlow.title}</div>
                    <div className="panelBody">{giveFlow.body}</div>

                    <div className="buttonRow">
                      {showGiveSlide ? (
                        <SlideAction
                          tone="give"
                          label={giveFlow.primary}
                          busyLabel="sending..."
                          sentLabel="request sent"
                          busy={actionBusy === "interest"}
                          disabled={!!actionBusy}
                          successKey="interest"
                          activeSuccessKey={actionSuccess}
                          onComplete={submitGiveInterest}
                        />
                      ) : (
                        <button
                          className={`primaryBtn primaryBtn-${postType}`}
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
                          }}
                        >
                          {actionBusy === "chat"
                            ? "Opening..."
                            : actionBusy === "interest"
                              ? "Sending..."
                              : giveFlow.primary}
                        </button>
                      )}

                      {giveFlow.secondary ? (
                        <button
                          className="secondaryBtn"
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
                          {actionBusy === "withdraw-interest" ? "Working..." : giveFlow.secondary}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : postType === "request" && requestFlow ? (
                  <div className="actionPanel">
                    <div className="panelTitle">{requestFlow.title}</div>
                    <div className="panelBody">{requestFlow.body}</div>

                    <div className="buttonRow">
                      {showRequestSlide ? (
                        <SlideAction
                          tone="request"
                          label={requestFlow.primary}
                          busyLabel="sending..."
                          sentLabel="offer sent"
                          busy={actionBusy === "offer"}
                          disabled={!!actionBusy}
                          successKey="offer"
                          activeSuccessKey={actionSuccess}
                          onComplete={submitHelpOffer}
                        />
                      ) : (
                        <button
                          className={`primaryBtn primaryBtn-${postType}`}
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
                          }}
                        >
                          {actionBusy === "chat"
                            ? "Opening..."
                            : actionBusy === "offer"
                              ? "Sending..."
                              : requestFlow.primary}
                        </button>
                      )}

                      {requestFlow.secondary ? (
                        <button
                          className="secondaryBtn"
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
                          {actionBusy === "withdraw-offer" ? "Working..." : requestFlow.secondary}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {item.description?.trim() ? (
                  <div className="descriptionCard">
                    <div className="sectionLabel">Description</div>
                    <div className="descriptionText">{item.description.trim()}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
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
        <div className="modal imageModal" onClick={() => setOpenImg(null)}>
          <div className="imageCard" onClick={(e) => e.stopPropagation()}>
            <div className="imageTop">
              <div className="imageTitle">{item.title}</div>
              <button className="iconBtn" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={item.title} className="imageFull" />
          </div>
        </div>
      ) : null}

      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          padding: 24px;
          color: #0f172a;
        }

        .page-give {
          background: #f6f8f7;
        }

        .page-request {
          background: #faf8f3;
        }

        .shell {
          max-width: 1320px;
          margin: 0 auto;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          grid-template-columns: 80px 1fr 80px;
          align-items: center;
          gap: 16px;
          padding: 8px 0 18px;
          backdrop-filter: blur(14px);
        }

        .page-give .topBar {
          background: rgba(246, 248, 247, 0.92);
        }

        .page-request .topBar {
          background: rgba(250, 248, 243, 0.92);
        }

        .topLeft,
        .topRight {
          display: flex;
          align-items: center;
        }

        .topRight {
          justify-content: flex-end;
        }

        .topCenter {
          text-align: center;
        }

        .topTitle {
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .topSub {
          margin-top: 3px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .iconBtn {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #dbe2ea;
          background: #ffffff;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
        }

        .loveTop.active {
          color: #dc2626;
          border-color: #fecaca;
          background: #fff1f2;
        }

        .notice {
          padding: 14px 16px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          font-size: 14px;
          font-weight: 800;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .notice.error {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .detailCard {
          margin-top: 10px;
          border-radius: 28px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }

        .detailGrid {
          display: grid;
          grid-template-columns: minmax(420px, 1.05fr) minmax(420px, 1fr);
          min-height: 680px;
        }

        .mediaCol {
          background: #f8fafc;
          border-right: 1px solid #eef2f7;
        }

        .mediaButton {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .heroImg {
          width: 100%;
          height: 100%;
          min-height: 680px;
          object-fit: cover;
          display: block;
        }

        .noPhoto {
          height: 100%;
          min-height: 680px;
          display: grid;
          place-items: center;
          font-size: 16px;
          font-weight: 800;
          color: #64748b;
        }

        .noPhoto-give {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), #f8fafc);
        }

        .noPhoto-request {
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), #f8fafc);
        }

        .infoCol {
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .ownerRow {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .avatar {
          width: 50px;
          height: 50px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 14px;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .avatar-give {
          border: 1px solid rgba(16, 185, 129, 0.18);
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.11), #f0fdf4 100%);
          color: #065f46;
        }

        .avatar-request {
          border: 1px solid rgba(245, 158, 11, 0.18);
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.11), #fffbeb 100%);
          color: #92400e;
        }

        .ownerText {
          min-width: 0;
        }

        .ownerName {
          font-size: 16px;
          font-weight: 900;
          line-height: 1.2;
        }

        .ownerSub {
          margin-top: 4px;
          font-size: 13px;
          color: #64748b;
          font-weight: 700;
          line-height: 1.4;
        }

        .titleRow {
          display: block;
        }

        .title {
          margin: 0;
          font-size: 40px;
          line-height: 1.02;
          font-weight: 1000;
          letter-spacing: -0.05em;
          overflow-wrap: anywhere;
        }

        .pillRow {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .pricePill,
        .budgetPill,
        .statusPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          padding: 0 14px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
        }

        .pricePill {
          border: 1px solid rgba(16, 185, 129, 0.22);
          background: rgba(16, 185, 129, 0.1);
          color: #065f46;
        }

        .budgetPill {
          border: 1px solid rgba(245, 158, 11, 0.2);
          background: rgba(245, 158, 11, 0.1);
          color: #92400e;
        }

        .statusPill {
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          color: #475569;
        }

        .statusPill.good {
          color: #166534;
          border-color: #bbf7d0;
          background: #ecfdf5;
        }

        .statusPill.warn {
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

        .metaRow {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          color: #475569;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.5;
        }

        .actionPanel,
        .archivePanel,
        .descriptionCard {
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          padding: 18px;
        }

        .actionPanel {
          background: ${postType === "give"
            ? "linear-gradient(180deg, rgba(16, 185, 129, 0.05), #ffffff)"
            : "linear-gradient(180deg, rgba(245, 158, 11, 0.05), #ffffff)"};
        }

        .archivePanel {
          background: linear-gradient(180deg, #f8fafc, #f1f5f9);
        }

        .panelTitle {
          font-size: 18px;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.2;
        }

        .panelBody {
          margin-top: 8px;
          font-size: 14px;
          line-height: 1.6;
          color: #475569;
          font-weight: 700;
        }

        .buttonRow {
          margin-top: 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }

        .primaryBtn,
        .secondaryBtn,
        .ghostBtn,
        .dangerBtn {
          min-height: 46px;
          padding: 0 16px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .primaryBtn {
          min-width: 180px;
          border: 1px solid transparent;
        }

        .primaryBtn-give {
          background: #0f766e;
          border-color: #0f766e;
          color: #ffffff;
        }

        .primaryBtn-request {
          background: #b45309;
          border-color: #b45309;
          color: #ffffff;
        }

        .secondaryBtn,
        .ghostBtn {
          border: 1px solid #dbe2ea;
          background: #ffffff;
          color: #0f172a;
        }

        .dangerBtn {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
        }

        .primaryBtn:disabled,
        .secondaryBtn:disabled,
        .dangerBtn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .sectionLabel {
          font-size: 12px;
          font-weight: 900;
          color: #64748b;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .descriptionText {
          margin-top: 10px;
          font-size: 15px;
          line-height: 1.75;
          color: #334155;
          white-space: pre-wrap;
        }

        .archiveGrid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .archiveBox {
          border-radius: 16px;
          border: 1px solid #dbe2ea;
          background: #ffffff;
          padding: 14px;
        }

        .archiveLabel {
          font-size: 11px;
          font-weight: 900;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .archiveValue {
          margin-top: 8px;
          font-size: 15px;
          font-weight: 900;
          line-height: 1.4;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .menuWrap {
          position: relative;
        }

        .menuBackdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          border: 0;
        }

        .menuCard {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 220px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.14);
          overflow: hidden;
          z-index: 30;
        }

        .menuItem {
          width: 100%;
          border: 0;
          background: #ffffff;
          text-align: left;
          padding: 13px 15px;
          font-size: 14px;
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

        .modal {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: rgba(15, 23, 42, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .modalCard,
        .imageCard {
          width: 100%;
          max-width: 560px;
          border-radius: 24px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.22);
        }

        .modalCard {
          padding: 20px;
        }

        .modalTitle {
          font-size: 18px;
          font-weight: 900;
          color: #0f172a;
        }

        .modalText {
          margin-top: 10px;
          font-size: 14px;
          line-height: 1.6;
          color: #475569;
          font-weight: 700;
        }

        .modalActions {
          margin-top: 18px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        .imageCard {
          max-width: 1080px;
          overflow: hidden;
        }

        .imageTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid #eef2f7;
        }

        .imageTitle {
          font-size: 14px;
          font-weight: 900;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imageFull {
          display: block;
          width: 100%;
          max-height: 82vh;
          object-fit: contain;
          background: #111827;
        }

        .toast {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 140;
          max-width: calc(100vw - 32px);
          padding: 12px 15px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          font-size: 14px;
          font-weight: 900;
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
        }

        .toast.ok {
          border-color: #bbf7d0;
        }

        .toast.err {
          border-color: #fecaca;
        }

        @media (max-width: 1080px) {
          .detailGrid {
            grid-template-columns: 1fr;
          }

          .mediaCol {
            border-right: 0;
            border-bottom: 1px solid #eef2f7;
          }

          .heroImg,
          .noPhoto {
            min-height: 520px;
          }
        }

        @media (max-width: 720px) {
          .page {
            padding: 12px;
          }

          .topBar {
            grid-template-columns: 56px 1fr 56px;
            gap: 10px;
            padding-bottom: 12px;
          }

          .topTitle {
            font-size: 17px;
          }

          .detailCard {
            border-radius: 22px;
          }

          .infoCol {
            padding: 18px;
            gap: 14px;
          }

          .title {
            font-size: 28px;
          }

          .metaRow {
            font-size: 13px;
          }

          .buttonRow {
            display: grid;
            grid-template-columns: 1fr;
          }

          .primaryBtn,
          .secondaryBtn {
            width: 100%;
          }

          .archiveGrid {
            grid-template-columns: 1fr;
          }

          .heroImg,
          .noPhoto {
            min-height: 340px;
          }
        }
      `}</style>
    </div>
  );
}
