"use client";

export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread } from "@/lib/ensureThread";

/* ==============================
   TYPES
============================== */

type TabKey = "overview" | "listings" | "requests" | "activity" | "history";
type OfferStatus = "pending" | "hold" | "accepted" | "declined" | "completed";
type ToastState = { msg: string; kind?: "ok" | "err" } | null;

type ConfirmState =
  | null
  | {
      title: string;
      body: string;
      actionLabel: string;
      onYes: () => Promise<void>;
    };

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  user_role: string | null;
  created_at?: string | null;
};

type MyItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  post_type?: "give" | "request" | "event" | null;
};

type ItemMini = {
  id: string;
  title: string | null;
  photo_url?: string | null;
  status: string | null;
  post_type?: "give" | "request" | "event" | null;
  owner_id?: string | null;
};

type MyRequestRow = {
  item_id: string;
  created_at?: string | null;
  item: ItemMini | null;
};

type MyOfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  request_item: ItemMini | null;
};

type IncomingInterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  created_at: string | null;
  status: string | null;
  item: ItemMini | null;
  requester: {
    full_name: string | null;
    email: string | null;
    user_role: string | null;
  } | null;
};

type IncomingOfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  request_item: ItemMini | null;
  helper: {
    full_name: string | null;
    email: string | null;
    user_role: string | null;
  } | null;
};

type NotificationRow = {
  id: string;
  type: "item_interest" | "help_offer";
  item_id: string | null;
  interest_id: string | null;
  offer_id: string | null;
  title: string;
  body: string | null;
  seen_at: string | null;
  created_at: string;
  actor: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type StatsState = {
  listed: number;
  interests: number;
  offers: number;
  chats: number;
};

/* ==============================
   QUERY SHAPES
============================== */

type MyRequestQueryRow = {
  item_id: string;
  created_at: string | null;
  items:
    | {
        id: string;
        title: string | null;
        photo_url: string | null;
        status: string | null;
        post_type?: "give" | "request" | "event" | null;
      }
    | {
        id: string;
        title: string | null;
        photo_url: string | null;
        status: string | null;
        post_type?: "give" | "request" | "event" | null;
      }[]
    | null;
};

type MyOfferQueryRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  request_item:
    | {
        id: string;
        title: string | null;
        status: string | null;
        post_type?: "give" | "request" | "event" | null;
        owner_id?: string | null;
      }
    | {
        id: string;
        title: string | null;
        status: string | null;
        post_type?: "give" | "request" | "event" | null;
        owner_id?: string | null;
      }[]
    | null;
};

type IncomingInterestQueryRow = {
  id: string;
  item_id: string;
  user_id: string;
  created_at: string | null;
  status: string | null;
  items:
    | {
        id: string;
        title: string | null;
        photo_url: string | null;
        status: string | null;
        owner_id: string | null;
        post_type?: "give" | "request" | "event" | null;
      }
    | {
        id: string;
        title: string | null;
        photo_url: string | null;
        status: string | null;
        owner_id: string | null;
        post_type?: "give" | "request" | "event" | null;
      }[]
    | null;
  requester:
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }[]
    | null;
};

type IncomingOfferQueryRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  request_item:
    | {
        id: string;
        title: string | null;
        status: string | null;
        owner_id: string | null;
        post_type?: "give" | "request" | "event" | null;
      }
    | {
        id: string;
        title: string | null;
        status: string | null;
        owner_id: string | null;
        post_type?: "give" | "request" | "event" | null;
      }[]
    | null;
  helper:
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }[]
    | null;
};

