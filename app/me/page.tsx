"use client";

export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread } from "@/lib/ensureThread";

/* ==============================
   TYPES
============================== */

type MediaTab = "give" | "request" | "event";
type GridMode = "active" | "archived";
type DrawerSection = "menu" | "notifications" | "requests" | "activity";
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

type NotificationType =
  | "item_interest_created"
  | "item_interest_accepted"
  | "item_interest_declined"
  | "help_offer_created"
  | "help_offer_accepted"
  | "help_offer_declined"
  | "event_joined"
  | "event_left"
  | "event_updated"
  | "message_received"
  | "system_notice"
  | string;

type NotificationRow = {
  id: string;
  recipient_id: string | null;
  actor_id: string | null;
  type: NotificationType;
  category: string | null;
  entity_type: string | null;
  entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_id: string | null;
  title: string | null;
  body: string | null;
  image_url: string | null;
  action_url: string | null;
  is_read: boolean | null;
  read_at: string | null;
  is_hidden: boolean | null;
  hidden_at: string | null;
  created_at: string;
};

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

function normStatus(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function isArchivedItem(item: MyItemRow) {
  const status = normStatus(item.status);
  const type = item.post_type ?? "give";

  if (type === "event") {
    return status === "completed";
  }

  return status === "claimed" || status === "completed";
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

function toneForStatus(status: string | null | undefined): "green" | "amber" | "red" | "gray" {
  const s = normStatus(status);
  if (["accepted", "reserved", "claimed", "completed"].includes(s)) return "green";
  if (["pending", "hold"].includes(s)) return "amber";
  if (["declined", "expired"].includes(s)) return "red";
  return "gray";
}

function itemTypeLabel(type: "give" | "request" | "event" | null | undefined) {
  if (type === "request") return "Request";
  if (type === "event") return "Event";
  return "Item";
}

function mediaTabLabel(tab: MediaTab) {
  if (tab === "request") return "Requests";
  if (tab === "event") return "Events";
  return "Items";
}

function matchesTab(item: MyItemRow, tab: MediaTab) {
  const t = item.post_type ?? "give";
  if (tab === "give") return t === "give" || t === null;
  return t === tab;
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

  const mountedRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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

  const [mediaTab, setMediaTab] = useState<MediaTab>("give");
  const [gridMode, setGridMode] = useState<GridMode>("active");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<DrawerSection>("menu");

  const [toast, setToast] = useState<ToastState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

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

  const itemsGive = useMemo(() => myItems.filter((x) => matchesTab(x, "give")), [myItems]);
  const itemsRequest = useMemo(() => myItems.filter((x) => matchesTab(x, "request")), [myItems]);
  const itemsEvent = useMemo(() => myItems.filter((x) => matchesTab(x, "event")), [myItems]);

  const currentTabItems = useMemo(() => {
    if (mediaTab === "give") return itemsGive;
    if (mediaTab === "request") return itemsRequest;
    return itemsEvent;
  }, [mediaTab, itemsGive, itemsRequest, itemsEvent]);

  const activeListingsCount = useMemo(() => {
    return currentTabItems.filter((x) => !isArchivedItem(x)).length;
  }, [currentTabItems]);

  const archivedListingsCount = useMemo(() => {
    return currentTabItems.filter((x) => isArchivedItem(x)).length;
  }, [currentTabItems]);

  const unseenNotificationCount = useMemo(
    () => notifications.filter((n) => !n.is_read && !n.is_hidden).length,
    [notifications]
  );

  const requestsCount = useMemo(() => {
    return incomingInterests.length + incomingOffers.length;
  }, [incomingInterests.length, incomingOffers.length]);

  const activityCount = useMemo(() => {
    return myRequests.length + myOffers.length;
  }, [myOffers.length, myRequests.length]);

  const gridSource = useMemo(() => {
    const source = mediaTab === "give" ? itemsGive : mediaTab === "request" ? itemsRequest : itemsEvent;
    return source.filter((x) => (gridMode === "active" ? !isArchivedItem(x) : isArchivedItem(x)));
  }, [gridMode, itemsEvent, itemsGive, itemsRequest, mediaTab]);

  const gridTotalForTab = useMemo(() => {
    if (mediaTab === "give") return itemsGive.length;
    if (mediaTab === "request") return itemsRequest.length;
    return itemsEvent.length;
  }, [itemsEvent.length, itemsGive.length, itemsRequest.length, mediaTab]);

  const showToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, 2200);
  }, []);

  const openDrawer = useCallback((section: DrawerSection) => {
    setDrawerSection(section);
    setDrawerOpen(true);
  }, []);

  const clearAll = useCallback(() => {
    setProfile(null);
    setMyItems([]);
    setMyRequests([]);
    setMyOffers([]);
    setIncomingInterests([]);
    setIncomingOffers([]);
    setNotifications([]);
    setErr(null);
    setDrawerOpen(false);
    setDrawerSection("menu");
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
    const [itemsRes, eventsRes] = await Promise.all([
      supabase
        .from("items")
        .select("id,title,description,status,created_at,photo_url,post_type")
        .eq("owner_id", uid),

      supabase
        .from("events")
        .select("id,title,description,created_at,photo_url,starts_at,ends_at")
        .eq("created_by", uid),
    ]);

    if (!mountedRef.current) return [] as MyItemRow[];

    if (itemsRes.error || eventsRes.error) {
      setMyItems([]);
      return [];
    }

    const itemRows = ((itemsRes.data ?? []) as MyItemRow[]).filter(Boolean);

    const now = Date.now();

    const eventRows: MyItemRow[] = (
      (eventsRes.data ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
        created_at: string;
        photo_url: string | null;
        starts_at: string;
        ends_at: string | null;
      }>
    ).map((event) => {
      const endTime = event.ends_at ?? event.starts_at;
      const isPast = new Date(endTime).getTime() < now;

      return {
        id: event.id,
        title: event.title,
        description: event.description ?? null,
        status: isPast ? "completed" : "available",
        created_at: event.created_at,
        photo_url: event.photo_url ?? null,
        post_type: "event",
      };
    });

    const rows = [...itemRows, ...eventRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

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
      .select(
        "id,recipient_id,actor_id,type,category,entity_type,entity_id,parent_entity_type,parent_entity_id,title,body,image_url,action_url,is_read,read_at,is_hidden,hidden_at,created_at"
      )
      .eq("recipient_id", uid)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!mountedRef.current) return [] as NotificationRow[];

    if (error) {
      setNotifications([]);
      return [];
    }

    const normalized: NotificationRow[] = ((data ?? []) as NotificationRow[]).filter((row) => !row.is_hidden);
    setNotifications(normalized);
    return normalized;
  }

  const loadAllFor = useCallback(async (uid: string) => {
    setLoading(true);
    setErr(null);

    try {
      await Promise.all([
        loadProfile(uid),
        loadMyListings(uid),
        loadMyRequests(uid),
        loadMyOffers(uid),
        loadIncomingInterests(uid),
        loadIncomingOffers(uid),
        loadNotifications(uid),
      ]);
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(getFriendlyError(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  async function markNotificationsSeen() {
    if (!userId) return;

    const unseenIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unseenIds.length === 0) return;

    setMarkingNotifs(true);

    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: nowIso })
        .in("id", unseenIds)
        .eq("recipient_id", userId);

      if (error) throw new Error(error.message);

      if (!mountedRef.current) return;

      setNotifications((prev) =>
        prev.map((n) => (unseenIds.includes(n.id) ? { ...n, is_read: true, read_at: nowIso } : n))
      );
      showToast("Notifications marked seen.");
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setMarkingNotifs(false);
    }
  }

  async function hideOfferNotifications(offerIds: string[]) {
    if (!userId || offerIds.length === 0) return;

    try {
      const nowIso = new Date().toISOString();
      await supabase
        .from("notifications")
        .update({ is_hidden: true, hidden_at: nowIso })
        .eq("recipient_id", userId)
        .in("entity_id", offerIds)
        .eq("entity_type", "offer");
    } catch {
      // ignore
    }

    if (!mountedRef.current) return;
    setNotifications((prev) =>
      prev.filter((n) => !(n.entity_type === "offer" && n.entity_id && offerIds.includes(n.entity_id)))
    );
  }

  async function openNotification(notification: NotificationRow) {
    if (!userId) return;

    try {
      if (!notification.is_read) {
        const nowIso = new Date().toISOString();

        const { error } = await supabase
          .from("notifications")
          .update({ is_read: true, read_at: nowIso })
          .eq("id", notification.id)
          .eq("recipient_id", userId);

        if (error) throw new Error(error.message);

        if (mountedRef.current) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === notification.id ? { ...n, is_read: true, read_at: nowIso } : n))
          );
        }
      }
    } catch {
      // ignore read-mark failure
    }

    setDrawerOpen(false);

    if (notification.action_url && notification.action_url.startsWith("/")) {
      router.push(notification.action_url);
      return;
    }

    if (notification.entity_type === "event" && notification.entity_id) {
      router.push(`/event/${notification.entity_id}`);
      return;
    }

    if (notification.parent_entity_type === "item" && notification.parent_entity_id) {
      router.push(`/manage/${notification.parent_entity_id}`);
      return;
    }

    if (notification.entity_type === "item" && notification.entity_id) {
      router.push(`/manage/${notification.entity_id}`);
      return;
    }

    router.push("/messages");
  }

  async function acceptIncomingOffer(offer: IncomingOfferRow) {
    if (!userId || incomingOfferBusyId) return;

    const requestKey = offer.request_item?.id ?? offer.request_id;
    if (!requestKey) {
      showToast("Missing request post.", "err");
      return;
    }

    setIncomingOfferBusyId(offer.id);

    try {
      const nowIso = new Date().toISOString();

      const siblingOffers = incomingOffers.filter(
        (x) => (x.request_item?.id ?? x.request_id) === requestKey && x.id !== offer.id
      );
      const siblingIds = siblingOffers.map((x) => x.id);

      if (siblingIds.length > 0) {
        const { error: declineOthersError } = await supabase
          .from("request_offers")
          .update({ status: "declined", updated_at: nowIso })
          .in("id", siblingIds);

        if (declineOthersError) throw new Error(declineOthersError.message);
      }

      const { error: acceptError } = await supabase
        .from("request_offers")
        .update({ status: "accepted", updated_at: nowIso })
        .eq("id", offer.id);

      if (acceptError) throw new Error(acceptError.message);

      const threadId = await ensureThread({
        itemId: requestKey,
        ownerId: userId,
        requesterId: offer.helper_id,
      });

      await hideOfferNotifications([offer.id, ...siblingIds]);

      if (!mountedRef.current) return;

      setIncomingOffers((prev) =>
        prev.filter((x) => (x.request_item?.id ?? x.request_id) !== requestKey)
      );

      setDrawerOpen(false);
      router.push(`/messages/${threadId}`);
    } catch (e) {
      showToast(getFriendlyError(e), "err");
    } finally {
      if (mountedRef.current) setIncomingOfferBusyId(null);
    }
  }

  async function declineIncomingOffer(offer: IncomingOfferRow) {
    if (incomingOfferBusyId) return;

    setIncomingOfferBusyId(offer.id);

    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("request_offers")
        .update({ status: "declined", updated_at: nowIso })
        .eq("id", offer.id);

      if (error) throw new Error(error.message);

      await hideOfferNotifications([offer.id]);

      if (!mountedRef.current) return;

      setIncomingOffers((prev) => prev.filter((x) => x.id !== offer.id));
      showToast("Offer declined.");
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

    const status = (offer.status ?? "pending") as OfferStatus;
    if (status !== "accepted" && status !== "completed") {
      showToast("Chat opens after acceptance.", "err");
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

      setDrawerOpen(false);
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
    if (!isLoggedIn || !userId) return;

    const channel = supabase
      .channel(`me-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        () => {
          void loadNotifications(userId);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isLoggedIn, userId]);

  if (loading) {
    return (
      <div className="account-page">
        <div className="page-shell">
          <div className="profile-card skeleton-shell">
            <div className="skel skel-head" />
            <div className="skel skel-pills" />
            <div className="skel skel-tabs" />
            <div className="skel skel-grid" />
          </div>
        </div>
        <PageStyles />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="account-page">
        <div className="page-shell auth-shell">
          <section className="auth-card">
            <div className="auth-eyebrow">My account</div>
            <h1 className="auth-title">Sign in to see your profile listings</h1>
            <p className="auth-sub">Use your Ashland email to manage your posts and profile.</p>

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

            <button onClick={() => void handleAuth()} disabled={authBusy} className="btn btn-primary full" type="button">
              {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
            </button>

            {err ? <div className="error-text">{err}</div> : null}
          </section>
        </div>
        <PageStyles />
      </div>
    );
  }

  return (
    <div className="account-page">
      <div className="page-shell">
        <section className="profile-card">
          <div className="profile-top">
            <div className="profile-left">
              <div className="profile-avatar">{displayName.slice(0, 1).toUpperCase()}</div>

              <div className="profile-copy">
                <h1 className="profile-name">{displayName}</h1>
                <div className="profile-meta">
                  <span>{displayRole}</span>
                  <span className="dot">•</span>
                  <span className="break-any">{userEmail}</span>
                  {memberSince ? (
                    <>
                      <span className="dot">•</span>
                      <span>Joined {memberSince}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              className="menu-btn"
              onClick={() => openDrawer("menu")}
              type="button"
              aria-label="Open profile menu"
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          <div className="mini-stats">
            <button
              type="button"
              className={`mini-pill ${gridMode === "active" ? "active" : ""}`}
              onClick={() => setGridMode("active")}
            >
              <span className="mini-pill-label">Active</span>
              <span className="mini-pill-value">{activeListingsCount}</span>
            </button>

            <button type="button" className="mini-pill" onClick={() => openDrawer("requests")}>
              <span className="mini-pill-label">Requests</span>
              <span className="mini-pill-value">{requestsCount}</span>
            </button>

            <button type="button" className="mini-pill" onClick={() => openDrawer("activity")}>
              <span className="mini-pill-label">Activity</span>
              <span className="mini-pill-value">{activityCount}</span>
            </button>

            <button
              type="button"
              className={`mini-pill ${gridMode === "archived" ? "active" : ""}`}
              onClick={() => setGridMode("archived")}
            >
              <span className="mini-pill-label">Archived</span>
              <span className="mini-pill-value">{archivedListingsCount}</span>
            </button>
          </div>
        </section>

        <section className="content-head">
          <div className="media-tabs" role="tablist" aria-label="Listing types">
            <button
              type="button"
              className={`media-tab ${mediaTab === "give" ? "active" : ""}`}
              onClick={() => setMediaTab("give")}
            >
              Items
              <span className="media-tab-count">{itemsGive.length}</span>
            </button>
            <button
              type="button"
              className={`media-tab ${mediaTab === "request" ? "active" : ""}`}
              onClick={() => setMediaTab("request")}
            >
              Requests
              <span className="media-tab-count">{itemsRequest.length}</span>
            </button>
            <button
              type="button"
              className={`media-tab ${mediaTab === "event" ? "active" : ""}`}
              onClick={() => setMediaTab("event")}
            >
              Events
              <span className="media-tab-count">{itemsEvent.length}</span>
            </button>
          </div>
        </section>

        <section className="grid-wrap">
          {gridSource.length === 0 ? (
            <EmptyGridState
              title={
                gridMode === "active"
                  ? `No active ${mediaTabLabel(mediaTab).toLowerCase()} yet`
                  : `No archived ${mediaTabLabel(mediaTab).toLowerCase()} yet`
              }
              body={
                gridMode === "active"
                  ? `Your live ${mediaTabLabel(mediaTab).toLowerCase()} will show here.`
                  : `Completed ${mediaTabLabel(mediaTab).toLowerCase()} will show here when they move to archive.`
              }
            />
          ) : (
            <>
              <div className="grid-topline">
                <div className="grid-title">
                  {mediaTabLabel(mediaTab)} · {gridMode === "active" ? "Live" : "Archived"}
                </div>
                <div className="grid-sub">
                  {gridSource.length} shown · {gridTotalForTab} total
                </div>
              </div>

              <div className="listing-grid">
                {gridSource.map((item) => (
                  <ProfileMediaCard
                    key={item.id}
                    item={item}
                    onClick={() =>
                      router.push(item.post_type === "event" ? `/event/${item.id}` : `/manage/${item.id}`)
                    }
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {drawerOpen ? (
          <SideDrawer
            open={drawerOpen}
            section={drawerSection}
            onClose={() => setDrawerOpen(false)}
            onBack={() => setDrawerSection("menu")}
          >
            {drawerSection === "menu" ? (
              <div className="drawer-stack">
                <DrawerMenuRow
                  label="Notifications"
                  meta={unseenNotificationCount ? `${unseenNotificationCount} new` : "Nothing new"}
                  onClick={() => setDrawerSection("notifications")}
                  highlight={unseenNotificationCount > 0}
                />
                <DrawerMenuRow
                  label="Requests on my posts"
                  meta={requestsCount ? `${requestsCount} waiting` : "All clear"}
                  onClick={() => setDrawerSection("requests")}
                  highlight={requestsCount > 0}
                />
                <DrawerMenuRow
                  label="My activity"
                  meta={activityCount ? `${activityCount} records` : "No recent activity"}
                  onClick={() => setDrawerSection("activity")}
                />
                <button className="drawer-danger-btn" onClick={() => void signOut()} type="button">
                  Sign out
                </button>
              </div>
            ) : null}

            {drawerSection === "notifications" ? (
              <div className="drawer-stack">
                <div className="drawer-headline-row">
                  <div>
                    <div className="drawer-title">Notifications</div>
                    <div className="drawer-sub">Only the remaining alerts stay here.</div>
                  </div>
                  <button
                    onClick={() => void markNotificationsSeen()}
                    disabled={markingNotifs || unseenNotificationCount === 0}
                    className="btn btn-secondary inline"
                    type="button"
                  >
                    {markingNotifs ? "Working…" : "Mark seen"}
                  </button>
                </div>

                {notifications.length === 0 ? (
                  <DrawerEmpty title="No notifications" body="New alerts will appear here." />
                ) : (
                  notifications.map((n) => (
                    <NotificationCard
                      key={n.id}
                      title={n.title || "Notification"}
                      body={n.body || "Open to see details."}
                      meta={fmtWhen(n.created_at)}
                      isNew={!n.is_read}
                      onClick={() => void openNotification(n)}
                    />
                  ))
                )}
              </div>
            ) : null}

            {drawerSection === "requests" ? (
              <div className="drawer-stack">
                <div>
                  <div className="drawer-title">Requests on my posts</div>
                  <div className="drawer-sub">Handle incoming asks and helper offers here.</div>
                </div>

                <DrawerSectionCard title="Incoming item requests" count={incomingInterests.length}>
                  {incomingInterests.length === 0 ? (
                    <DrawerEmpty title="No item requests" body="When someone requests your item, it appears here." />
                  ) : (
                    incomingInterests.map((r) => (
                      <InterestCard
                        key={r.id}
                        photoUrl={r.item?.photo_url ?? null}
                        title={`${readableName(r.requester)} requested ${r.item?.title ?? "your post"}`}
                        subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}Status: ${r.item?.status ?? "—"}`}
                        chips={[
                          { label: itemTypeLabel(r.item?.post_type ?? "give"), tone: "gray" },
                          { label: r.item?.status ?? "—", tone: toneForStatus(r.item?.status) },
                        ]}
                        onManage={() => {
                          setDrawerOpen(false);
                          router.push(`/manage/${r.item_id}`);
                        }}
                      />
                    ))
                  )}
                </DrawerSectionCard>

                <DrawerSectionCard title="Incoming helper offers" count={incomingOffers.length}>
                  {incomingOffers.length === 0 ? (
                    <DrawerEmpty title="No helper offers" body="When someone offers help on your request post, it appears here." />
                  ) : (
                    incomingOffers.map((o) => {
                      const busy = incomingOfferBusyId === o.id;

                      return (
                        <IncomingOfferCard
                          key={o.id}
                          title={`${readableName(o.helper)} offered help on ${o.request_item?.title ?? "your request"}`}
                          subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                          note={o.note}
                          busy={busy}
                          onAccept={() => void acceptIncomingOffer(o)}
                          onDecline={() => void declineIncomingOffer(o)}
                        />
                      );
                    })
                  )}
                </DrawerSectionCard>
              </div>
            ) : null}

            {drawerSection === "activity" ? (
              <div className="drawer-stack">
                <div>
                  <div className="drawer-title">My activity</div>
                  <div className="drawer-sub">Things you requested or offered help on.</div>
                </div>

                <DrawerSectionCard title="My interests" count={myRequests.length}>
                  {myRequests.length === 0 ? (
                    <DrawerEmpty title="No interests yet" body="When you request an item, it appears here." />
                  ) : (
                    myRequests.map((r, i) => (
                      <InterestCard
                        key={`${r.item_id}-${r.created_at ?? i}`}
                        photoUrl={r.item?.photo_url ?? null}
                        title={r.item?.title ?? "Unknown post"}
                        subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}Status: ${r.item?.status ?? "—"}`}
                        chips={[
                          { label: "Interest sent", tone: "green" },
                          { label: itemTypeLabel(r.item?.post_type ?? "give"), tone: "gray" },
                        ]}
                        manageLabel="Open"
                        onManage={() => {
                          setDrawerOpen(false);
                          router.push(`/item/${r.item_id}`);
                        }}
                      />
                    ))
                  )}
                </DrawerSectionCard>

                <DrawerSectionCard title="My offers" count={myOffers.length}>
                  {myOffers.length === 0 ? (
                    <DrawerEmpty title="No offers yet" body="When you offer help on a request post, it appears here." />
                  ) : (
                    myOffers.map((o) => {
                      const status = (o.status ?? "pending") as OfferStatus;
                      const acting = myOfferBusyId === o.id;

                      return (
                        <MyOfferCard
                          key={o.id}
                          title={`You offered help on ${o.request_item?.title ?? "a request"}`}
                          subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                          note={o.note}
                          status={status}
                          busy={acting}
                          onPrimary={() =>
                            status === "accepted" || status === "completed"
                              ? void openMyOfferChat(o)
                              : void withdrawMyOffer(o)
                          }
                        />
                      );
                    })
                  )}
                </DrawerSectionCard>
              </div>
            ) : null}
          </SideDrawer>
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

function ProfileMediaCard({
  item,
  onClick,
}: {
  item: MyItemRow;
  onClick: () => void;
}) {
  const statusTone = toneForStatus(item.status);

  return (
    <button className="profile-media-card" onClick={onClick} type="button">
      <div className="profile-media-frame">
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} className="profile-media-img" />
        ) : (
          <div className={`profile-media-fallback ${item.post_type ?? "give"}`}>
            <span>{itemTypeLabel(item.post_type)}</span>
          </div>
        )}

        <div className="media-badge-row">
          <span className="media-type-badge">{itemTypeLabel(item.post_type)}</span>
        </div>

        <div className="media-gradient" />

        <div className="media-bottom">
          <div className="media-title">{item.title}</div>
          <div className="media-meta-row">
            <span className={`media-status ${statusTone}`}>{item.status ?? "—"}</span>
            <span className="media-date">{fmtShort(item.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="profile-media-copy">
        <div className="profile-media-desc">{item.description || "No description provided."}</div>
      </div>
    </button>
  );
}

function SideDrawer({
  open,
  section,
  onClose,
  onBack,
  children,
}: {
  open: boolean;
  section: DrawerSection;
  onClose: () => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-topbar">
          {section !== "menu" ? (
            <button type="button" className="drawer-nav-btn" onClick={onBack}>
              ←
            </button>
          ) : (
            <div className="drawer-nav-spacer" />
          )}

          <div className="drawer-topbar-title">Profile menu</div>

          <button type="button" className="drawer-nav-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  );
}

function DrawerMenuRow({
  label,
  meta,
  onClick,
  highlight,
}: {
  label: string;
  meta: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button type="button" className={`drawer-menu-row ${highlight ? "highlight" : ""}`} onClick={onClick}>
      <div className="drawer-menu-copy">
        <div className="drawer-menu-title">{label}</div>
        <div className="drawer-menu-meta">{meta}</div>
      </div>
      <div className="drawer-menu-arrow">→</div>
    </button>
  );
}

function DrawerSectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="drawer-section-card">
      <div className="drawer-section-head">
        <div className="drawer-section-title">{title}</div>
        <Chip label={`${count}`} tone={count ? "green" : "gray"} />
      </div>
      <div className="drawer-section-stack">{children}</div>
    </section>
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

function InterestCard({
  photoUrl,
  title,
  subtitle,
  chips,
  onManage,
  manageLabel = "Manage",
}: {
  photoUrl: string | null;
  title: string;
  subtitle: string;
  chips?: Array<{ label: string; tone: "green" | "amber" | "red" | "gray" }>;
  onManage: () => void;
  manageLabel?: string;
}) {
  return (
    <div className="interest-card">
      <div className="interest-main">
        <MediaThumb photoUrl={photoUrl} label={title} size={62} />
        <div className="interest-copy">
          <div className="interest-title">{title}</div>
          <div className="interest-sub">{subtitle}</div>
          {chips?.length ? (
            <div className="chip-row top-gap-sm">
              {chips.map((chip, i) => (
                <Chip key={`${chip.label}-${i}`} label={chip.label} tone={chip.tone} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <button onClick={onManage} className="btn btn-secondary inline" type="button">
        {manageLabel}
      </button>
    </div>
  );
}

function IncomingOfferCard({
  title,
  subtitle,
  note,
  busy,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle: string;
  note?: string | null;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="offer-card">
      <div className="offer-main">
        <div className="offer-icon-pill">🤝</div>
        <div className="offer-copy">
          <div className="offer-title">{title}</div>
          <div className="offer-sub">{subtitle}</div>
          {note ? <div className="note-box">{note}</div> : null}
        </div>
      </div>

      <div className="offer-actions">
        <button onClick={onAccept} disabled={busy} className="btn btn-primary inline" type="button">
          {busy ? "Opening…" : "Accept"}
        </button>
        <button onClick={onDecline} disabled={busy} className="btn btn-danger inline" type="button">
          Decline
        </button>
      </div>
    </div>
  );
}

function MyOfferCard({
  title,
  subtitle,
  note,
  status,
  busy,
  onPrimary,
}: {
  title: string;
  subtitle: string;
  note?: string | null;
  status: OfferStatus;
  busy: boolean;
  onPrimary: () => void;
}) {
  const primaryLabel = status === "accepted" || status === "completed" ? "Open chat" : "Withdraw";

  return (
    <div className="offer-card">
      <div className="offer-main">
        <div className="offer-icon-pill">🙌</div>
        <div className="offer-copy">
          <div className="offer-title">{title}</div>
          <div className="offer-sub">{subtitle}</div>
          <div className="chip-row top-gap-sm">
            <Chip label={status} tone={toneForStatus(status)} />
          </div>
          {note ? <div className="note-box">{note}</div> : null}
        </div>
      </div>

      <div className="offer-actions single">
        <button onClick={onPrimary} disabled={busy} className="btn btn-secondary inline" type="button">
          {busy ? "Working…" : primaryLabel}
        </button>
      </div>
    </div>
  );
}

function DrawerEmpty({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="drawer-empty">
      <div className="drawer-empty-title">{title}</div>
      <div className="drawer-empty-body">{body}</div>
    </div>
  );
}

function EmptyGridState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-grid">
      <div className="empty-grid-icon">⌁</div>
      <div className="empty-grid-title">{title}</div>
      <div className="empty-grid-body">{body}</div>
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

      :root {
        --bg: #f6f7f9;
        --panel: #ffffff;
        --line: #e7ebf0;
        --text: #111827;
        --muted: #6b7280;
      }

      .account-page {
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(16, 185, 129, 0.06), transparent 24%),
          linear-gradient(180deg, #fbfbfc 0%, #f5f7fa 100%);
        color: var(--text);
      }

      .page-shell {
        width: 100%;
        max-width: 1040px;
        margin: 0 auto;
        padding: 12px;
        padding-bottom: calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 24px);
      }

      .auth-shell {
        max-width: 560px;
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

      .btn-primary {
        min-height: 48px;
        border: 1px solid rgba(16, 185, 129, 0.3);
        background: linear-gradient(180deg, rgba(16, 185, 129, 0.18) 0%, rgba(16, 185, 129, 0.1) 100%);
        color: #065f46;
        border-radius: 16px;
        padding: 0 16px;
      }

      .btn-secondary {
        min-height: 48px;
        border: 1px solid var(--line);
        background: #fff;
        color: #111827;
        border-radius: 16px;
        padding: 0 16px;
      }

      .btn-danger {
        min-height: 48px;
        border: 1px solid rgba(185, 28, 28, 0.22);
        background: #fff;
        color: #991b1b;
        border-radius: 16px;
        padding: 0 16px;
      }

      .profile-card,
      .auth-card,
      .notif-card,
      .drawer-menu-row,
      .drawer-section-card,
      .interest-card,
      .offer-card,
      .empty-grid,
      .profile-media-card {
        min-width: 0;
      }

      .profile-card {
        border-radius: 28px;
        border: 1px solid rgba(231, 235, 240, 0.95);
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(10px);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.06);
        padding: 16px;
      }

      .profile-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
      }

      .profile-left {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
        flex: 1;
      }

      .profile-avatar {
        width: 76px;
        height: 76px;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 76px;
        font-size: 28px;
        font-weight: 950;
      }

      .profile-copy {
        min-width: 0;
        flex: 1;
      }

      .profile-name {
        margin: 0;
        font-size: clamp(26px, 6vw, 34px);
        line-height: 1.02;
        font-weight: 950;
        word-break: break-word;
      }

      .profile-meta {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
      }

      .dot {
        color: #9ca3af;
      }

      .break-any {
        overflow-wrap: anywhere;
      }

      .menu-btn {
        width: 46px;
        height: 46px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: #fff;
        display: inline-flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 4px;
        flex: 0 0 46px;
      }

      .menu-btn span {
        width: 18px;
        height: 2px;
        border-radius: 999px;
        background: #111827;
        display: block;
      }

      .mini-stats {
        margin-top: 14px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .mini-pill {
        border: 1px solid var(--line);
        background: #fff;
        border-radius: 18px;
        padding: 10px 10px 9px;
        min-height: 64px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
        text-align: left;
      }

      .mini-pill.active {
        border-color: rgba(16, 185, 129, 0.28);
        background: rgba(16, 185, 129, 0.08);
      }

      .mini-pill-label {
        font-size: 11px;
        font-weight: 900;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.25px;
      }

      .mini-pill-value {
        font-size: 18px;
        font-weight: 950;
        color: #111827;
        line-height: 1;
      }

      .content-head {
        position: sticky;
        top: 0;
        z-index: 18;
        margin-top: 14px;
        padding-top: 6px;
        background: linear-gradient(180deg, rgba(246, 247, 249, 0.96) 0%, rgba(246, 247, 249, 0.86) 100%);
        backdrop-filter: blur(10px);
      }

      .media-tabs {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.9);
        padding: 6px;
      }

      .media-tab {
        min-height: 46px;
        border: 1px solid transparent;
        border-radius: 16px;
        background: transparent;
        color: var(--text);
        font-weight: 900;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 10px;
      }

      .media-tab.active {
        border-color: rgba(16, 185, 129, 0.28);
        background: rgba(16, 185, 129, 0.1);
        color: #065f46;
      }

      .media-tab-count {
        min-width: 20px;
        height: 20px;
        border-radius: 999px;
        background: rgba(17, 24, 39, 0.08);
        color: inherit;
        font-size: 11px;
        font-weight: 950;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
      }

      .grid-wrap {
        margin-top: 14px;
      }

      .grid-topline {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 12px;
        margin-bottom: 12px;
        padding: 0 2px;
      }

      .grid-title {
        font-size: 16px;
        font-weight: 950;
        color: var(--text);
      }

      .grid-sub {
        font-size: 12px;
        color: var(--muted);
        font-weight: 800;
      }

      .listing-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .profile-media-card {
        text-align: left;
        border-radius: 24px;
        border: 1px solid var(--line);
        background: #fff;
        overflow: hidden;
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
      }

      .profile-media-frame {
        position: relative;
        aspect-ratio: 0.88;
        background: #eef2f7;
        overflow: hidden;
      }

      .profile-media-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .profile-media-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 950;
        letter-spacing: 0.4px;
        color: #111827;
      }

      .profile-media-fallback.give {
        background: linear-gradient(180deg, #f8fafc 0%, #e5e7eb 100%);
      }

      .profile-media-fallback.request {
        background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%);
      }

      .profile-media-fallback.event {
        background: linear-gradient(180deg, #faf5ff 0%, #ede9fe 100%);
      }

      .media-badge-row {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        display: flex;
        justify-content: flex-start;
      }

      .media-type-badge {
        min-height: 26px;
        border-radius: 999px;
        padding: 0 9px;
        background: rgba(17, 24, 39, 0.62);
        backdrop-filter: blur(8px);
        color: #fff;
        font-size: 10px;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
      }

      .media-gradient {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(17, 24, 39, 0) 38%, rgba(17, 24, 39, 0.84) 100%);
      }

      .media-bottom {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 12px;
      }

      .media-title {
        font-size: 14px;
        font-weight: 950;
        color: #fff;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .media-meta-row {
        margin-top: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .media-status {
        min-height: 24px;
        border-radius: 999px;
        padding: 0 8px;
        font-size: 10px;
        font-weight: 900;
        display: inline-flex;
        align-items: center;
      }

      .media-status.green {
        background: rgba(16, 185, 129, 0.18);
        color: #d1fae5;
      }

      .media-status.amber {
        background: rgba(245, 158, 11, 0.18);
        color: #fde68a;
      }

      .media-status.red {
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
      }

      .media-status.gray {
        background: rgba(255, 255, 255, 0.16);
        color: #f9fafb;
      }

      .media-date {
        font-size: 11px;
        font-weight: 900;
        color: rgba(255, 255, 255, 0.88);
      }

      .profile-media-copy {
        padding: 12px;
      }

      .profile-media-desc {
        font-size: 13px;
        color: #6b7280;
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .empty-grid {
        border: 1px dashed #d1d5db;
        background: rgba(255, 255, 255, 0.84);
        border-radius: 24px;
        min-height: 280px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 28px;
        text-align: center;
      }

      .empty-grid-icon {
        width: 52px;
        height: 52px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: #6b7280;
      }

      .empty-grid-title {
        margin-top: 14px;
        font-size: 20px;
        font-weight: 950;
        color: #111827;
      }

      .empty-grid-body {
        margin-top: 6px;
        max-width: 420px;
        color: #6b7280;
        line-height: 1.5;
      }

      .drawer-overlay {
        position: fixed;
        inset: 0;
        background: rgba(17, 24, 39, 0.34);
        z-index: 9998;
      }

      .drawer-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: min(92vw, 430px);
        height: 100vh;
        background: #fff;
        border-left: 1px solid var(--line);
        box-shadow: -16px 0 44px rgba(15, 23, 42, 0.16);
        display: flex;
        flex-direction: column;
      }

      .drawer-topbar {
        min-height: 62px;
        padding: 12px;
        border-bottom: 1px solid var(--line);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .drawer-topbar-title {
        font-size: 15px;
        font-weight: 950;
        color: #111827;
      }

      .drawer-nav-btn,
      .drawer-nav-spacer {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .drawer-nav-btn {
        border: 1px solid var(--line);
        background: #fff;
        color: #111827;
        font-weight: 900;
      }

      .drawer-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        padding-bottom: calc(env(safe-area-inset-bottom) + 24px);
      }

      .drawer-stack {
        display: grid;
        gap: 12px;
      }

      .drawer-menu-row {
        width: 100%;
        text-align: left;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .drawer-menu-row.highlight {
        border-color: rgba(16, 185, 129, 0.28);
        background: rgba(16, 185, 129, 0.08);
      }

      .drawer-menu-copy {
        min-width: 0;
        flex: 1;
      }

      .drawer-menu-title {
        font-size: 15px;
        font-weight: 950;
        color: #111827;
      }

      .drawer-menu-meta {
        margin-top: 4px;
        font-size: 13px;
        color: #6b7280;
        line-height: 1.45;
      }

      .drawer-menu-arrow {
        color: #6b7280;
        font-weight: 900;
      }

      .drawer-danger-btn {
        min-height: 48px;
        border-radius: 16px;
        border: 1px solid rgba(185, 28, 28, 0.22);
        background: #fff;
        color: #991b1b;
        font-weight: 900;
      }

      .drawer-title {
        font-size: 22px;
        font-weight: 950;
        color: #111827;
      }

      .drawer-sub {
        margin-top: 5px;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
      }

      .drawer-headline-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }

      .drawer-section-card {
        border-radius: 22px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 14px;
      }

      .drawer-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .drawer-section-title {
        font-size: 16px;
        font-weight: 950;
        color: #111827;
      }

      .drawer-section-stack {
        margin-top: 12px;
        display: grid;
        gap: 10px;
      }

      .notif-card {
        width: 100%;
        text-align: left;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 14px;
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

      .interest-card {
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 12px;
        display: grid;
        gap: 12px;
      }

      .interest-main {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
      }

      .interest-copy {
        min-width: 0;
        flex: 1;
      }

      .interest-title {
        font-size: 14px;
        font-weight: 950;
        color: #111827;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .interest-sub {
        margin-top: 4px;
        font-size: 13px;
        color: #6b7280;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .offer-card {
        border-radius: 18px;
        border: 1px solid var(--line);
        background: #fff;
        padding: 12px;
      }

      .offer-main {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 0;
      }

      .offer-icon-pill {
        width: 58px;
        height: 58px;
        border-radius: 18px;
        background: rgba(16, 185, 129, 0.08);
        border: 1px solid rgba(16, 185, 129, 0.18);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        flex-shrink: 0;
      }

      .offer-copy {
        min-width: 0;
        flex: 1;
      }

      .offer-title {
        font-size: 14px;
        font-weight: 950;
        color: #111827;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .offer-sub {
        margin-top: 4px;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .offer-actions {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .offer-actions.single {
        justify-content: flex-start;
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

      .drawer-empty {
        border: 1px dashed #d1d5db;
        background: #fff;
        border-radius: 18px;
        padding: 14px;
      }

      .drawer-empty-title {
        font-size: 15px;
        font-weight: 950;
        color: #111827;
      }

      .drawer-empty-body {
        margin-top: 5px;
        color: #6b7280;
        line-height: 1.45;
      }

      .media-thumb {
        border-radius: 16px;
        border: 1px solid var(--line);
        background: #f3f4f6;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
        flex-shrink: 0;
      }

      .media-thumb-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
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
        border: 1px solid rgba(16, 185, 129, 0.25);
        background: rgba(16, 185, 129, 0.1);
        color: #065f46;
      }

      .chip.amber {
        border: 1px solid rgba(245, 158, 11, 0.25);
        background: rgba(245, 158, 11, 0.1);
        color: #92400e;
      }

      .chip.red {
        border: 1px solid rgba(239, 68, 68, 0.25);
        background: rgba(239, 68, 68, 0.1);
        color: #991b1b;
      }

      .chip.gray {
        border: 1px solid var(--line);
        background: #f9fafb;
        color: #374151;
      }

      .auth-card {
        border-radius: 28px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.06);
        padding: 18px;
        display: grid;
        gap: 12px;
      }

      .auth-eyebrow {
        font-size: 12px;
        color: #065f46;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.32px;
      }

      .auth-title {
        margin: 0;
        font-size: 32px;
        line-height: 1.02;
        font-weight: 950;
      }

      .auth-sub {
        margin: 0;
        color: #6b7280;
        line-height: 1.5;
      }

      .seg-row {
        display: flex;
        gap: 8px;
      }

      .seg-btn {
        min-height: 42px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: #fff;
        color: #111827;
        font-weight: 900;
      }

      .seg-btn.active {
        border-color: rgba(16, 185, 129, 0.35);
        background: rgba(16, 185, 129, 0.12);
        color: #065f46;
      }

      .input {
        width: 100%;
        height: 48px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: #fff;
        color: #111827;
        padding: 0 14px;
        font-weight: 800;
      }

      .error-text {
        color: #b91c1c;
        font-weight: 900;
      }

      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(17, 24, 39, 0.38);
        z-index: 9999;
      }

      .modal {
        position: fixed;
        left: 12px;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 16px;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.14);
      }

      .modal-title {
        font-size: 18px;
        font-weight: 950;
        color: #111827;
      }

      .modal-body {
        margin-top: 6px;
        color: #6b7280;
        line-height: 1.45;
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
        border: 1px solid var(--line);
        background: #fff;
        color: #111827;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.14);
        font-weight: 900;
        max-width: min(560px, calc(100vw - 24px));
      }

      .toast-mark.ok {
        color: #065f46;
      }

      .toast-mark.err {
        color: #b91c1c;
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
        border-radius: 16px;
      }

      .skel-head {
        width: 100%;
        height: 92px;
      }

      .skel-pills {
        width: 100%;
        height: 68px;
      }

      .skel-tabs {
        width: 100%;
        height: 56px;
      }

      .skel-grid {
        width: 100%;
        height: 420px;
      }

      @media (min-width: 700px) {
        .page-shell {
          padding: 16px;
        }

        .profile-card {
          padding: 18px;
        }

        .listing-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .confirm-actions {
          grid-template-columns: 1fr 1fr;
        }

        .modal {
          left: 50%;
          right: auto;
          width: min(520px, calc(100vw - 24px));
          transform: translate(-50%, -50%);
        }
      }

      @media (min-width: 1024px) {
        .listing-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      @media (max-width: 560px) {
        .page-shell {
          padding-left: 10px;
          padding-right: 10px;
        }

        .profile-avatar {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          flex-basis: 64px;
          font-size: 24px;
        }

        .profile-name {
          font-size: 24px;
        }

        .mini-stats {
          gap: 6px;
        }

        .mini-pill {
          min-height: 60px;
          border-radius: 16px;
          padding: 9px 8px 8px;
        }

        .mini-pill-label {
          font-size: 10px;
        }

        .mini-pill-value {
          font-size: 17px;
        }

        .media-tabs {
          gap: 6px;
          padding: 5px;
        }

        .media-tab {
          min-height: 42px;
          border-radius: 14px;
          font-size: 13px;
          padding: 0 8px;
        }

        .media-tab-count {
          min-width: 18px;
          height: 18px;
          font-size: 10px;
        }

        .listing-grid {
          gap: 10px;
        }

        .profile-media-card {
          border-radius: 20px;
        }

        .profile-media-frame {
          aspect-ratio: 0.9;
        }

        .profile-media-copy {
          padding: 10px;
        }

        .profile-media-desc {
          font-size: 12px;
        }

        .drawer-panel {
          width: 100vw;
        }

        .offer-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .offer-actions.single {
          grid-template-columns: 1fr;
        }

        .offer-actions > .btn.inline {
          width: 100%;
        }
      }
    `}</style>
  );
}