type NotificationQueryRow = {
  id: string;
  type: "item_interest" | "help_offer";
  item_id: string | null;
  interest_id: string | null;
  offer_id: string | null;
  title: string;
  body: string | null;
  seen_at: string | null;
  created_at: string;
  actor:
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

/* ==============================
   HELPERS
============================== */

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isAshlandEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@ashland.edu");
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function fmtShort(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function readableRole(role: string | null | undefined) {
  const raw = (role ?? "").trim().toLowerCase();
  if (!raw) return "Ashland member";
  if (raw === "student") return "Student member";
  if (raw === "faculty") return "Faculty member";
  return raw;
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

function itemTypeLabel(type: "give" | "request" | "event" | null | undefined) {
  if (type === "request") return "Request";
  if (type === "event") return "Event";
  return "Give";
}

function toneForStatus(status: string | null | undefined): "green" | "amber" | "red" | "gray" {
  const s = normStatus(status);
  if (["accepted", "reserved", "claimed", "completed"].includes(s)) return "green";
  if (["pending", "hold"].includes(s)) return "amber";
  if (["declined", "expired"].includes(s)) return "red";
  return "gray";
}

function getFriendlyError(e: unknown) {
  if (!e) return "Something went wrong.";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

/* ==============================
   PAGE
============================== */

export default function AccountPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mountedRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("overview");

  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [myItems, setMyItems] = useState<MyItemRow[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]);
  const [myOffers, setMyOffers] = useState<MyOfferRow[]>([]);
  const [incomingInterests, setIncomingInterests] = useState<IncomingInterestRow[]>([]);
  const [incomingOffers, setIncomingOffers] = useState<IncomingOfferRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const [stats, setStats] = useState<StatsState>({
    listed: 0,
    interests: 0,
    offers: 0,
    chats: 0,
  });

  const [toast, setToast] = useState<ToastState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [incomingOfferBusyId, setIncomingOfferBusyId] = useState<string | null>(null);
  const [myOfferBusyId, setMyOfferBusyId] = useState<string | null>(null);
  const [markingNotifs, setMarkingNotifs] = useState(false);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const displayName =
    (profile?.full_name ?? "").trim() ||
    (userEmail ? userEmail.split("@")[0] : "") ||
    "Account";

  const displayRole = readableRole(profile?.user_role);
  const memberSince = fmtShort(profile?.created_at);

  const activeListings = useMemo(
    () => myItems.filter((x) => !["claimed", "completed"].includes(normStatus(x.status))),
    [myItems]
  );

  const completedListings = useMemo(
    () => myItems.filter((x) => ["claimed", "completed"].includes(normStatus(x.status))),
    [myItems]
  );

  const unseenNotificationCount = useMemo(() => {
    return notifications.filter((n) => !n.seen_at).length;
  }, [notifications]);

  const incomingPendingOfferCount = useMemo(() => {
    return incomingOffers.filter((x) => (x.status ?? "pending") === "pending").length;
  }, [incomingOffers]);

  const acceptedMyOffers = useMemo(() => {
    return myOffers.filter((x) => (x.status ?? "pending") === "accepted").length;
  }, [myOffers]);

  const showToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2200);
  }, []);

  const setTabAndUrl = useCallback(
    (nextTab: TabKey) => {
      setTab(nextTab);
      router.replace(`${pathname}?tab=${nextTab}`, { scroll: false });
    },
    [pathname, router]
  );

  const clearAll = useCallback(() => {
    setProfile(null);
    setMyItems([]);
    setMyRequests([]);
    setMyOffers([]);
    setIncomingInterests([]);
    setIncomingOffers([]);
    setNotifications([]);
    setStats({ listed: 0, interests: 0, offers: 0, chats: 0 });
    setConfirm(null);
    setErr(null);
  }, []);

  async function loadProfile(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,user_role,created_at")
      .eq("id", uid)
      .maybeSingle<ProfileRow>();

    if (!mountedRef.current) return null;

    if (error) {
      setProfile(null);
      return null;
    }

    setProfile(data ?? null);
    return data ?? null;
  }

  async function loadMyListings(uid: string) {
    const { data, error } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url,post_type")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });

    if (!mountedRef.current) return [] as MyItemRow[];

    if (error) {
      setMyItems([]);
      return [];
    }

    const rows = ((data ?? []) as MyItemRow[]).filter(Boolean);
    setMyItems(rows);
    return rows;
  }

  async function loadMyRequests(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select("item_id,created_at,items:items(id,title,photo_url,status,post_type)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (!mountedRef.current) return [] as MyRequestRow[];

    if (error) {
      setMyRequests([]);
      return [];
    }

    const normalized: MyRequestRow[] = (((data ?? []) as unknown) as MyRequestQueryRow[]).map((row) => ({
      item_id: row.item_id,
      created_at: row.created_at,
      item: singleRelation(row.items),
    }));

    setMyRequests(normalized);
    return normalized;
  }

  async function loadMyOffers(uid: string) {
    const { data, error } = await supabase
      .from("request_offers")
      .select(
        "id,request_id,helper_id,status,availability,note,created_at,request_item:items(id,title,status,post_type,owner_id)"
      )
      .eq("helper_id", uid)
      .order("created_at", { ascending: false });

    if (!mountedRef.current) return [] as MyOfferRow[];

    if (error) {
      setMyOffers([]);
      return [];
    }

    const normalized: MyOfferRow[] = (((data ?? []) as unknown) as MyOfferQueryRow[]).map((row) => ({
      id: row.id,
      request_id: row.request_id,
      helper_id: row.helper_id,
      status: row.status,
      availability: row.availability,
      note: row.note,
      created_at: row.created_at,
      request_item: singleRelation(row.request_item),
    }));

    setMyOffers(normalized);
    return normalized;
  }

  async function loadIncomingInterests(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select(`
        id,
        item_id,
        user_id,
        created_at,
        status,
        items:items(id,title,photo_url,status,owner_id,post_type),
        requester:profiles!interests_user_id_fkey(full_name,email,user_role)
      `)
      .order("created_at", { ascending: false });

    if (!mountedRef.current) return [] as IncomingInterestRow[];

    if (error) {
      setIncomingInterests([]);
      return [];
    }

    const normalizedAll: IncomingInterestRow[] = (((data ?? []) as unknown) as IncomingInterestQueryRow[]).map(
      (row) => ({
        id: row.id,
        item_id: row.item_id,
        user_id: row.user_id,
        created_at: row.created_at,
        status: row.status,
        item: singleRelation(row.items),
        requester: singleRelation(row.requester),
      })
    );

    const filtered = normalizedAll.filter((row) => row.item?.owner_id === uid);
    setIncomingInterests(filtered);
    return filtered;
  }

  async function loadIncomingOffers(uid: string) {
    const { data, error } = await supabase
      .from("request_offers")
      .select(`
        id,
        request_id,
        helper_id,
        status,
        availability,
        note,
        created_at,
        updated_at,
        request_item:items(id,title,status,owner_id,post_type),
        helper:profiles!request_offers_helper_id_fkey(full_name,email,user_role)
      `)
      .order("created_at", { ascending: false });

    if (!mountedRef.current) return [] as IncomingOfferRow[];

    if (error) {
      setIncomingOffers([]);
      return [];
    }

    const normalizedAll: IncomingOfferRow[] = (((data ?? []) as unknown) as IncomingOfferQueryRow[]).map((row) => ({
      id: row.id,
      request_id: row.request_id,
      helper_id: row.helper_id,
      status: row.status,
      availability: row.availability,
      note: row.note,
      created_at: row.created_at,
      updated_at: row.updated_at,
      request_item: singleRelation(row.request_item),
      helper: singleRelation(row.helper),
    }));

    const filtered = normalizedAll.filter(
      (row) => row.request_item?.owner_id === uid && row.request_item?.post_type === "request"
    );

    setIncomingOffers(filtered);
    return filtered;
  }

  async function loadNotifications(uid: string) {
    const { data, error } = await supabase
      .from("notifications")
      .select(`
        id,
        type,
        item_id,
        interest_id,
        offer_id,
        title,
        body,
        seen_at,
        created_at,
        actor:profiles!notifications_actor_id_fkey(full_name,email)
      `)
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!mountedRef.current) return [] as NotificationRow[];

    if (error) {
      setNotifications([]);
      return [];
    }

    const normalized: NotificationRow[] = (((data ?? []) as unknown) as NotificationQueryRow[]).map((row) => ({
      id: row.id,
      type: row.type,
      item_id: row.item_id,
      interest_id: row.interest_id,
      offer_id: row.offer_id,
      title: row.title,
      body: row.body,
      seen_at: row.seen_at,
      created_at: row.created_at,
      actor: singleRelation(row.actor),
    }));

    setNotifications(normalized);
    return normalized;
  }

  const loadAllFor = useCallback(async (uid: string) => {
    setLoading(true);
    setErr(null);

    try {
      const [profileRow, itemsRows, requestRows, offerRows, incomingReqRows, incomingOfferRows, notifRows] =
        await Promise.all([
          loadProfile(uid),
          loadMyListings(uid),
          loadMyRequests(uid),
          loadMyOffers(uid),
          loadIncomingInterests(uid),
          loadIncomingOffers(uid),
          loadNotifications(uid),
        ]);

      let chats = 0;
      try {
        const { count, error } = await supabase
          .from("threads")
          .select("id", { count: "exact", head: true })
          .or(`owner_id.eq.${uid},requester_id.eq.${uid}`);

        if (!error) chats = count ?? 0;
      } catch {
        chats = 0;
      }

      if (!mountedRef.current) return;

      setProfile(profileRow);
      setStats({
        listed: itemsRows.length,
        interests: requestRows.length + incomingReqRows.length,
        offers: offerRows.length + incomingOfferRows.length,
        chats,
      });

      if (notifRows.length === 0 && incomingReqRows.length === 0 && incomingOfferRows.length === 0) {
        // no-op, just keeps the page calm
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(getFriendlyError(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  async function markNotificationsSeen() {
    if (!userId) return;

    const unseenIds = notifications.filter((n) => !n.seen_at).map((n) => n.id);
    if (unseenIds.length === 0) return;

    setMarkingNotifs(true);

    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("notifications")
        .update({ seen_at: nowIso })
        .in("id", unseenIds)
        .eq("user_id", userId);

      if (error) throw new Error(error.message);

      if (!mountedRef.current) return;

      setNotifications((prev) => prev.map((n) => (n.seen_at ? n : { ...n, seen_at: nowIso })));
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setMarkingNotifs(false);
    }
  }

  function openNotification(notification: NotificationRow) {
    if (notification.item_id) {
      router.push(`/manage/${notification.item_id}`);
      return;
    }

    setTabAndUrl("requests");
  }

  async function deleteListing(id: string) {
    setConfirm({
      title: "Delete post?",
      body: "This cannot be undone.",
      actionLabel: "Delete",
      onYes: async () => {
        setConfirm(null);
        setDeletingId(id);

        const { error } = await supabase.from("items").delete().eq("id", id);

        if (!mountedRef.current) return;
        setDeletingId(null);

        if (error) {
          showToast(error.message, "err");
          return;
        }

        setMyItems((prev) => prev.filter((x) => x.id !== id));
        setStats((prev) => ({ ...prev, listed: Math.max(0, prev.listed - 1) }));
        showToast("Deleted.");
      },
    });
  }

  async function updateIncomingOfferStatus(offer: IncomingOfferRow, next: OfferStatus) {
    if (incomingOfferBusyId) return;

    setIncomingOfferBusyId(offer.id);

    try {
      const nowIso = new Date().toISOString();

      if (next === "accepted" && offer.request_item?.id) {
        const { error: otherErr } = await supabase
          .from("request_offers")
          .update({ status: "hold", updated_at: nowIso })
          .eq("request_id", offer.request_item.id)
          .neq("id", offer.id)
          .in("status", ["pending", "accepted"]);

        if (otherErr) throw new Error(otherErr.message);
      }

      const { error } = await supabase
        .from("request_offers")
        .update({ status: next, updated_at: nowIso })
        .eq("id", offer.id);

      if (error) throw new Error(error.message);

      if (!mountedRef.current) return;

      setIncomingOffers((prev) =>
        prev.map((x) => (x.id === offer.id ? { ...x, status: next, updated_at: nowIso } : x))
      );

      showToast(`Set to ${next}.`);
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setIncomingOfferBusyId(null);
    }
  }

  async function openIncomingOfferChat(offer: IncomingOfferRow) {
    if (!userId) return;

    if ((offer.status ?? "pending") !== "accepted") {
      showToast("Accept this helper first.", "err");
      return;
    }

    const itemId = offer.request_item?.id;
    if (!itemId) {
      showToast("Missing request post.", "err");
      return;
    }

    try {
      setIncomingOfferBusyId(offer.id);

      const threadId = await ensureThread({
        itemId,
        ownerId: userId,
        requesterId: offer.helper_id,
      });

      router.push(`/messages/${threadId}`);
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setIncomingOfferBusyId(null);
    }
  }

  async function withdrawMyOffer(offer: MyOfferRow) {
    const st = (offer.status ?? "pending") as OfferStatus;

    if (st === "accepted" || st === "completed") {
      showToast("Cannot withdraw after acceptance or completion.", "err");
      return;
    }

    setConfirm({
      title: "Withdraw offer?",
      body: "This removes your offer from the request post.",
      actionLabel: "Withdraw",
      onYes: async () => {
        setConfirm(null);
        setMyOfferBusyId(offer.id);

        const { error } = await supabase.from("request_offers").delete().eq("id", offer.id);

        if (!mountedRef.current) return;
        setMyOfferBusyId(null);

        if (error) {
          showToast(error.message, "err");
          return;
        }

        setMyOffers((prev) => prev.filter((x) => x.id !== offer.id));
        showToast("Offer withdrawn.");
      },
    });
  }

  async function openMyOfferChat(offer: MyOfferRow) {
    if (!userId) return;

    if ((offer.status ?? "pending") !== "accepted") {
      showToast("Chat unlocks after acceptance.", "err");
      return;
    }

    const itemId = offer.request_item?.id ?? offer.request_id;
    const ownerId = offer.request_item?.owner_id ?? null;

    if (!itemId || !ownerId) {
      showToast("Missing request owner.", "err");
      return;
    }

    try {
      setMyOfferBusyId(offer.id);

      const threadId = await ensureThread({
        itemId,
        ownerId,
        requesterId: userId,
      });

      router.push(`/messages/${threadId}`);
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setMyOfferBusyId(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function handleAuth() {
    setErr(null);

    const email = authEmail.trim().toLowerCase();
    const password = authPassword;

    if (!email) {
      setErr("Enter your email.");
      return;
    }

    if (!isAshlandEmail(email)) {
      setErr("Use your @ashland.edu email.");
      return;
    }

    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }

    setAuthBusy(true);

    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error && mountedRef.current) setErr(error.message);
        return;
      }

      const { error } = await supabase.auth.signUp({ email, password });
      if (error && mountedRef.current) setErr(error.message);
    } finally {
      if (mountedRef.current) setAuthBusy(false);
    }
  }

  /* ==============================
     EFFECTS
  ============================== */

  useEffect(() => {
    mountedRef.current = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!mountedRef.current) return;

      const uid = data.session?.user?.id ?? null;
      const email = data.session?.user?.email ?? null;

      setUserId(uid);
      setUserEmail(email);

      if (!uid || !email || !isAshlandEmail(email)) {
        clearAll();
        setLoading(false);
        return;
      }

      await loadAllFor(uid);
    }

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;

      if (!mountedRef.current) return;

      setUserId(uid);
      setUserEmail(email);

      if (!uid || !email || !isAshlandEmail(email)) {
        clearAll();
        setLoading(false);
        return;
      }

      void loadAllFor(uid);
    });

    return () => {
      mountedRef.current = false;
      sub.subscription.unsubscribe();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [clearAll, loadAllFor]);

  useEffect(() => {
    const q = searchParams.get("tab");
    if (q === "overview" || q === "listings" || q === "requests" || q === "activity" || q === "history") {
      setTab(q);
    }
  }, [searchParams]);

  const overviewHighlights = useMemo(() => {
    const rows: Array<{ key: string; title: string; body: string; cta: string; onClick: () => void }> = [];

    if (unseenNotificationCount > 0) {
      rows.push({
        key: "notifs",
        title: `${unseenNotificationCount} new notification${unseenNotificationCount > 1 ? "s" : ""}`,
        body: "New requests and help offers are waiting.",
        cta: "Open requests",
        onClick: () => setTabAndUrl("requests"),
      });
    }

    if (incomingPendingOfferCount > 0) {
      rows.push({
        key: "offers",
        title: `${incomingPendingOfferCount} helper offer${incomingPendingOfferCount > 1 ? "s" : ""} waiting`,
        body: "Accept one or put others on hold.",
        cta: "Review offers",
        onClick: () => setTabAndUrl("requests"),
      });
    }

    if (acceptedMyOffers > 0) {
      rows.push({
        key: "accepted",
        title: `${acceptedMyOffers} of your offers got accepted`,
        body: "Open chat and finalize details.",
        cta: "Go to activity",
        onClick: () => setTabAndUrl("activity"),
      });
    }

    if (rows.length === 0) {
      rows.push({
        key: "empty",
        title: "You’re caught up",
        body: "Nothing urgent is waiting right now.",
        cta: "Create post",
        onClick: () => router.push("/create"),
      });
    }

    return rows.slice(0, 3);
  }, [acceptedMyOffers, incomingPendingOfferCount, router, setTabAndUrl, unseenNotificationCount]);

  /* ==============================
     LOADING / AUTH
  ============================== */

  if (loading) {
    return (
      <div className="account-page">
        <div className="page-shell">
          <div className="hero-card skeleton-shell">
            <div className="skel skel-avatar" />
            <div className="skel skel-line lg" />
            <div className="skel skel-line md" />
            <div className="skel skel-btn" />
          </div>
        </div>
        <PageStyles />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="account-page">
        <div className="page-shell narrow">
          <section className="hero-card auth-card">
            <div className="eyebrow">My account</div>
            <h1 className="hero-title">Sign in to manage your campus activity</h1>
            <p className="hero-sub">
              Use your <b>@ashland.edu</b> email to manage listings, requests, offers, and messages.
            </p>

            <div className="seg-row">
              <button
                className={`seg-btn ${authMode === "signin" ? "active" : ""}`}
                onClick={() => setAuthMode("signin")}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`seg-btn ${authMode === "signup" ? "active" : ""}`}
                onClick={() => setAuthMode("signup")}
                type="button"
              >
                Sign up
              </button>
            </div>
          </section>

          <section className="panel auth-form-panel">
            <h2 className="section-title">{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="section-hint">One place for your posts, requests, offers, and messages.</p>

            <input
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@ashland.edu"
              autoComplete="email"
              inputMode="email"
              className="input"
            />

            <input
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="password"
              type="password"
              autoComplete={authMode === "signin" ? "current-password" : "new-password"}
              className="input"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAuth();
              }}
            />

            <div className="auth-button-stack">
              <button onClick={() => void handleAuth()} disabled={authBusy} className="btn btn-primary full" type="button">
                {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
              </button>
              <button onClick={() => router.push("/feed")} className="btn btn-secondary full" type="button">
                Browse feed
              </button>
            </div>

            {err ? <div className="error-text">{err}</div> : null}
          </section>
        </div>
        <PageStyles />
      </div>
    );
  }

  /* ==============================
     MAIN
  ============================== */

  return (
    <div className="account-page">
      <div className="page-shell">
        <section className="hero-card hero-mobile-first">
          <div className="hero-head">
            <div className="avatar-large">{displayName.slice(0, 1).toUpperCase()}</div>

            <div className="hero-copy">
              <div className="eyebrow">My space</div>
              <h1 className="hero-title clamp-title">{displayName}</h1>
              <p className="hero-sub hero-copy-sub">
                {displayRole}
                <span className="dot">•</span>
                <span className="email-chip">{userEmail}</span>
                {memberSince ? (
                  <>
                    <span className="dot">•</span>
                    Joined {memberSince}
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="hero-chip-row">
            <Chip label={`${activeListings.length} active`} tone="green" />
            <Chip label={`${unseenNotificationCount} new`} tone={unseenNotificationCount ? "red" : "gray"} />
            <Chip label={`${stats.chats} chats`} tone="gray" />
          </div>

          <div className="hero-action-grid">
            <button onClick={() => router.push("/create")} className="btn btn-primary" type="button">
              + Create post
            </button>
            <button onClick={() => router.push("/messages")} className="btn btn-secondary" type="button">
              Messages
            </button>
            <button onClick={() => void signOut()} className="btn btn-secondary" type="button">
              Sign out
            </button>
          </div>

          <div className="stats-grid mobile-stats-grid">
            <MetricCard label="Active" value={activeListings.length} hint="Live posts" onClick={() => setTabAndUrl("listings")} />
            <MetricCard
              label="Requests"
              value={incomingInterests.length + incomingOffers.length}
              hint="Waiting on you"
              onClick={() => setTabAndUrl("requests")}
              highlight={incomingInterests.length + incomingOffers.length > 0}
            />
            <MetricCard
              label="Activity"
              value={myRequests.length + myOffers.length}
              hint="Your actions"
              onClick={() => setTabAndUrl("activity")}
            />
            <MetricCard label="Done" value={completedListings.length} hint="Finished" onClick={() => setTabAndUrl("history")} />
          </div>
        </section>

        <section className="attention-section">
          <div className="section-head">
            <div>
              <h2 className="section-title">Needs attention</h2>
              <p className="section-hint">Only the next important things show here.</p>
            </div>
          </div>

          <div className="attention-grid">
            {overviewHighlights.map((row) => (
              <AttentionCard key={row.key} title={row.title} body={row.body} cta={row.cta} onClick={row.onClick} />
            ))}
          </div>
        </section>

        <section className="tab-sticky-wrap">
          <div className="tabs-shell">
            <button onClick={() => setTabAndUrl("overview")} className={`tab-btn ${tab === "overview" ? "active" : ""}`} type="button">
              Overview
            </button>
            <button onClick={() => setTabAndUrl("listings")} className={`tab-btn ${tab === "listings" ? "active" : ""}`} type="button">
              Listings
            </button>
            <button onClick={() => setTabAndUrl("requests")} className={`tab-btn ${tab === "requests" ? "active" : ""}`} type="button">
              Requests
              {unseenNotificationCount ? <span className="badge-red">{unseenNotificationCount}</span> : null}
            </button>
            <button onClick={() => setTabAndUrl("activity")} className={`tab-btn ${tab === "activity" ? "active" : ""}`} type="button">
              Activity
            </button>
            <button onClick={() => setTabAndUrl("history")} className={`tab-btn ${tab === "history" ? "active" : ""}`} type="button">
              History
            </button>
          </div>
        </section>

        {tab === "overview" ? (
          <div className="content-stack">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">Latest notifications</h2>
                  <p className="section-hint">Keep the homepage light. Handle details in Requests or Manage.</p>
                </div>

                <button
                  onClick={() => void markNotificationsSeen()}
                  disabled={markingNotifs || unseenNotificationCount === 0}
                  className="btn btn-secondary compact-btn"
                  type="button"
                >
                  {markingNotifs ? "Working…" : "Mark seen"}
                </button>
              </div>

              {notifications.length === 0 ? (
                <EmptyState title="No notifications" body="New requests and help offers will appear here." compact />
              ) : (
                <div className="stack-list">
                  {notifications.slice(0, 3).map((n) => (
                    <NotificationCard
                      key={n.id}
                      title={n.title}
                      body={n.body || `${readableName(n.actor)} did something on one of your posts.`}
                      meta={fmtWhen(n.created_at)}
                      isNew={!n.seen_at}
                      onClick={() => openNotification(n)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">Quick actions</h2>
                  <p className="section-hint">Common things you likely want next.</p>
                </div>
              </div>

              <div className="quick-grid">
                <QuickActionCard
                  emoji="📝"
                  title="Create a new post"
                  body="Share a give item, request help, or publish an event."
                  actionLabel="Create"
                  onClick={() => router.push("/create")}
                  primary
                />
                <QuickActionCard
                  emoji="💬"
                  title="Open messages"
                  body="Continue accepted requests and helper conversations."
                  actionLabel="Messages"
                  onClick={() => router.push("/messages")}
                />
                <QuickActionCard
                  emoji="📦"
                  title="Manage live posts"
                  body="Open your listings and take action."
                  actionLabel="Listings"
                  onClick={() => setTabAndUrl("listings")}
                />
                <QuickActionCard
                  emoji="🔎"
                  title="Browse the feed"
                  body="See what the campus community is posting now."
                  actionLabel="Browse"
                  onClick={() => router.push("/feed")}
                />
              </div>
            </section>

            <section className="two-col-grid">
              <div className="panel">
                <div className="section-head">
                  <div>
                    <h2 className="section-title sm">Recent listings</h2>
                    <p className="section-hint">Your latest live posts.</p>
                  </div>
                  <button onClick={() => setTabAndUrl("listings")} className="link-btn" type="button">
                    See all
                  </button>
                </div>

                {activeListings.slice(0, 3).length === 0 ? (
                  <EmptyState title="No active listings yet" body="Your live give, request, and event posts show here." compact />
                ) : (
                  <div className="stack-list">
                    {activeListings.slice(0, 3).map((item) => (
                      <CompactItemRow
                        key={item.id}
                        title={item.title}
                        subtitle={item.description || "No description"}
                        photoUrl={item.photo_url}
                        chip1={itemTypeLabel(item.post_type)}
                        chip2={item.status ?? "—"}
                        onClick={() => router.push(`/manage/${item.id}`)}
                        ctaLabel="Manage"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="section-head">
                  <div>
                    <h2 className="section-title sm">Latest activity</h2>
                    <p className="section-hint">Things you requested or offered recently.</p>
                  </div>
                  <button onClick={() => setTabAndUrl("activity")} className="link-btn" type="button">
                    See all
                  </button>
                </div>

                {myRequests.length === 0 && myOffers.length === 0 ? (
                  <EmptyState title="No activity yet" body="When you request an item or offer help, it will show here." compact />
                ) : (
                  <div className="stack-list">
                    {myRequests.slice(0, 2).map((r, i) => (
                      <CompactTextRow
                        key={`req-${r.item_id}-${r.created_at ?? i}`}
                        icon="🙋"
                        title={r.item?.title ?? "Unknown post"}
                        subtitle={`Interest sent${r.created_at ? ` • ${fmtWhen(r.created_at)}` : ""}`}
                        onClick={() => router.push(`/item/${r.item_id}`)}
                        ctaLabel="View"
                      />
                    ))}

                    {myOffers.slice(0, 2).map((o) => (
                      <CompactTextRow
                        key={`offer-${o.id}`}
                        icon="🤝"
                        title={o.request_item?.title ?? "Unknown request"}
                        subtitle={`Offer status: ${o.status ?? "pending"}`}
                        onClick={() => router.push(`/item/${o.request_id}`)}
                        ctaLabel="Open"
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {tab === "listings" ? (
          <div className="content-stack">
            <section className="panel-soft">
              <h2 className="section-title sm">Your listings</h2>
              <p className="section-hint">Live posts stay here. Claimed or completed ones move to history.</p>
            </section>

            {activeListings.length === 0 ? (
              <EmptyState
                title="No active listings"
                body="Create your first give, request, or event post to get started."
                actionLabel="Create post"
                onAction={() => router.push("/create")}
              />
            ) : (
              <div className="card-grid">
                {activeListings.map((item) => (
                  <ListingCard
                    key={item.id}
                    item={item}
                    deleting={deletingId === item.id}
                    onManage={() => router.push(`/manage/${item.id}`)}
                    onEdit={() => router.push(`/item/${item.id}/edit`)}
                    onDelete={() => void deleteListing(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "requests" ? (
          <div className="content-stack">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">Incoming notifications</h2>
                  <p className="section-hint">Use this section as the decision center, not the homepage.</p>
                </div>

                <button
                  onClick={() => void markNotificationsSeen()}
                  disabled={markingNotifs || unseenNotificationCount === 0}
                  className="btn btn-secondary compact-btn"
                  type="button"
                >
                  {markingNotifs ? "Working…" : "Mark all seen"}
                </button>
              </div>

              {notifications.length === 0 ? (
                <EmptyState title="No notifications" body="New requests and offers will appear here." compact />
              ) : (
                <div className="stack-list">
                  {notifications.map((n) => (
                    <NotificationCard
                      key={n.id}
                      title={n.title}
                      body={n.body || `${readableName(n.actor)} interacted with your post.`}
                      meta={fmtWhen(n.created_at)}
                      isNew={!n.seen_at}
                      onClick={() => openNotification(n)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">Incoming item requests</h2>
                  <p className="section-hint">People who requested your give posts.</p>
                </div>
                <Chip label={`${incomingInterests.length}`} tone={incomingInterests.length ? "green" : "gray"} />
              </div>

              {incomingInterests.length === 0 ? (
                <EmptyState title="No incoming item requests" body="When someone requests your give post, it will show here." compact />
              ) : (
                <div className="stack-list">
                  {incomingInterests.map((r) => (
                    <RequestRowCard
                      key={r.id}
                      photoUrl={r.item?.photo_url ?? null}
                      title={`${readableName(r.requester)} requested ${r.item?.title ?? "your post"}`}
                      subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}Status: ${r.item?.status ?? "—"}`}
                      chips={[
                        { label: itemTypeLabel(r.item?.post_type ?? "give"), tone: "gray" },
                        { label: r.item?.status ?? "—", tone: toneForStatus(r.item?.status) },
                      ]}
                      primaryLabel="Manage"
                      onPrimary={() => router.push(`/manage/${r.item_id}`)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">Incoming helper offers</h2>
                  <p className="section-hint">Accept one, hold some, or decline.</p>
                </div>
                <Chip label={`${incomingOffers.length}`} tone={incomingOffers.length ? "green" : "gray"} />
              </div>

              {incomingOffers.length === 0 ? (
                <EmptyState title="No incoming helper offers" body="When someone offers help on your request post, it will show here." compact />
              ) : (
                <div className="stack-list">
                  {incomingOffers.map((o) => {
                    const status = (o.status ?? "pending") as OfferStatus;
                    const busy = incomingOfferBusyId === o.id;

                    return (
                      <OfferRowCard
                        key={o.id}
                        icon="🤝"
                        title={`${readableName(o.helper)} offered help on ${o.request_item?.title ?? "your request"}`}
                        subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                        note={o.note}
                        statusLabel={status}
                        onView={() => router.push(`/manage/${o.request_id}`)}
                        onAccept={() => void updateIncomingOfferStatus(o, "accepted")}
                        onHold={() => void updateIncomingOfferStatus(o, "hold")}
                        onDecline={() => void updateIncomingOfferStatus(o, "declined")}
                        onChat={() => void openIncomingOfferChat(o)}
                        busy={busy}
                        accepted={status === "accepted"}
                        completed={status === "completed"}
                        declined={status === "declined"}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "activity" ? (
          <div className="content-stack">
            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">My interests</h2>
                  <p className="section-hint">Give posts you requested.</p>
                </div>
                <Chip label={`${myRequests.length}`} tone={myRequests.length ? "green" : "gray"} />
              </div>

              {myRequests.length === 0 ? (
                <EmptyState
                  title="No interests yet"
                  body="Go to the feed and request an item to see it here."
                  actionLabel="Browse feed"
                  onAction={() => router.push("/feed")}
                  compact
                />
              ) : (
                <div className="stack-list">
                  {myRequests.map((r, i) => (
                    <RequestRowCard
                      key={`${r.item_id}-${r.created_at ?? i}`}
                      photoUrl={r.item?.photo_url ?? null}
                      title={r.item?.title ?? "Unknown post"}
                      subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}Status: ${r.item?.status ?? "—"}`}
                      chips={[
                        { label: "Interest sent", tone: "green" },
                        { label: itemTypeLabel(r.item?.post_type ?? "give"), tone: "gray" },
                      ]}
                      primaryLabel="View"
                      onPrimary={() => router.push(`/item/${r.item_id}`)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="section-head">
                <div>
                  <h2 className="section-title sm">My offers</h2>
                  <p className="section-hint">Request posts where you offered help.</p>
                </div>
                <Chip label={`${myOffers.length}`} tone={myOffers.length ? "green" : "gray"} />
              </div>

              {myOffers.length === 0 ? (
                <EmptyState
                  title="No offers yet"
                  body="Find a request post in the feed and offer help."
                  actionLabel="Browse feed"
                  onAction={() => router.push("/feed")}
                  compact
                />
              ) : (
                <div className="stack-list">
                  {myOffers.map((o) => {
                    const status = (o.status ?? "pending") as OfferStatus;
                    const acting = myOfferBusyId === o.id;

                    return (
                      <OfferRowCard
                        key={o.id}
                        icon="🙌"
                        title={`You offered help on ${o.request_item?.title ?? "a request"}`}
                        subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                        note={o.note}
                        statusLabel={status}
                        onView={() => router.push(`/item/${o.request_id}`)}
                        onChat={() => void openMyOfferChat(o)}
                        onDecline={() => void withdrawMyOffer(o)}
                        busy={acting}
                        accepted={status === "accepted"}
                        completed={status === "completed"}
                        declined={false}
                        customDeclineLabel={acting ? "Working…" : "Withdraw"}
                        hideAccept
                        hideHold
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === "history" ? (
          <div className="content-stack">
            <section className="panel-soft">
              <h2 className="section-title sm">Completed listings</h2>
              <p className="section-hint">These were claimed or completed and are now archived.</p>
            </section>

            {completedListings.length === 0 ? (
              <EmptyState title="No completed listings yet" body="Finished posts will move here automatically." compact />
            ) : (
              <div className="card-grid">
                {completedListings.map((item) => (
                  <HistoryCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {confirm ? (
          <ConfirmModal
            title={confirm.title}
            body={confirm.body}
            actionLabel={confirm.actionLabel}
            onCancel={() => setConfirm(null)}
            onConfirm={confirm.onYes}
          />
        ) : null}

        {toast ? <Toast msg={toast.msg} kind={toast.kind} /> : null}
      </div>

      <PageStyles />
    </div>
  );
}

/* ==============================
   COMPONENTS
============================== */

function MetricCard({
  label,
  value,
  hint,
  onClick,
  highlight,
}: {
  label: string;
  value: number;
  hint: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  return (
    <button onClick={onClick} className={`metric-card ${highlight ? "highlight" : ""}`} type="button">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </button>
  );
}

function AttentionCard({
  title,
  body,
  cta,
  onClick,
}: {
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="attention-card">
      <div>
        <div className="attention-title">{title}</div>
        <div className="attention-body">{body}</div>
      </div>
      <button onClick={onClick} className="btn btn-primary inline top-gap" type="button">
        {cta}
      </button>
    </div>
  );
}

function QuickActionCard({
  emoji,
  title,
  body,
  actionLabel,
  onClick,
  primary,
}: {
  emoji: string;
  title: string;
  body: string;
  actionLabel: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <div className={`quick-card ${primary ? "primary" : ""}`}>
      <div className="quick-emoji">{emoji}</div>
      <div className="quick-title">{title}</div>
      <div className="quick-body">{body}</div>
      <button onClick={onClick} className={`btn ${primary ? "btn-primary" : "btn-secondary"} inline top-gap`} type="button">
        {actionLabel}
      </button>
    </div>
  );
}

function NotificationCard({
  title,
  body,
  meta,
  isNew,
  onClick,
}: {
  title: string;
  body: string;
  meta: string;
  isNew: boolean;
  onClick: () => void;
}) {
  return (
    <button className="notif-card" onClick={onClick} type="button">
      <div className="notif-head">
        <div className="notif-title-wrap">
          <div className="notif-title">{title}</div>
          <div className="notif-body">{body}</div>
        </div>
        <Chip label={isNew ? "New" : "Seen"} tone={isNew ? "red" : "gray"} />
      </div>
      <div className="notif-meta">{meta}</div>
    </button>
  );
}

function CompactItemRow({
  title,
  subtitle,
  photoUrl,
  chip1,
  chip2,
  onClick,
  ctaLabel,
}: {
  title: string;
  subtitle: string;
  photoUrl: string | null;
  chip1?: string;
  chip2?: string;
  onClick: () => void;
  ctaLabel: string;
}) {
  return (
    <div className="compact-row">
      <MediaThumb photoUrl={photoUrl} label={title} size={62} />
      <div className="compact-copy">
        <div className="compact-title">{title}</div>
        <div className="compact-sub">{subtitle}</div>
        <div className="chip-row top-gap-sm">
          {chip1 ? <Chip label={chip1} tone="gray" /> : null}
          {chip2 ? <Chip label={chip2} tone={toneForStatus(chip2)} /> : null}
        </div>
      </div>
      <button onClick={onClick} className="btn btn-secondary inline" type="button">
        {ctaLabel}
      </button>
    </div>
  );
}

function CompactTextRow({
  icon,
  title,
  subtitle,
  onClick,
  ctaLabel,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  ctaLabel: string;
}) {
  return (
    <div className="compact-row">
      <div className="icon-pill">{icon}</div>
      <div className="compact-copy">
        <div className="compact-title">{title}</div>
        <div className="compact-sub">{subtitle}</div>
      </div>
      <button onClick={onClick} className="btn btn-secondary inline" type="button">
        {ctaLabel}
      </button>
    </div>
  );
}

function ListingCard({
  item,
  deleting,
  onManage,
  onEdit,
  onDelete,
}: {
  item: MyItemRow;
  deleting: boolean;
  onManage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="listing-card">
      <div className="listing-image-wrap">
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} className="listing-image" />
        ) : (
          <div className="listing-image-fallback">{itemTypeLabel(item.post_type)}</div>
        )}

        <div className="listing-top-badges">
          <Chip label={itemTypeLabel(item.post_type)} tone="gray" />
          <Chip label={item.status ?? "—"} tone={toneForStatus(item.status)} />
        </div>
      </div>

      <div className="listing-body">
        <div className="listing-title">{item.title}</div>
        <div className="listing-sub">{item.description || "No description provided yet."}</div>
        <div className="listing-meta">Posted {fmtWhen(item.created_at)}</div>

        <div className="listing-actions">
          <button onClick={onManage} className="btn btn-primary inline" type="button">
            Manage
          </button>
          <button onClick={onEdit} className="btn btn-secondary inline" type="button">
            Edit
          </button>
          <button onClick={onDelete} disabled={deleting} className="btn btn-danger inline" type="button">
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ item }: { item: MyItemRow }) {
  return (
    <div className="listing-card history-card">
      <div className="listing-image-wrap">
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} className="listing-image" />
        ) : (
          <div className="listing-image-fallback">Completed</div>
        )}
      </div>

      <div className="listing-body">
        <div className="listing-title">{item.title}</div>
        <div className="listing-sub">{item.description || "No description provided."}</div>
        <div className="chip-row top-gap-sm">
          <Chip label={itemTypeLabel(item.post_type)} tone="gray" />
          <Chip label="Completed" tone="green" />
        </div>
        <div className="listing-meta">Posted {fmtWhen(item.created_at)}</div>
      </div>
    </div>
  );
}

function RequestRowCard({
  photoUrl,
  title,
  subtitle,
  chips,
  primaryLabel,
  onPrimary,
}: {
  photoUrl: string | null;
  title: string;
  subtitle: string;
  chips?: Array<{ label: string; tone: "green" | "amber" | "red" | "gray" }>;
  primaryLabel: string;
  onPrimary: () => void;
}) {
  return (
    <div className="row-card">
      <div className="row-main">
        <MediaThumb photoUrl={photoUrl} label={title} size={68} />
        <div className="row-copy">
          <div className="row-title">{title}</div>
          <div className="row-meta">{subtitle}</div>
          {chips?.length ? (
            <div className="chip-row top-gap-sm">
              {chips.map((chip, i) => (
                <Chip key={`${chip.label}-${i}`} label={chip.label} tone={chip.tone} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="action-row">
        <button onClick={onPrimary} className="btn btn-primary inline" type="button">
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

function OfferRowCard({
  icon,
  title,
  subtitle,
  note,
  statusLabel,
  onView,
  onAccept,
  onHold,
  onDecline,
  onChat,
  busy,
  accepted,
  completed,
  declined,
  customDeclineLabel,
  hideAccept,
  hideHold,
}: {
  icon: string;
  title: string;
  subtitle: string;
  note?: string | null;
  statusLabel: string;
  onView: () => void;
  onAccept?: () => void;
  onHold?: () => void;
  onDecline?: () => void;
  onChat: () => void;
  busy: boolean;
  accepted: boolean;
  completed: boolean;
  declined: boolean;
  customDeclineLabel?: string;
  hideAccept?: boolean;
  hideHold?: boolean;
}) {
  return (
    <div className="row-card">
      <div className="row-main">
        <div className="offer-icon-pill">{icon}</div>
        <div className="row-copy">
          <div className="row-title">{title}</div>
          <div className="row-meta">{subtitle}</div>
          <div className="chip-row top-gap-sm">
            <Chip label={statusLabel} tone={toneForStatus(statusLabel)} />
          </div>
          {note ? <div className="note-box">{note}</div> : null}
        </div>
      </div>

      <div className="action-row">
        <button onClick={onView} className="btn btn-secondary inline" type="button">
          View
        </button>

        {!hideAccept && onAccept ? (
          <button onClick={onAccept} disabled={busy || accepted || completed} className="btn btn-primary inline" type="button">
            {busy ? "Working…" : "Accept"}
          </button>
        ) : null}

        {!hideHold && onHold ? (
          <button onClick={onHold} disabled={busy || completed} className="btn btn-secondary inline" type="button">
            Hold
          </button>
        ) : null}

        {onDecline ? (
          <button onClick={onDecline} disabled={busy || completed || declined} className="btn btn-danger inline" type="button">
            {customDeclineLabel || "Decline"}
          </button>
        ) : null}

        <button onClick={onChat} disabled={busy || !accepted} className="btn btn-secondary inline" type="button">
          {busy ? "Opening…" : "Start chat"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  compact,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`empty-box ${compact ? "compact" : ""}`}>
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
      {actionLabel && onAction ? (
        <div className="top-gap">
          <button onClick={onAction} className="btn btn-secondary inline" type="button">
            {actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MediaThumb({
  photoUrl,
  label,
  size = 64,
}: {
  photoUrl: string | null;
  label: string;
  size?: number;
}) {
  return (
    <div className="media-thumb" style={{ width: size, height: size }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} className="media-thumb-img" />
      ) : (
        "—"
      )}
    </div>
  );
}

function Chip({
  label,
  tone = "gray",
}: {
  label: string;
  tone?: "green" | "amber" | "red" | "gray";
}) {
  return <span className={`chip ${tone}`}>{label}</span>;
}

function Toast({ msg, kind = "ok" }: { msg: string; kind?: "ok" | "err" }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className={`toast-mark ${kind}`}>{kind === "err" ? "⚠" : "✓"}</span>
      {msg}
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  actionLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{body}</div>
        <div className="confirm-actions">
          <button onClick={onCancel} disabled={busy} className="btn btn-secondary full" type="button">
            Cancel
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="btn btn-primary full"
            type="button"
          >
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageStyles() {
  return (
    <style jsx global>{`
      * {
        box-sizing: border-box;
      }

      html,
      body {
        max-width: 100%;
        overflow-x: hidden;
      }

      .account-page {
        min-height: 100vh;
        background: linear-gradient(180deg, #f8fafc 0%, #f4f5f7 45%, #eef2f7 100%);
        color: #111827;
      }

      .page-shell {
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        padding: 12px;
        padding-bottom: calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 24px);
      }

      .page-shell.narrow {
        max-width: 760px;
      }

      .hero-card,
      .panel,
      .panel-soft,
      .attention-card,
      .listing-card,
      .row-card,
      .quick-card,
      .metric-card,
      .empty-box,
      .auth-form-panel,
      .notif-card {
        min-width: 0;
      }

      .hero-card {
        border-radius: 28px;
        border: 1px solid rgba(229, 231, 235, 0.9);
        background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.90) 100%);
        box-shadow: 0 20px 60px rgba(15,23,42,0.08);
        padding: 16px;
      }

      .hero-mobile-first {
        display: grid;
        gap: 14px;
      }

      .hero-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
      }

      .hero-copy {
        min-width: 0;
        flex: 1;
      }

      .eyebrow {
        font-size: 12px;
        color: #065f46;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.35px;
      }

      .hero-title {
        margin: 6px 0 0;
        font-size: clamp(28px, 7vw, 40px);
        line-height: 1.02;
        font-weight: 950;
        color: #111827;
        word-break: break-word;
      }

      .clamp-title {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .hero-sub {
        margin: 8px 0 0;
        color: #4b5563;
        font-size: 14px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .hero-copy-sub {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      .dot {
        color: #9ca3af;
      }

      .email-chip {
        max-width: 100%;
        overflow-wrap: anywhere;
      }

      .avatar-large {
        width: 72px;
        height: 72px;
        border-radius: 22px;
        border: 1px solid #e5e7eb;
        background: linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 72px;
        font-size: 28px;
        font-weight: 950;
      }

      .hero-chip-row,
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
      }

      .hero-action-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        align-items: stretch;
      }

      .btn {
        appearance: none;
        border: none;
        outline: none;
        min-width: 0;
        cursor: pointer;
        transition: 0.18s ease;
        font-weight: 900;
      }

      .btn:disabled {
        opacity: 0.64;
        cursor: not-allowed;
      }

      .btn.full {
        width: 100%;
      }

      .btn.inline {
        min-height: 42px;
        padding: 0 14px;
        border-radius: 14px;
      }

      .btn.compact-btn {
        min-height: 42px;
        padding: 0 14px;
        border-radius: 14px;
      }

      .btn-primary {
        min-height: 48px;
        border: 1px solid rgba(16,185,129,0.35);
        background: linear-gradient(180deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.10) 100%);
        color: #065f46;
        border-radius: 16px;
        padding: 0 16px;
      }

      .btn-secondary {
        min-height: 48px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #111827;
        border-radius: 16px;
        padding: 0 16px;
      }

      .btn-danger {
        min-height: 48px;
        border: 1px solid rgba(185,28,28,0.28);
        background: #fff;
        color: #991b1b;
        border-radius: 16px;
        padding: 0 16px;
      }

      .stats-grid {
        display: grid;
        gap: 10px;
      }

      .mobile-stats-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metric-card {
        text-align: left;
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: #fff;
        padding: 14px;
        box-shadow: 0 8px 22px rgba(15,23,42,0.04);
      }

      .metric-card.highlight {
        border-color: rgba(16,185,129,0.32);
        background: rgba(16,185,129,0.08);
      }

      .metric-label {
        font-size: 12px;
        font-weight: 900;
        color: #6b7280;
      }

      .metric-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 950;
        color: #111827;
        line-height: 1;
      }

      .metric-hint {
        margin-top: 6px;
        font-size: 12px;
        color: #6b7280;
        line-height: 1.35;
      }

      .attention-section,
      .content-stack {
        margin-top: 14px;
        display: grid;
        gap: 14px;
      }

      .section-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
      }

      .section-title {
        margin: 0;
        font-size: 22px;
        font-weight: 950;
        color: #111827;
      }

      .section-title.sm {
        font-size: 18px;
      }

      .section-hint {
        margin: 6px 0 0;
        font-size: 13px;
        color: #6b7280;
        line-height: 1.45;
      }

      .attention-grid,
      .quick-grid,
      .two-col-grid,
      .card-grid {
        display: grid;
        gap: 12px;
      }

      .attention-grid {
        grid-template-columns: 1fr;
      }

      .quick-grid {
        grid-template-columns: 1fr;
      }

      .two-col-grid {
        grid-template-columns: 1fr;
      }

      .card-grid {
        grid-template-columns: 1fr;
      }

      .attention-card {
        border-radius: 22px;
        border: 1px solid rgba(16,185,129,0.22);
        background: linear-gradient(180deg, rgba(16,185,129,0.10) 0%, rgba(255,255,255,1) 100%);
        padding: 16px;
        box-shadow: 0 12px 30px rgba(16,185,129,0.06);
      }

      .attention-title {
        font-size: 18px;
        font-weight: 950;
        color: #111827;
        line-height: 1.25;
      }

      .attention-body {
        margin-top: 6px;
        color: #4b5563;
        line-height: 1.45;
      }

      .tab-sticky-wrap {
        position: sticky;
        top: 0;
        z-index: 20;
        padding-top: 8px;
        margin-top: 14px;
      }

      .tabs-shell {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 6px;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: rgba(255,255,255,0.88);
        backdrop-filter: blur(10px);
        scrollbar-width: none;
      }

      .tabs-shell::-webkit-scrollbar {
        display: none;
      }

      .tab-btn {
        flex: 0 0 auto;
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 14px;
        border: 1px solid transparent;
        background: transparent;
        color: #111827;
        padding: 0 14px;
        font-weight: 900;
        white-space: nowrap;
      }

      .tab-btn.active {
        border-color: rgba(16,185,129,0.30);
        background: rgba(16,185,129,0.12);
        color: #065f46;
      }

      .badge-red {
        min-width: 20px;
        height: 20px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        font-size: 11px;
        font-weight: 900;
        background: #ef4444;
        color: #fff;
      }

      .panel,
      .panel-soft,
      .auth-form-panel {
        border-radius: 24px;
        border: 1px solid #e5e7eb;
        padding: 16px;
      }

      .panel,
      .auth-form-panel {
        background: #fff;
        box-shadow: 0 12px 32px rgba(15,23,42,0.06);
      }

      .panel-soft {
        background: rgba(255,255,255,0.72);
      }

      .stack-list {
        margin-top: 14px;
        display: grid;
        gap: 12px;
      }

      .quick-card {
        border-radius: 22px;
        border: 1px solid #e5e7eb;
        background: #fff;
        padding: 16px;
        min-height: 180px;
        display: flex;
        flex-direction: column;
      }

      .quick-card.primary {
        border-color: rgba(16,185,129,0.32);
        background: rgba(16,185,129,0.08);
      }

      .quick-emoji {
        width: 46px;
        height: 46px;
        border-radius: 16px;
        background: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
      }

      .quick-title {
        margin-top: 12px;
        font-size: 16px;
        font-weight: 950;
        color: #111827;
      }

      .quick-body {
        margin-top: 6px;
        color: #4b5563;
        line-height: 1.45;
      }

      .notif-card {
        width: 100%;
        text-align: left;
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #fff;
        padding: 14px;
        box-shadow: 0 8px 22px rgba(15,23,42,0.04);
      }

      .notif-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }

      .notif-title-wrap {
        min-width: 0;
        flex: 1;
      }

      .notif-title {
        font-size: 15px;
        font-weight: 950;
        color: #111827;
      }

      .notif-body {
        margin-top: 4px;
        color: #6b7280;
        line-height: 1.45;
      }

      .notif-meta {
        margin-top: 8px;
        font-size: 12px;
        color: #6b7280;
        font-weight: 800;
      }

      .compact-row,
      .row-card {
        border-radius: 20px;
        border: 1px solid #e5e7eb;
        background: #fff;
      }

      .compact-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
      }

      .compact-copy,
      .row-copy {
        min-width: 0;
        flex: 1;
      }

      .compact-title,
      .row-title,
      .listing-title,
      .empty-title,
      .modal-title {
        font-weight: 950;
        color: #111827;
      }

      .compact-title,
      .row-title {
        font-size: 15px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .compact-sub,
      .row-meta,
      .listing-sub,
      .empty-body,
      .modal-body {
        color: #6b7280;
        line-height: 1.45;
      }

      .compact-sub,
      .row-meta {
        margin-top: 4px;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .icon-pill,
      .offer-icon-pill,
      .media-thumb {
        flex-shrink: 0;
      }

      .icon-pill {
        width: 62px;
        height: 62px;
        border-radius: 18px;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
      }

      .media-thumb {
        border-radius: 18px;
        border: 1px solid #e5e7eb;
        background: #f3f4f6;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
      }

      .media-thumb-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .listing-card {
        overflow: hidden;
        box-shadow: 0 14px 32px rgba(15,23,42,0.06);
        border-radius: 24px;
        border: 1px solid #e5e7eb;
        background: #fff;
      }

      .history-card {
        background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%);
      }

      .listing-image-wrap {
        position: relative;
        width: 100%;
        height: 188px;
        background: #f3f4f6;
        border-top-left-radius: 24px;
        border-top-right-radius: 24px;
        overflow: hidden;
      }

      .listing-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .listing-image-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
        font-weight: 900;
      }

      .listing-top-badges {
        position: absolute;
        left: 12px;
        top: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .listing-body {
        padding: 14px;
      }

      .listing-title {
        font-size: 18px;
        line-height: 1.25;
      }

      .listing-sub {
        margin-top: 8px;
        font-size: 14px;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .listing-meta {
        margin-top: 12px;
        font-size: 12px;
        color: #6b7280;
        font-weight: 800;
      }

      .listing-actions,
      .action-row {
        margin-top: 14px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .row-card {
        padding: 14px;
        box-shadow: 0 10px 24px rgba(15,23,42,0.05);
      }

      .row-main {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
      }

      .offer-icon-pill {
        width: 68px;
        height: 68px;
        border-radius: 20px;
        background: rgba(16,185,129,0.08);
        border: 1px solid rgba(16,185,129,0.18);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
      }

      .note-box {
        margin-top: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #f9fafb;
        border: 1px solid #eef0f3;
        font-size: 13px;
        color: #374151;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .empty-box {
        border: 1px dashed #d1d5db;
        background: #fff;
        padding: 18px;
        border-radius: 24px;
      }

      .empty-box.compact {
        padding: 14px;
        border-radius: 18px;
      }

      .empty-title {
        font-size: 18px;
      }

      .modal-body,
      .empty-body {
        margin-top: 6px;
      }

      .input {
        width: 100%;
        height: 48px;
        border-radius: 16px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #111827;
        padding: 0 14px;
        margin-top: 12px;
        font-weight: 800;
      }

      .auth-card {
        display: grid;
        gap: 12px;
      }

      .seg-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .seg-btn {
        min-height: 42px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #111827;
        font-weight: 900;
      }

      .seg-btn.active {
        border-color: rgba(16,185,129,0.35);
        background: rgba(16,185,129,0.12);
        color: #065f46;
      }

      .auth-button-stack {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }

      .error-text {
        margin-top: 12px;
        color: #b91c1c;
        font-weight: 900;
      }

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(17,24,39,0.38);
        z-index: 9998;
      }

      .modal {
        position: fixed;
        left: 12px;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 24px;
        padding: 16px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.14);
      }

      .confirm-actions {
        margin-top: 16px;
        display: grid;
        gap: 10px;
      }

      .toast {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 16px);
        z-index: 99999;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 16px;
        padding: 12px 14px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #111827;
        box-shadow: 0 18px 50px rgba(0,0,0,0.14);
        font-weight: 900;
        max-width: min(560px, calc(100vw - 24px));
      }

      .toast-mark.ok {
        color: #065f46;
      }

      .toast-mark.err {
        color: #b91c1c;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        border-radius: 999px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .chip.green {
        border: 1px solid rgba(16,185,129,0.25);
        background: rgba(16,185,129,0.10);
        color: #065f46;
      }

      .chip.amber {
        border: 1px solid rgba(245,158,11,0.25);
        background: rgba(245,158,11,0.10);
        color: #92400e;
      }

      .chip.red {
        border: 1px solid rgba(239,68,68,0.25);
        background: rgba(239,68,68,0.10);
        color: #991b1b;
      }

      .chip.gray {
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #374151;
      }

      .link-btn {
        border: none;
        background: transparent;
        color: #065f46;
        font-weight: 900;
        cursor: pointer;
        padding: 0;
      }

      .top-gap {
        margin-top: 14px;
      }

      .top-gap-sm {
        margin-top: 8px;
      }

      .skeleton-shell {
        display: grid;
        gap: 12px;
      }

      .skel {
        background: #e5e7eb;
        border-radius: 14px;
      }

      .skel-avatar {
        width: 72px;
        height: 72px;
        border-radius: 22px;
      }

      .skel-line.lg {
        width: 68%;
        height: 24px;
      }

      .skel-line.md {
        width: 84%;
        height: 16px;
      }

      .skel-btn {
        height: 46px;
        width: 100%;
      }

      @media (min-width: 700px) {
        .page-shell {
          padding: 16px;
        }

        .hero-card {
          padding: 18px;
        }

        .mobile-stats-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .attention-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .quick-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .two-col-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .card-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .confirm-actions {
          grid-template-columns: 1fr 1fr;
        }

        .auth-button-stack {
          grid-template-columns: 1fr 1fr;
        }

        .modal {
          left: 50%;
          right: auto;
          width: min(520px, calc(100vw - 24px));
          transform: translate(-50%, -50%);
        }
      }

      @media (max-width: 560px) {
        .page-shell {
          padding-left: 10px;
          padding-right: 10px;
        }

        .hero-title {
          font-size: 24px;
        }

        .hero-action-grid {
          grid-template-columns: 1fr;
        }

        .compact-row {
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .compact-row > .btn.inline {
          width: 100%;
        }

        .action-row,
        .listing-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
        }

        .action-row > .btn.inline,
        .listing-actions > .btn.inline {
          width: 100%;
          min-width: 0;
        }
      }

      @media (max-width: 430px) {
        .hero-head {
          gap: 10px;
        }

        .avatar-large {
          width: 60px;
          height: 60px;
          flex-basis: 60px;
          font-size: 24px;
          border-radius: 18px;
        }

        .row-main {
          gap: 10px;
        }

        .offer-icon-pill {
          width: 56px;
          height: 56px;
          font-size: 22px;
          border-radius: 16px;
        }

        .media-thumb {
          border-radius: 16px;
        }
      }
    `}</style>
  );
}