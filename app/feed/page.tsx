"use client";

export const dynamic = "force-dynamic";

import Image from "next/image";
import { Outfit } from "next/font/google";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const brandFont = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

type OwnerRole = "student" | "faculty" | null;
type PostType = "give" | "request" | null;

type FeedRowFromView = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  expires_at: string | null;
  interest_count: number | null;
  owner_role?: OwnerRole;
};

type ItemMeta = {
  id: string;
  owner_id: string | null;
  is_claimed: boolean | null;
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;
  status: string | null;
  hide_interest_count: boolean | null;
};

type FeedRow = FeedRowFromView & {
  owner_id: string | null;
  is_claimed: boolean | null;
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;
  hide_interest_count: boolean | null;
};

type EventCategory =
  | "club"
  | "sports"
  | "party"
  | "career"
  | "volunteering"
  | "workshop"
  | "campus"
  | "other"
  | string;

type EventRow = {
  id: string;
  title: string;
  description: string;
  host_org: string;
  category: EventCategory;
  location: string;
  starts_at: string;
  ends_at: string | null;
  link_url: string | null;
  photo_url: string | null;
  is_anonymous: boolean | null;
  created_by: string | null;
  created_at?: string | null;
};

type MyInterestStatus =
  | "pending"
  | "reserved"
  | "accepted"
  | "completed"
  | "declined"
  | "withdrawn"
  | string;

type AuthState = {
  userId: string | null;
  userEmail: string | null;
  isAshland: boolean;
  isLoggedIn: boolean;
};

type ItemLoveCountRow = {
  item_id: string;
  love_count: number;
};

type EventLoveCountRow = {
  event_id: string;
  love_count: number;
};

type MyItemLoveRow = {
  item_id: string;
};

type MyEventLoveRow = {
  event_id: string;
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

const PAGE_BOTTOM_PAD = 110;
const ATTEND_TABLE = "event_attendees";

function isAshlandEmail(email: string | null) {
  return !!email && email.toLowerCase().endsWith("@ashland.edu");
}

function normStatus(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= Date.now();
}

function isItemClosed(item: FeedRow) {
  const st = normStatus(item.status);
  return !!item.is_claimed || st === "claimed" || st === "completed" || st === "expired";
}

function itemPublicStatus(item: FeedRow): "open" | "in_talks" | "closed" {
  const st = normStatus(item.status);
  if (isItemClosed(item) || isExpired(item.expires_at)) return "closed";
  if (st === "reserved" || st === "accepted" || st === "in_talks" || st === "hold") {
    return "in_talks";
  }
  return "open";
}

function requestGroupLabel(g: string | null | undefined) {
  const k = (g ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  if (k === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(t: string | null | undefined) {
  const k = (t ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

function myInterestLabel(status: MyInterestStatus | null | undefined) {
  const st = normStatus(status);
  if (st === "accepted") return "Accepted";
  if (st === "reserved") return "Reserved";
  if (st === "completed") return "Completed";
  if (st === "declined") return "Declined";
  if (st === "withdrawn") return "Withdrawn";
  if (st === "pending") return "Requested";
  return "Requested";
}

function isActiveInterestStatus(status: MyInterestStatus | null | undefined) {
  const st = normStatus(status);
  return st === "pending" || st === "reserved" || st === "accepted";
}

function formatShortDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(startsAtISO: string, endsAtISO: string | null) {
  const s = new Date(startsAtISO);
  if (Number.isNaN(s.getTime())) return "";

  const sameDay = endsAtISO ? new Date(endsAtISO).toDateString() === s.toDateString() : true;
  const day = s.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const st = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (!endsAtISO) return `${day} • ${st}`;

  const e = new Date(endsAtISO);
  if (Number.isNaN(e.getTime())) return `${day} • ${st}`;

  const et = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `${day} • ${st}–${et}`;

  const endDay = e.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} ${st} → ${endDay} ${et}`;
}

function eventDateChip(startsAtISO: string) {
  const d = new Date(startsAtISO);
  if (Number.isNaN(d.getTime())) return { month: "—", day: "—" };
  return {
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    day: d.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

function isInteractiveDoubleTapTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest(
    'button, a, input, textarea, select, label, [role="button"], [data-no-card-doubletap="true"]'
  );
}

async function getAuthState(): Promise<AuthState> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;
  const isAshland = isAshlandEmail(userEmail);

  return {
    userId,
    userEmail,
    isAshland,
    isLoggedIn: !!userId && !!userEmail && isAshland,
  };
}

export default function FeedPage() {
  const router = useRouter();

  const [auth, setAuth] = useState<AuthState>({
    userId: null,
    userEmail: null,
    isAshland: false,
    isLoggedIn: false,
  });

  const [items, setItems] = useState<FeedRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [errItems, setErrItems] = useState<string | null>(null);
  const [errEvents, setErrEvents] = useState<string | null>(null);

  const [myInterestMap, setMyInterestMap] = useState<Record<string, MyInterestStatus>>({});
  const [myAttending, setMyAttending] = useState<Record<string, boolean>>({});
  const [savingAttendId, setSavingAttendId] = useState<string | null>(null);

  const [itemLoveCounts, setItemLoveCounts] = useState<Record<string, number>>({});
  const [eventLoveCounts, setEventLoveCounts] = useState<Record<string, number>>({});
  const [likedItemMap, setLikedItemMap] = useState<Record<string, boolean>>({});
  const [likedEventMap, setLikedEventMap] = useState<Record<string, boolean>>({});
  const [savingLoveKey, setSavingLoveKey] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsErr, setNotificationsErr] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [openingNotifId, setOpeningNotifId] = useState<string | null>(null);

  const [burstCardKey, setBurstCardKey] = useState<string | null>(null);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<Record<string, { ts: number; x: number; y: number }>>({});

  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState("");

  const [tab, setTab] = useState<"items" | "requests" | "events">("items");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [searchFocused, setSearchFocused] = useState(false);
  const [searchPulse, setSearchPulse] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const chipRowRef = useRef<HTMLDivElement | null>(null);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.is_read && !n.is_hidden).length,
    [notifications]
  );

  function showLoveBurst(cardKey: string) {
    setBurstCardKey(cardKey);
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setBurstCardKey(null), 700);
  }

  async function loadOwnerMeta(itemIds: string[]) {
    if (itemIds.length === 0) return new Map<string, ItemMeta>();

    const { data, error } = await supabase
      .from("items")
      .select(
        "id,owner_id,is_claimed,post_type,request_group,request_timeframe,request_location,status,hide_interest_count"
      )
      .in("id", itemIds);

    if (error) return new Map<string, ItemMeta>();

    const map = new Map<string, ItemMeta>();
    for (const row of (data as ItemMeta[]) || []) map.set(row.id, row);
    return map;
  }

  async function loadMyInterestStatuses(userId: string, itemIds: string[]) {
    if (itemIds.length === 0) {
      setMyInterestMap({});
      return;
    }

    const { data, error } = await supabase
      .from("interests")
      .select("item_id,status")
      .eq("user_id", userId)
      .in("item_id", itemIds);

    if (error) {
      setMyInterestMap({});
      return;
    }

    const next: Record<string, MyInterestStatus> = {};
    for (const row of (data as Array<{ item_id: string; status: MyInterestStatus }>) || []) {
      next[String(row.item_id)] = row.status ?? "pending";
    }
    setMyInterestMap(next);
  }

  async function loadMyAttendanceMap(userId: string, eventIds: string[]) {
    if (eventIds.length === 0) {
      setMyAttending({});
      return;
    }

    const { data, error } = await supabase
      .from(ATTEND_TABLE)
      .select("event_id")
      .eq("user_id", userId)
      .in("event_id", eventIds);

    if (error) {
      setMyAttending({});
      return;
    }

    const next: Record<string, boolean> = {};
    for (const row of (data as Array<{ event_id: string }>) || []) next[String(row.event_id)] = true;
    setMyAttending(next);
  }

  async function loadNotifications(nextAuth: AuthState) {
    if (!nextAuth.isLoggedIn || !nextAuth.userId) {
      setNotifications([]);
      setNotificationsErr(null);
      return;
    }

    setLoadingNotifications(true);
    setNotificationsErr(null);

    try {
      const { data, error } = await supabase
        .from("notifications")
        .select(
          "id,recipient_id,actor_id,type,category,entity_type,entity_id,parent_entity_type,parent_entity_id,title,body,image_url,action_url,is_read,read_at,is_hidden,hidden_at,created_at"
        )
        .eq("recipient_id", nextAuth.userId)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) throw new Error(error.message);
      setNotifications(((data as NotificationRow[]) || []).filter((x) => !x.is_hidden));
    } catch (e: any) {
      setNotifications([]);
      setNotificationsErr(e?.message || "Unable to load notifications.");
    } finally {
      setLoadingNotifications(false);
    }
  }

  async function loadFeedItems(nextAuth: AuthState) {
    setLoadingItems(true);
    setErrItems(null);

    try {
      const { data, error } = await supabase
        .from("v_feed_items")
        .select(
          "id,title,description,category,status,created_at,photo_url,expires_at,interest_count,owner_role"
        )
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || "Error loading feed.");

      const baseRows = ((data as FeedRowFromView[]) || []).map((row) => ({ ...row }));
      const ids = baseRows.map((row) => row.id);
      const meta = await loadOwnerMeta(ids);

      const merged: FeedRow[] = baseRows.map((row) => {
        const m = meta.get(row.id);
        return {
          ...row,
          owner_id: m?.owner_id ?? null,
          is_claimed: m?.is_claimed ?? null,
          post_type: (m?.post_type ?? "give") as PostType,
          request_group: m?.request_group ?? null,
          request_timeframe: m?.request_timeframe ?? null,
          request_location: m?.request_location ?? null,
          status: m?.status ?? row.status ?? "available",
          interest_count: row.interest_count ?? 0,
          hide_interest_count: m?.hide_interest_count ?? null,
        };
      });

      const visible = merged.filter((item) => {
        if (isItemClosed(item)) return false;
        if (isExpired(item.expires_at)) return false;
        return true;
      });

      setItems(visible);

      const giveIds = visible
        .filter((item) => (item.post_type ?? "give") === "give")
        .map((item) => item.id);

      if (nextAuth.isLoggedIn && nextAuth.userId) {
        await loadMyInterestStatuses(nextAuth.userId, giveIds);
      } else {
        setMyInterestMap({});
      }
    } catch (e: any) {
      setItems([]);
      setMyInterestMap({});
      setErrItems(e?.message || "Error loading feed.");
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadFeedEvents(nextAuth: AuthState) {
    setLoadingEvents(true);
    setErrEvents(null);

    try {
      const nowMinus6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,created_by,created_at"
        )
        .gte("starts_at", nowMinus6h)
        .order("starts_at", { ascending: true });

      if (error) throw new Error(error.message || "Error loading events.");

      const rows = (data as EventRow[]) || [];
      setEvents(rows);

      if (nextAuth.isLoggedIn && nextAuth.userId) {
        await loadMyAttendanceMap(nextAuth.userId, rows.map((e) => e.id));
      } else {
        setMyAttending({});
      }
    } catch (e: any) {
      setEvents([]);
      setMyAttending({});
      setErrEvents(e?.message || "Error loading events.");
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadLoveStateForFeed(nextAuth: AuthState, nextItems: FeedRow[], nextEvents: EventRow[]) {
    const itemIds = nextItems.map((x) => x.id);
    const eventIds = nextEvents.map((x) => x.id);

    try {
      if (itemIds.length > 0) {
        const { data: itemCountRows } = await supabase
          .from("v_item_love_counts")
          .select("item_id,love_count")
          .in("item_id", itemIds);

        const nextItemCounts: Record<string, number> = {};
        for (const row of (itemCountRows as ItemLoveCountRow[]) || []) {
          nextItemCounts[row.item_id] = Number(row.love_count ?? 0);
        }
        setItemLoveCounts(nextItemCounts);
      } else {
        setItemLoveCounts({});
      }

      if (eventIds.length > 0) {
        const { data: eventCountRows } = await supabase
          .from("v_event_love_counts")
          .select("event_id,love_count")
          .in("event_id", eventIds);

        const nextEventCounts: Record<string, number> = {};
        for (const row of (eventCountRows as EventLoveCountRow[]) || []) {
          nextEventCounts[row.event_id] = Number(row.love_count ?? 0);
        }
        setEventLoveCounts(nextEventCounts);
      } else {
        setEventLoveCounts({});
      }

      if (nextAuth.isLoggedIn && nextAuth.userId) {
        if (itemIds.length > 0) {
          const { data: myItemLikes } = await supabase
            .from("post_likes")
            .select("item_id")
            .eq("user_id", nextAuth.userId)
            .in("item_id", itemIds);

          const nextLikedItems: Record<string, boolean> = {};
          for (const row of (myItemLikes as MyItemLoveRow[]) || []) {
            if (row.item_id) nextLikedItems[row.item_id] = true;
          }
          setLikedItemMap(nextLikedItems);
        } else {
          setLikedItemMap({});
        }

        if (eventIds.length > 0) {
          const { data: myEventLikes } = await supabase
            .from("post_likes")
            .select("event_id")
            .eq("user_id", nextAuth.userId)
            .in("event_id", eventIds);

          const nextLikedEvents: Record<string, boolean> = {};
          for (const row of (myEventLikes as MyEventLoveRow[]) || []) {
            if (row.event_id) nextLikedEvents[row.event_id] = true;
          }
          setLikedEventMap(nextLikedEvents);
        } else {
          setLikedEventMap({});
        }
      } else {
        setLikedItemMap({});
        setLikedEventMap({});
      }
    } catch {
      setItemLoveCounts({});
      setEventLoveCounts({});
      setLikedItemMap({});
      setLikedEventMap({});
    }
  }

  async function refreshAll(nextAuth?: AuthState) {
    const resolvedAuth = nextAuth ?? (await getAuthState());
    setAuth(resolvedAuth);
    await Promise.all([
      loadFeedItems(resolvedAuth),
      loadFeedEvents(resolvedAuth),
      loadNotifications(resolvedAuth),
    ]);
  }

  async function markAllNotificationsRead() {
    if (!auth.userId || markingAllRead) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setMarkingAllRead(true);

    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: nowIso })
        .eq("recipient_id", auth.userId)
        .in("id", unreadIds);

      if (error) throw new Error(error.message);

      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: true, read_at: nowIso } : n))
      );
    } catch (e) {
      console.error(e);
    } finally {
      setMarkingAllRead(false);
    }
  }

  async function openNotification(notif: NotificationRow) {
    if (!auth.userId) {
      router.push("/me");
      return;
    }

    setOpeningNotifId(notif.id);

    try {
      if (!notif.is_read) {
        const nowIso = new Date().toISOString();
        const { error } = await supabase
          .from("notifications")
          .update({ is_read: true, read_at: nowIso })
          .eq("id", notif.id)
          .eq("recipient_id", auth.userId);

        if (error) throw new Error(error.message);

        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, is_read: true, read_at: nowIso } : n))
        );
      }

      setNotificationsOpen(false);

      if (notif.action_url && notif.action_url.startsWith("/")) {
        router.push(notif.action_url);
        return;
      }

      if (notif.entity_type === "event" && notif.entity_id) {
        router.push(`/event/${notif.entity_id}`);
        return;
      }

      if (notif.parent_entity_type === "item" && notif.parent_entity_id) {
        router.push(`/manage/${notif.parent_entity_id}`);
        return;
      }

      if (notif.entity_type === "item" && notif.entity_id) {
        router.push(`/item/${notif.entity_id}`);
        return;
      }

      router.push("/me");
    } catch (e) {
      console.error(e);
    } finally {
      setOpeningNotifId(null);
    }
  }

  async function onAttendToggle(ev: EventRow) {
    if (!auth.isLoggedIn || !auth.userId) {
      router.push("/me");
      return;
    }

    const isMine = !!ev.created_by && ev.created_by === auth.userId;
    if (isMine) return;

    const already = myAttending[ev.id] === true;
    setSavingAttendId(ev.id);

    try {
      if (already) {
        const { error } = await supabase
          .from(ATTEND_TABLE)
          .delete()
          .eq("event_id", ev.id)
          .eq("user_id", auth.userId);

        if (error) throw new Error(error.message);
        setMyAttending((prev) => ({ ...prev, [ev.id]: false }));
        return;
      }

      const { error } = await supabase
        .from(ATTEND_TABLE)
        .insert([{ event_id: ev.id, user_id: auth.userId }]);

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("duplicate") || msg.includes("unique")) {
          setMyAttending((prev) => ({ ...prev, [ev.id]: true }));
          return;
        }
        throw new Error(error.message);
      }

      setMyAttending((prev) => ({ ...prev, [ev.id]: true }));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingAttendId(null);
    }
  }

  async function toggleItemLove(itemId: string) {
    if (!auth.isLoggedIn || !auth.userId) {
      router.push("/me");
      return;
    }

    const key = `item:${itemId}`;
    if (savingLoveKey === key) return;

    const wasLiked = likedItemMap[itemId] === true;

    setSavingLoveKey(key);
    setLikedItemMap((prev) => ({ ...prev, [itemId]: !wasLiked }));
    setItemLoveCounts((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] ?? 0) + (wasLiked ? -1 : 1)),
    }));

    if (!wasLiked) showLoveBurst(key);

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("post_likes")
          .delete()
          .eq("user_id", auth.userId)
          .eq("item_id", itemId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("post_likes")
          .insert([{ user_id: auth.userId, item_id: itemId }]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) throw new Error(error.message);
        }
      }
    } catch (e) {
      setLikedItemMap((prev) => ({ ...prev, [itemId]: wasLiked }));
      setItemLoveCounts((prev) => ({
        ...prev,
        [itemId]: Math.max(0, (prev[itemId] ?? 0) + (wasLiked ? 1 : -1)),
      }));
      console.error(e);
    } finally {
      setSavingLoveKey(null);
    }
  }

  async function toggleEventLove(eventId: string) {
    if (!auth.isLoggedIn || !auth.userId) {
      router.push("/me");
      return;
    }

    const key = `event:${eventId}`;
    if (savingLoveKey === key) return;

    const wasLiked = likedEventMap[eventId] === true;

    setSavingLoveKey(key);
    setLikedEventMap((prev) => ({ ...prev, [eventId]: !wasLiked }));
    setEventLoveCounts((prev) => ({
      ...prev,
      [eventId]: Math.max(0, (prev[eventId] ?? 0) + (wasLiked ? -1 : 1)),
    }));

    if (!wasLiked) showLoveBurst(key);

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("post_likes")
          .delete()
          .eq("user_id", auth.userId)
          .eq("event_id", eventId);

        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("post_likes")
          .insert([{ user_id: auth.userId, event_id: eventId }]);

        if (error) {
          const msg = error.message.toLowerCase();
          if (!msg.includes("duplicate") && !msg.includes("unique")) throw new Error(error.message);
        }
      }
    } catch (e) {
      setLikedEventMap((prev) => ({ ...prev, [eventId]: wasLiked }));
      setEventLoveCounts((prev) => ({
        ...prev,
        [eventId]: Math.max(0, (prev[eventId] ?? 0) + (wasLiked ? 1 : -1)),
      }));
      console.error(e);
    } finally {
      setSavingLoveKey(null);
    }
  }

  function handleCardPointerUp(
    e: React.PointerEvent<HTMLElement>,
    kind: "item" | "event",
    id: string
  ) {
    if (isInteractiveDoubleTapTarget(e.target)) return;

    const now = Date.now();
    const key = `${kind}:${id}`;
    const prev = lastTapRef.current[key];
    const x = e.clientX;
    const y = e.clientY;

    const quickEnough = !!prev && now - prev.ts < 280;
    const closeEnough = !!prev && Math.abs(prev.x - x) < 28 && Math.abs(prev.y - y) < 28;

    lastTapRef.current[key] = { ts: now, x, y };

    if (quickEnough && closeEnough) {
      lastTapRef.current[key] = { ts: 0, x: 0, y: 0 };
      if (kind === "item") void toggleItemLove(id);
      else void toggleEventLove(id);
    }
  }

  function handleTabChange(nextTab: "items" | "requests" | "events") {
    setTab(nextTab);
    setQuery("");
    setCategoryFilter("all");
    setFiltersOpen(false);
    if (nextTab === "events") setSort("newest");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    if (!query) return;
    setSearchPulse(true);
    const t = setTimeout(() => setSearchPulse(false), 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    void refreshAll();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const nextAuth: AuthState = {
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        isAshland: isAshlandEmail(session?.user?.email ?? null),
        isLoggedIn:
          !!session?.user?.id &&
          !!session?.user?.email &&
          isAshlandEmail(session?.user?.email ?? null),
      };

      await refreshAll(nextAuth);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!auth.isLoggedIn || !auth.userId) return;

    const channel = supabase
      .channel(`feed-notifications-${auth.userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${auth.userId}`,
        },
        () => {
          void loadNotifications(auth);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auth.isLoggedIn, auth.userId]);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    };
  }, []);

  useEffect(() => {
    void loadLoveStateForFeed(auth, items, events);
  }, [auth.userId, auth.isLoggedIn, items, events]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenImg(null);
        setFiltersOpen(false);
        setNotificationsOpen(false);
      }

      if (e.key === "/" && !openImg && !notificationsOpen) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openImg, notificationsOpen]);

  useEffect(() => {
    const el = chipRowRef.current;
    if (!el) return;

    let down = false;
    let startX = 0;
    let startLeft = 0;

    const onPointerDown = (e: PointerEvent) => {
      down = true;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      el.scrollLeft = startLeft - dx;
    };

    const onPointerUp = () => {
      down = false;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointerleave", onPointerUp);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointerleave", onPointerUp);
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if ((item.post_type ?? "give") !== "give") continue;
      const c = (item.category ?? "").trim();
      if (c) set.add(c);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const tabbedItems = useMemo(() => {
    return items.filter((item) => {
      const pt = (item.post_type ?? "give") as PostType;
      if (tab === "items") return pt !== "request";
      if (tab === "requests") return pt === "request";
      return false;
    });
  }, [items, tab]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = tabbedItems.filter((item) => {
      const pt = (item.post_type ?? "give") as PostType;

      if (roleFilter !== "all") {
        const r = (item.owner_role ?? null) as OwnerRole;
        if (!r || r !== roleFilter) return false;
      }

      if (tab === "items" && pt !== "request") {
        if (categoryFilter !== "all" && (item.category ?? "") !== categoryFilter) return false;
      }

      if (q) {
        const blob = [
          item.title,
          item.description ?? "",
          item.category ?? "",
          item.request_group ?? "",
          item.request_timeframe ?? "",
          item.request_location ?? "",
        ]
          .join(" ")
          .toLowerCase();

        if (!blob.includes(q)) return false;
      }

      return true;
    });

    if (sort === "popular") {
      list = [...list].sort(
        (a, b) =>
          (itemLoveCounts[b.id] ?? 0) - (itemLoveCounts[a.id] ?? 0) ||
          (b.interest_count || 0) - (a.interest_count || 0)
      );
    } else {
      list = [...list].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return list;
  }, [tabbedItems, query, sort, roleFilter, categoryFilter, tab, itemLoveCounts]);

  const filteredEvents = useMemo(() => {
    if (tab !== "events") return [];

    const q = query.trim().toLowerCase();
    let list = [...events];

    if (q) {
      list = list.filter((e) => {
        const blob = [e.title, e.description, e.host_org, e.category ?? "", e.location, e.link_url ?? ""]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }

    if (sort === "popular") {
      list = list.sort(
        (a, b) =>
          (eventLoveCounts[b.id] ?? 0) - (eventLoveCounts[a.id] ?? 0) ||
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
    } else {
      list = list.sort(
        (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );
    }

    return list;
  }, [tab, events, query, sort, eventLoveCounts]);

  const showingCount = tab === "events" ? filteredEvents.length : filteredItems.length;
  const loading = tab === "events" ? loadingEvents : loadingItems;
  const err = tab === "events" ? errEvents : errItems;
  const activeFilterCount =
    (sort === "popular" ? 1 : 0) +
    (roleFilter !== "all" ? 1 : 0) +
    (tab === "items" && categoryFilter !== "all" ? 1 : 0) +
    (query.trim() ? 1 : 0);

  return (
    <div className={`${brandFont.className} page page-${tab}`}>
      <header className="topbar">
        <div className="brandRow">
          <button
            className="homeBtn"
            onClick={() => router.push("/feed")}
            aria-label="Home"
            type="button"
          >
            <Image
              src="/scholarswap-logo.png"
              alt="ScholarSwap"
              width={30}
              height={30}
              priority
              className="logoImg"
            />
          </button>

          <div className="brandCopy" role="heading" aria-level={1}>
            <div className="brandLine">
              <span className="brandName">ScholarSwap</span>
              <Image
                src="/Ashland_Eagles_logo.svg.png"
                alt="Ashland University"
                width={16}
                height={16}
                priority
                className="brandMark"
              />
            </div>
            <div className="brandSub">
              {tab === "items" ? "Campus items" : tab === "requests" ? "Help requests" : "Upcoming events"}
            </div>
          </div>

          <button
            className="bellBtn"
            onClick={() => {
              if (!auth.isLoggedIn) {
                router.push("/me");
                return;
              }
              setNotificationsOpen(true);
            }}
            aria-label="Notifications"
            type="button"
          >
            <span className="bellGlyph">🔔</span>
            {auth.isLoggedIn && unreadNotificationCount > 0 ? (
              <span className="bellBadge">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span>
            ) : null}
          </button>
        </div>

        <div className="headerBody">
          <div className="tabsRow">
            <div className="seg3" role="tablist" aria-label="Feed tabs">
              <button
                className={`segBtn ${tab === "items" ? "active" : ""}`}
                onClick={() => handleTabChange("items")}
                type="button"
              >
                Items
              </button>
              <button
                className={`segBtn ${tab === "requests" ? "active" : ""}`}
                onClick={() => handleTabChange("requests")}
                type="button"
              >
                Requests
              </button>
              <button
                className={`segBtn ${tab === "events" ? "active" : ""}`}
                onClick={() => handleTabChange("events")}
                type="button"
              >
                Events
              </button>
              <span
                className={`segIndicator3 ${
                  tab === "items" ? "pos0" : tab === "requests" ? "pos1" : "pos2"
                }`}
                aria-hidden="true"
              />
            </div>

            <button
              className={`ctrlBtn ${filtersOpen ? "ctrlActive" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
              type="button"
              aria-label="Open filters"
            >
              <span className="ctrlIcon">≡</span>
              {activeFilterCount > 0 ? <span className="ctrlCount">{activeFilterCount}</span> : null}
            </button>
          </div>

          <div className={`searchWrap ${searchFocused ? "searchFocused" : ""} ${searchPulse ? "searchPulse" : ""}`}>
            <div className="searchRow">
              <button
                type="button"
                className="searchIconBtn"
                aria-label="Focus search"
                onClick={() => searchRef.current?.focus()}
              >
                🔎
              </button>

              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={
                  tab === "events"
                    ? "Search events, hosts, locations…"
                    : tab === "items"
                    ? "Search items, categories…"
                    : "Search requests, locations…"
                }
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />

              {query ? (
                <button className="clearBtn" onClick={() => setQuery("")} type="button" aria-label="Clear search">
                  ✕
                </button>
              ) : (
                <div className="kbdHint" aria-hidden="true">/</div>
              )}
            </div>

            {tab === "items" && (
              <div className="chipRow" ref={chipRowRef} aria-label="Categories">
                {categories.map((c) => {
                  const active = categoryFilter === c;
                  const label = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);
                  return (
                    <button
                      key={c}
                      className={`chip ${active ? "chipOn" : ""}`}
                      onClick={() => setCategoryFilter(c)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {(sort === "popular" || roleFilter !== "all" || (tab === "items" && categoryFilter !== "all")) && (
              <div className="activeFilterRow">
                {sort === "popular" && (
                  <button className="activeFilterPill" type="button" onClick={() => setSort("newest")}>
                    Popular <span>✕</span>
                  </button>
                )}
                {roleFilter !== "all" && (
                  <button className="activeFilterPill" type="button" onClick={() => setRoleFilter("all")}>
                    {roleFilter === "student" ? "Student" : "Faculty"} <span>✕</span>
                  </button>
                )}
                {tab === "items" && categoryFilter !== "all" && (
                  <button className="activeFilterPill" type="button" onClick={() => setCategoryFilter("all")}>
                    {categoryFilter} <span>✕</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="subline">
            <div className="subTitle">
              {tab === "items"
                ? "Public Items"
                : tab === "requests"
                ? "Public Requests"
                : "Campus Events"}
            </div>
            <div className="count">
              {loading ? "Loading…" : <>Showing <b>{showingCount}</b></>}
            </div>
          </div>

          {err ? <div className="err">{err}</div> : null}
        </div>
      </header>

      {notificationsOpen && (
        <div
          className="notifBackdrop"
          onClick={() => setNotificationsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="notifSheet" onClick={(e) => e.stopPropagation()}>
            <div className="notifTop">
              <div>
                <div className="notifTitle">Notifications</div>
                <div className="notifSub">
                  {unreadNotificationCount > 0 ? `${unreadNotificationCount} unread` : "You’re all caught up"}
                </div>
              </div>

              <div className="notifTopActions">
                <button
                  className="notifGhostBtn"
                  onClick={() => void markAllNotificationsRead()}
                  disabled={markingAllRead || unreadNotificationCount === 0}
                  type="button"
                >
                  {markingAllRead ? "Saving…" : "Mark all read"}
                </button>
                <button className="sheetClose" onClick={() => setNotificationsOpen(false)} type="button">
                  ✕
                </button>
              </div>
            </div>

            <div className="notifBody">
              {loadingNotifications ? <div className="notifEmpty">Loading notifications…</div> : null}
              {notificationsErr ? <div className="notifError">{notificationsErr}</div> : null}
              {!loadingNotifications && !notificationsErr && notifications.length === 0 ? (
                <div className="notifEmpty">No notifications yet.</div>
              ) : null}

              {!loadingNotifications && !notificationsErr
                ? notifications.map((notif) => {
                    const busy = openingNotifId === notif.id;
                    return (
                      <button
                        key={notif.id}
                        className={`notifCard ${notif.is_read ? "" : "notifUnread"}`}
                        onClick={() => void openNotification(notif)}
                        type="button"
                      >
                        <div className="notifCardTop">
                          <div className="notifCardLeft">
                            {notif.image_url ? (
                              <img src={notif.image_url} alt="" className="notifThumb" />
                            ) : (
                              <div className="notifThumbFallback">•</div>
                            )}

                            <div className="notifCopy">
                              <div className="notifLine1">
                                <span className={`notifType ${
                                  notif.type === "event_joined" || notif.type === "event_left" || notif.type === "event_updated"
                                    ? "event"
                                    : notif.type === "message_received"
                                    ? "message"
                                    : notif.type.includes("declined")
                                    ? "bad"
                                    : notif.type.includes("accepted")
                                    ? "good"
                                    : notif.type.includes("help_offer")
                                    ? "request"
                                    : notif.type.includes("item_interest")
                                    ? "item"
                                    : "system"
                                }`}>
                                  {notif.type === "item_interest_created"
                                    ? "Item request"
                                    : notif.type === "item_interest_accepted"
                                    ? "Accepted"
                                    : notif.type === "item_interest_declined"
                                    ? "Declined"
                                    : notif.type === "help_offer_created"
                                    ? "Offer"
                                    : notif.type === "help_offer_accepted"
                                    ? "Accepted"
                                    : notif.type === "help_offer_declined"
                                    ? "Declined"
                                    : notif.type === "event_joined" || notif.type === "event_left"
                                    ? "Event"
                                    : notif.type === "event_updated"
                                    ? "Updated"
                                    : notif.type === "message_received"
                                    ? "Message"
                                    : "Notice"}
                                </span>
                                {!notif.is_read ? <span className="notifNewDot" /> : null}
                              </div>

                              <div className="notifCardTitle">{notif.title || "Notification"}</div>
                              <div className="notifCardBody">{notif.body || "Open to view details."}</div>
                              <div className="notifMeta">{formatDateTime(notif.created_at)}</div>
                            </div>
                          </div>

                          <div className="notifOpenHint">{busy ? "…" : "→"}</div>
                        </div>
                      </button>
                    );
                  })
                : null}
            </div>
          </div>
        </div>
      )}

      {filtersOpen && (
        <div className="sheetBackdrop" onClick={() => setFiltersOpen(false)} role="dialog" aria-modal="true">
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheetTop">
              <div className="sheetTitle">Filters</div>
              <button className="sheetClose" onClick={() => setFiltersOpen(false)} type="button">✕</button>
            </div>

            <div className="sheetGrid">
              <div className="sheetBlock">
                <div className="sheetLabel">Sort</div>
                <div className="togRow">
                  <button
                    className={`tog ${sort === "newest" ? "togOn" : ""}`}
                    onClick={() => setSort("newest")}
                    type="button"
                  >
                    {tab === "events" ? "Soonest" : "Newest"}
                  </button>
                  <button
                    className={`tog ${sort === "popular" ? "togOn" : ""}`}
                    onClick={() => setSort("popular")}
                    type="button"
                  >
                    Popular
                  </button>
                </div>
              </div>

              {tab !== "events" && (
                <div className="sheetBlock">
                  <div className="sheetLabel">Lister</div>
                  <div className="togRow">
                    <button className={`tog ${roleFilter === "all" ? "togOn" : ""}`} onClick={() => setRoleFilter("all")} type="button">All</button>
                    <button className={`tog ${roleFilter === "student" ? "togOn" : ""}`} onClick={() => setRoleFilter("student")} type="button">Student</button>
                    <button className={`tog ${roleFilter === "faculty" ? "togOn" : ""}`} onClick={() => setRoleFilter("faculty")} type="button">Faculty</button>
                  </div>
                </div>
              )}

              <div className="sheetActions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setSort("newest");
                    setRoleFilter("all");
                    setCategoryFilter("all");
                    setQuery("");
                  }}
                >
                  Reset
                </button>
                <button className="primary" type="button" onClick={() => setFiltersOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="main">
        <div className="grid">
          {loading ? (
            <>
              <div className="skeletonCard" />
              <div className="skeletonCard" />
              <div className="skeletonCard" />
            </>
          ) : null}

          {!loading && tab !== "events" && filteredItems.length === 0 ? (
            <div className="emptyState">
              <div className="emptyIcon">✦</div>
              <div className="emptyTitle">{tab === "items" ? "No items found" : "No requests found"}</div>
              <div className="emptySubtitle">
                {tab === "items"
                  ? "Try another category, role filter, or search."
                  : "Try another search or filter combination."}
              </div>
              <button
                className="emptyBtn"
                type="button"
                onClick={() => {
                  setQuery("");
                  setSort("newest");
                  setRoleFilter("all");
                  setCategoryFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {!loading && tab === "events" && filteredEvents.length === 0 ? (
            <div className="emptyState">
              <div className="emptyIcon">✦</div>
              <div className="emptyTitle">No events found</div>
              <div className="emptySubtitle">
                Try a different search or check back for new campus events.
              </div>
              <button
                className="emptyBtn"
                type="button"
                onClick={() => {
                  setQuery("");
                  setSort("newest");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}

          {!loading && tab === "events"
            ? filteredEvents.map((ev) => {
                const isMine = !!auth.userId && !!ev.created_by && ev.created_by === auth.userId;
                const attending = myAttending[ev.id] === true;
                const loved = likedEventMap[ev.id] === true;
                const loveCount = eventLoveCounts[ev.id] ?? 0;
                const loveBusy = savingLoveKey === `event:${ev.id}`;
                const cardKey = `event:${ev.id}`;
                const chip = eventDateChip(ev.starts_at);

                return (
                  <article
                    key={ev.id}
                    className="card cardEvent"
                    onPointerUp={(e) => handleCardPointerUp(e, "event", ev.id)}
                    onClick={() => router.push(`/event/${ev.id}`)}
                  >
                    {burstCardKey === cardKey ? <div className="bigHeartBurst">♥</div> : null}

                    <div className="media mediaEvent">
                      <div className="floatingBadge badgeEvent">EVENT</div>

                      <div className="dateChip">
                        <span className="dateChipMonth">{chip.month}</span>
                        <span className="dateChipDay">{chip.day}</span>
                      </div>

                      <button
                        className={`tinyLike ${loved ? "active" : ""}`}
                        type="button"
                        disabled={loveBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleEventLove(ev.id);
                        }}
                        aria-label={loved ? "Unlike" : "Like"}
                        data-no-card-doubletap="true"
                      >
                        <span className="tinyLikeGlyph">{loved ? "♥" : "♡"}</span>
                        <span className="tinyLikeCount">{loveCount}</span>
                      </button>

                      {ev.photo_url ? (
                        <button
                          className="mediaBtn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenImg(ev.photo_url!);
                            setOpenTitle(ev.title);
                          }}
                          type="button"
                          aria-label="Open flyer"
                          data-no-card-doubletap="true"
                        >
                          <img src={ev.photo_url} alt={ev.title} loading="lazy" className="mediaImg" />
                        </button>
                      ) : (
                        <div className="noPhoto noPhotoEvents">No flyer</div>
                      )}
                    </div>

                    <div className="body">
                      <div className="eyebrowRow">
                        <span className="eyebrowTag events">
                          {ev.is_anonymous ? "Anonymous host" : ev.host_org || "Campus host"}
                        </span>
                        <span className="eyebrowTag subtle">{String(ev.category || "other")}</span>
                        {isMine ? <span className="eyebrowTag subtle">Yours</span> : null}
                      </div>

                      <div className="title">{ev.title}</div>
                      <div className="metaLine">{formatTimeRange(ev.starts_at, ev.ends_at)}</div>
                      <div className="desc clamp2">{ev.description}</div>

                      <div className="bottomRow">
                        <div className="miniFacts">
                          <span>📍 {ev.location || "TBA"}</span>
                          <span>{ev.link_url ? "🔗 Link" : "Campus"}</span>
                        </div>

                        <button
                          className={`primaryInlineBtn eventBtn ${isMine ? "disabled" : attending ? "on" : ""}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onAttendToggle(ev);
                          }}
                          disabled={savingAttendId === ev.id || isMine}
                          data-no-card-doubletap="true"
                        >
                          {isMine
                            ? "Yours"
                            : savingAttendId === ev.id
                            ? "Saving…"
                            : auth.isLoggedIn
                            ? attending
                              ? "Attending"
                              : "Attend"
                            : "Attend"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            : null}

          {!loading && tab !== "events"
            ? filteredItems.map((item) => {
                const postType = (item.post_type ?? "give") as PostType;
                const isMine = !!auth.userId && !!item.owner_id && item.owner_id === auth.userId;
                const myStatus = myInterestMap[item.id];
                const mineActive = isActiveInterestStatus(myStatus);
                const loved = likedItemMap[item.id] === true;
                const loveCount = itemLoveCounts[item.id] ?? 0;
                const loveBusy = savingLoveKey === `item:${item.id}`;
                const cardKey = `item:${item.id}`;

                if (postType === "request") {
                  const group = requestGroupLabel(item.request_group);
                  const tf = requestTimeframeLabel(item.request_timeframe);
                  const loc = (item.request_location ?? "").trim();

                  return (
                    <article
                      key={item.id}
                      className="card cardRequest"
                      onPointerUp={(e) => handleCardPointerUp(e, "item", item.id)}
                      onClick={() => router.push(`/item/${item.id}`)}
                    >
                      {burstCardKey === cardKey ? <div className="bigHeartBurst">♥</div> : null}

                      <div className="requestShell">
                        <div className="requestTop">
                          <div className="requestPills">
                            <span className="requestMainPill">REQUEST</span>
                            <span className="requestGroupPill">{group}</span>
                            {isMine ? <span className="requestSoftPill">Yours</span> : null}
                          </div>

                          <button
                            className={`tinyLike requestLike ${loved ? "active" : ""}`}
                            type="button"
                            disabled={loveBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleItemLove(item.id);
                            }}
                            aria-label={loved ? "Unlike" : "Like"}
                            data-no-card-doubletap="true"
                          >
                            <span className="tinyLikeGlyph">{loved ? "♥" : "♡"}</span>
                            <span className="tinyLikeCount">{loveCount}</span>
                          </button>
                        </div>

                        <div className="requestTitle">{item.title}</div>
                        <div className="requestDesc clamp2">{item.description || "Help needed."}</div>

                        <div className="requestInfoGrid">
                          <div className="requestInfoCell">
                            <span className="requestInfoKey">Time</span>
                            <span className="requestInfoVal">{tf || "Flexible"}</span>
                          </div>
                          <div className="requestInfoCell">
                            <span className="requestInfoKey">Location</span>
                            <span className="requestInfoVal">{loc || "Not specified"}</span>
                          </div>
                          <div className="requestInfoCell">
                            <span className="requestInfoKey">Offers</span>
                            <span className="requestInfoVal">
                              {item.hide_interest_count ? "Hidden" : `${item.interest_count || 0}`}
                            </span>
                          </div>
                          <div className="requestInfoCell">
                            <span className="requestInfoKey">Posted</span>
                            <span className="requestInfoVal">{formatShortDate(item.created_at)}</span>
                          </div>
                        </div>

                        <div className="bottomRow">
                          <div className="miniFacts">
                            <span>🆘 {group}</span>
                          </div>

                          <button
                            className={`primaryInlineBtn requestBtn ${isMine ? "disabled" : ""}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(auth.isLoggedIn ? `/item/${item.id}` : "/me");
                            }}
                            disabled={isMine}
                            data-no-card-doubletap="true"
                          >
                            {isMine ? "Yours" : auth.isLoggedIn ? "Offer help" : "Offer help"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                }

                const publicState = itemPublicStatus(item);
                const badge =
                  publicState === "in_talks" ? "IN TALKS" : publicState === "closed" ? "CLOSED" : "AVAILABLE";

                return (
                  <article
                    key={item.id}
                    className="card cardItem"
                    onPointerUp={(e) => handleCardPointerUp(e, "item", item.id)}
                    onClick={() => router.push(`/item/${item.id}`)}
                  >
                    {burstCardKey === cardKey ? <div className="bigHeartBurst">♥</div> : null}

                    <div className="media">
                      <div className={`floatingBadge ${publicState === "in_talks" ? "badgeTalks" : "badgeItem"}`}>
                        {badge}
                      </div>

                      <button
                        className={`tinyLike ${loved ? "active" : ""}`}
                        type="button"
                        disabled={loveBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleItemLove(item.id);
                        }}
                        aria-label={loved ? "Unlike" : "Like"}
                        data-no-card-doubletap="true"
                      >
                        <span className="tinyLikeGlyph">{loved ? "♥" : "♡"}</span>
                        <span className="tinyLikeCount">{loveCount}</span>
                      </button>

                      {item.photo_url ? (
                        <button
                          className="mediaBtn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenImg(item.photo_url!);
                            setOpenTitle(item.title);
                          }}
                          type="button"
                          aria-label="Open photo"
                          data-no-card-doubletap="true"
                        >
                          <img src={item.photo_url} alt={item.title} loading="lazy" className="mediaImg" />
                        </button>
                      ) : (
                        <div className="noPhoto noPhotoItems">No photo</div>
                      )}
                    </div>

                    <div className="body">
                      <div className="eyebrowRow">
                        <span className="eyebrowTag">{item.category || "Uncategorized"}</span>
                        {item.owner_role ? <span className="eyebrowTag subtle">{item.owner_role}</span> : null}
                        {isMine ? <span className="eyebrowTag subtle">Yours</span> : null}
                      </div>

                      <div className="title">{item.title}</div>

                      <div className="metaLine">
                        {publicState === "in_talks"
                          ? "Someone is being considered • Waitlist still open"
                          : item.hide_interest_count
                          ? "Requests hidden"
                          : `${item.interest_count || 0} request${(item.interest_count || 0) === 1 ? "" : "s"}`}
                      </div>

                      <div className="desc clamp2">{item.description || "No description provided."}</div>

                      <div className="bottomRow">
                        <div className="miniFacts">
                          {item.expires_at ? <span>⏰ {formatShortDate(item.expires_at)}</span> : <span>⏰ Open</span>}
                        </div>

                        <button
                          className={`primaryInlineBtn ${isMine ? "disabled" : mineActive ? "on" : ""}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(auth.isLoggedIn ? `/item/${item.id}` : "/me");
                          }}
                          disabled={isMine}
                          data-no-card-doubletap="true"
                        >
                          {isMine
                            ? "Yours"
                            : auth.isLoggedIn
                            ? mineActive
                              ? myInterestLabel(myStatus)
                              : publicState === "in_talks"
                              ? "Join waitlist"
                              : "Request"
                            : "Request"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            : null}
        </div>
      </main>

      {openImg && (
        <div className="modal" onClick={() => setOpenImg(null)} role="dialog" aria-modal="true">
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div className="modalTitle">{openTitle || "Photo"}</div>
              <button className="modalClose" onClick={() => setOpenImg(null)} type="button">
                ✕
              </button>
            </div>
            <img src={openImg} alt={openTitle || "Full photo"} className="modalImg" />
          </div>
        </div>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          color: #111827;
          transition: background 0.2s ease;
        }

        .page-items {
          background: #f7f8f7;
        }

        .page-requests {
          background: #fbf8f3;
        }

        .page-events {
          background: #f6f8fc;
        }

        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          backdrop-filter: blur(14px);
          background: rgba(255, 255, 255, 0.8);
          border-bottom: 1px solid #e5e7eb;
        }

        .brandRow {
          padding: 10px 12px 8px;
          display: grid;
          grid-template-columns: 42px 1fr 42px;
          gap: 10px;
          align-items: center;
        }

        .homeBtn,
        .bellBtn {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.94);
          display: grid;
          place-items: center;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
          position: relative;
          padding: 0;
        }

        .logoImg {
          width: 30px;
          height: 30px;
          object-fit: contain;
        }

        .brandCopy {
          min-width: 0;
        }

        .brandLine {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }

        .brandName {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.45px;
          color: #111827;
          white-space: nowrap;
        }

        .brandMark {
          transform: translateY(1px);
          opacity: 0.92;
        }

        .brandSub {
          margin-top: 2px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        .bellGlyph {
          font-size: 18px;
          line-height: 1;
        }

        .bellBadge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 20px;
          height: 20px;
          border-radius: 999px;
          background: #ef4444;
          color: #ffffff;
          border: 2px solid #ffffff;
          padding: 0 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 800;
          line-height: 1;
        }

        .headerBody {
          padding: 0 12px 10px;
        }

        .tabsRow {
          display: grid;
          grid-template-columns: 1fr 48px;
          gap: 10px;
          align-items: center;
        }

        .seg3 {
          position: relative;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: rgba(243, 244, 246, 0.92);
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          overflow: hidden;
        }

        .segBtn {
          border: none;
          background: transparent;
          color: #4b5563;
          font-weight: 800;
          font-size: 13px;
          cursor: pointer;
          z-index: 2;
        }

        .segBtn.active {
          color: #111827;
        }

        .segIndicator3 {
          position: absolute;
          top: 3px;
          bottom: 3px;
          width: calc(33.333% - 6px);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.97);
          border: 1px solid #e5e7eb;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
          transition: transform 0.22s ease;
          z-index: 1;
        }

        .segIndicator3.pos0 {
          transform: translateX(3px);
        }

        .segIndicator3.pos1 {
          transform: translateX(calc(100% + 3px));
        }

        .segIndicator3.pos2 {
          transform: translateX(calc(200% + 3px));
        }

        .ctrlBtn {
          width: 48px;
          height: 42px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.94);
          color: #111827;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
          position: relative;
        }

        .ctrlActive {
          border-color: rgba(17, 24, 39, 0.1);
          background: rgba(17, 24, 39, 0.04);
        }

        .ctrlIcon {
          font-size: 18px;
          font-weight: 800;
          line-height: 1;
        }

        .ctrlCount {
          position: absolute;
          top: -5px;
          right: -5px;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: #111827;
          color: white;
          font-size: 10px;
          font-weight: 800;
          display: grid;
          place-items: center;
        }

        .searchWrap {
          padding-top: 10px;
        }

        .searchRow {
          height: 44px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.96);
          display: grid;
          grid-template-columns: 38px 1fr 38px;
          align-items: center;
          gap: 6px;
          padding: 0 6px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .searchFocused .searchRow {
          border-color: rgba(17, 24, 39, 0.12);
          box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.04), 0 10px 24px rgba(0, 0, 0, 0.04);
        }

        .searchPulse .searchRow {
          animation: glow 0.22s ease-out;
        }

        @keyframes glow {
          from {
            box-shadow: 0 0 0 0 rgba(17, 24, 39, 0.08), 0 10px 24px rgba(0, 0, 0, 0.04);
          }
          to {
            box-shadow: 0 0 0 10px rgba(17, 24, 39, 0), 0 10px 24px rgba(0, 0, 0, 0.04);
          }
        }

        .searchIconBtn,
        .clearBtn,
        .kbdHint {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          display: grid;
          place-items: center;
          font-weight: 800;
        }

        .searchIconBtn,
        .clearBtn {
          cursor: pointer;
        }

        .kbdHint {
          color: #9ca3af;
        }

        .searchRow input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          color: #111827;
          font-weight: 700;
          font-size: 14px;
        }

        .searchRow input::placeholder {
          color: #6b7280;
          font-weight: 700;
        }

        .chipRow {
          margin-top: 10px;
          display: flex;
          gap: 9px;
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 4px;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          scrollbar-width: none;
        }

        .chipRow::-webkit-scrollbar {
          display: none;
        }

        .chip {
          flex: 0 0 auto;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.96);
          color: #111827;
          padding: 9px 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          font-size: 12px;
        }

        .chipOn {
          border-color: rgba(16, 185, 129, 0.2);
          background: rgba(16, 185, 129, 0.1);
          color: #065f46;
        }

        .activeFilterRow {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .activeFilterPill {
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.96);
          color: #111827;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }

        .subline {
          padding: 10px 2px 0;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
        }

        .subTitle {
          font-size: 13px;
          font-weight: 800;
          color: #111827;
        }

        .count {
          font-size: 12px;
          color: #6b7280;
          font-weight: 700;
        }

        .err {
          padding-top: 8px;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 800;
        }

        .notifBackdrop,
        .sheetBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.35);
          z-index: 9998;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 12px;
        }

        .notifSheet,
        .sheet {
          width: min(720px, 100%);
          border-radius: 20px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(14px);
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.12);
          overflow: hidden;
        }

        .notifTop,
        .sheetTop {
          padding: 12px 12px 8px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          border-bottom: 1px solid #e5e7eb;
          gap: 12px;
        }

        .notifTitle,
        .sheetTitle {
          font-weight: 800;
          font-size: 14px;
          color: #111827;
        }

        .notifSub {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 700;
          color: #6b7280;
        }

        .notifTopActions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .notifGhostBtn,
        .sheetClose {
          height: 38px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
          cursor: pointer;
          font-weight: 700;
          padding: 0 12px;
        }

        .notifBody {
          max-height: min(72vh, 620px);
          overflow-y: auto;
          padding: 12px;
          display: grid;
          gap: 10px;
        }

        .notifError {
          color: #b91c1c;
          font-weight: 700;
        }

        .notifEmpty {
          padding: 18px;
          border-radius: 16px;
          border: 1px dashed #d1d5db;
          background: #ffffff;
          color: #6b7280;
          font-weight: 700;
          text-align: center;
        }

        .notifCard {
          width: 100%;
          text-align: left;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 12px;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
        }

        .notifUnread {
          border-color: rgba(17, 24, 39, 0.1);
          background: linear-gradient(180deg, rgba(17, 24, 39, 0.02), #ffffff);
        }

        .notifCardTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .notifCardLeft {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }

        .notifThumb,
        .notifThumbFallback {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          object-fit: cover;
          flex-shrink: 0;
          border: 1px solid #e5e7eb;
        }

        .notifThumbFallback {
          display: grid;
          place-items: center;
          background: #f3f4f6;
          color: #9ca3af;
          font-size: 22px;
        }

        .notifCopy {
          min-width: 0;
          flex: 1;
        }

        .notifLine1 {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .notifType {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          color: #374151;
        }

        .notifType.item,
        .notifType.request,
        .notifType.good {
          border-color: rgba(16, 185, 129, 0.2);
          background: rgba(16, 185, 129, 0.1);
          color: #065f46;
        }

        .notifType.bad {
          border-color: rgba(239, 68, 68, 0.22);
          background: rgba(239, 68, 68, 0.08);
          color: #991b1b;
        }

        .notifType.event {
          border-color: rgba(59, 130, 246, 0.2);
          background: rgba(59, 130, 246, 0.1);
          color: #1d4ed8;
        }

        .notifType.message {
          border-color: rgba(99, 102, 241, 0.22);
          background: rgba(99, 102, 241, 0.1);
          color: #4338ca;
        }

        .notifType.system {
          border-color: #e5e7eb;
          background: #f9fafb;
          color: #374151;
        }

        .notifNewDot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #111827;
          flex-shrink: 0;
        }

        .notifCardTitle {
          margin-top: 6px;
          font-size: 14px;
          font-weight: 800;
          color: #111827;
          line-height: 1.35;
        }

        .notifCardBody {
          margin-top: 4px;
          font-size: 13px;
          line-height: 1.45;
          color: #6b7280;
        }

        .notifMeta {
          margin-top: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #9ca3af;
        }

        .notifOpenHint {
          color: #9ca3af;
          font-weight: 800;
          padding-top: 2px;
        }

        .sheetGrid {
          padding: 12px;
          display: grid;
          gap: 12px;
        }

        .sheetBlock {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 16px;
          padding: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
        }

        .sheetLabel {
          font-size: 12px;
          font-weight: 800;
          color: #6b7280;
          margin-bottom: 10px;
        }

        .togRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .tog {
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fbfbfc;
          color: #111827;
          padding: 10px 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .togOn {
          border-color: rgba(17, 24, 39, 0.12);
          background: rgba(17, 24, 39, 0.05);
          color: #111827;
        }

        .sheetActions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .ghost,
        .primary {
          height: 44px;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .ghost {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #111827;
        }

        .primary {
          border: none;
          background: #111827;
          color: #ffffff;
          box-shadow: 0 14px 30px rgba(17, 24, 39, 0.18);
        }

        .main {
          padding: 14px 12px ${PAGE_BOTTOM_PAD}px;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }

        @media (min-width: 720px) {
          .main {
            padding: 16px 16px ${PAGE_BOTTOM_PAD}px;
            max-width: 1100px;
            margin: 0 auto;
          }

          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
          }
        }

        .card {
          position: relative;
          background: #ffffff;
          border-radius: 22px;
          overflow: hidden;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
          cursor: pointer;
        }

        .cardItem {
          border: 1px solid rgba(16, 185, 129, 0.2);
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.04), #ffffff 34%);
        }

        .cardRequest {
          border: 1px solid rgba(245, 158, 11, 0.22);
          background: linear-gradient(180deg, rgba(245, 158, 11, 0.04), #ffffff 34%);
        }

        .cardEvent {
          border: 1px solid rgba(59, 130, 246, 0.2);
          background: linear-gradient(180deg, rgba(59, 130, 246, 0.04), #ffffff 34%);
        }

        .media {
          position: relative;
          height: 210px;
          background: #f3f4f6;
        }

        .mediaEvent::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.02), rgba(15, 23, 42, 0.06));
          pointer-events: none;
        }

        .mediaBtn {
          width: 100%;
          height: 100%;
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
        }

        .mediaImg {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .floatingBadge {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 3;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.88);
          color: #111827;
          backdrop-filter: blur(6px);
        }

        .badgeItem {
          border-color: rgba(16, 185, 129, 0.2);
          color: #065f46;
        }

        .badgeTalks {
          border-color: rgba(59, 130, 246, 0.2);
          color: #1d4ed8;
        }

        .badgeEvent {
          border-color: rgba(59, 130, 246, 0.2);
          color: #1d4ed8;
        }

        .tinyLike {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 3;
          height: 34px;
          min-width: 56px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.85);
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(8px);
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.05);
        }

        .tinyLike.active {
          color: #ec4899;
          border-color: #fbcfe8;
          background: rgba(255, 241, 247, 0.95);
        }

        .requestLike {
          position: static;
          box-shadow: none;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.9);
        }

        .tinyLikeGlyph {
          font-size: 17px;
          line-height: 1;
        }

        .tinyLikeCount {
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
        }

        .dateChip {
          position: absolute;
          left: 12px;
          bottom: 12px;
          z-index: 3;
          width: 54px;
          border-radius: 16px;
          padding: 8px 0;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.92);
          display: flex;
          flex-direction: column;
          align-items: center;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
        }

        .dateChipMonth {
          font-size: 10px;
          font-weight: 800;
          color: #2563eb;
          letter-spacing: 0.6px;
        }

        .dateChipDay {
          font-size: 20px;
          font-weight: 800;
          color: #111827;
          line-height: 1.05;
        }

        .noPhoto {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #6b7280;
          font-weight: 700;
        }

        .noPhotoItems {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), #f8fafc);
        }

        .noPhotoEvents {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), #f8fafc);
        }

        .requestShell {
          padding: 16px;
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 1) 52%);
        }

        .requestTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .requestPills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
        }

        .requestMainPill,
        .requestGroupPill,
        .requestSoftPill {
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.9);
        }

        .requestMainPill {
          border-color: rgba(245, 158, 11, 0.22);
          background: rgba(245, 158, 11, 0.1);
          color: #92400e;
        }

        .requestGroupPill {
          color: #7c2d12;
        }

        .requestSoftPill {
          color: #4b5563;
        }

        .requestTitle {
          margin-top: 14px;
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.35px;
          color: #111827;
          line-height: 1.15;
        }

        .requestDesc {
          margin-top: 10px;
          color: #374151;
          font-size: 14px;
          min-height: 40px;
        }

        .requestInfoGrid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .requestInfoCell {
          border-radius: 16px;
          border: 1px solid rgba(245, 158, 11, 0.16);
          background: rgba(255, 255, 255, 0.8);
          padding: 10px;
          display: grid;
          gap: 4px;
        }

        .requestInfoKey {
          font-size: 11px;
          color: #6b7280;
          font-weight: 700;
        }

        .requestInfoVal {
          font-size: 13px;
          color: #111827;
          font-weight: 800;
        }

        .body {
          padding: 14px;
        }

        .eyebrowRow {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .eyebrowTag {
          min-height: 26px;
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 800;
          background: rgba(17, 24, 39, 0.04);
          color: #374151;
          border: 1px solid rgba(17, 24, 39, 0.06);
        }

        .eyebrowTag.events {
          color: #1d4ed8;
          background: rgba(59, 130, 246, 0.08);
          border-color: rgba(59, 130, 246, 0.16);
        }

        .eyebrowTag.subtle {
          background: rgba(255, 255, 255, 0.84);
          color: #4b5563;
        }

        .title {
          margin-top: 10px;
          font-size: 19px;
          font-weight: 800;
          letter-spacing: -0.25px;
          color: #111827;
          line-height: 1.18;
        }

        .metaLine {
          margin-top: 8px;
          color: #6b7280;
          font-size: 13px;
          font-weight: 700;
        }

        .desc {
          margin-top: 10px;
          color: #374151;
          font-size: 14px;
          min-height: 40px;
          line-height: 1.45;
        }

        .bottomRow {
          margin-top: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .miniFacts {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 10px;
          color: #6b7280;
          font-weight: 700;
          font-size: 12px;
          min-width: 0;
        }

        .primaryInlineBtn {
          height: 40px;
          padding: 0 14px;
          border-radius: 999px;
          border: none;
          background: #111827;
          color: #ffffff;
          font-weight: 800;
          cursor: pointer;
          flex-shrink: 0;
          box-shadow: 0 12px 24px rgba(17, 24, 39, 0.14);
        }

        .primaryInlineBtn.on {
          background: rgba(17, 24, 39, 0.08);
          color: #111827;
          border: 1px solid rgba(17, 24, 39, 0.12);
          box-shadow: none;
        }

        .primaryInlineBtn.disabled {
          opacity: 0.62;
          cursor: not-allowed;
          background: #eef2f7;
          color: #6b7280;
          border: 1px solid #e5e7eb;
          box-shadow: none;
        }

        .requestBtn {
          background: #f59e0b;
          box-shadow: 0 12px 24px rgba(245, 158, 11, 0.18);
        }

        .eventBtn {
          background: #3b82f6;
          box-shadow: 0 12px 24px rgba(59, 130, 246, 0.18);
        }

        .bigHeartBurst {
          position: absolute;
          inset: 0;
          z-index: 5;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 88px;
          font-weight: 800;
          color: #ec4899;
          text-shadow: 0 16px 34px rgba(236, 72, 153, 0.26);
          animation: heart-pop 0.72s ease forwards;
        }

        @keyframes heart-pop {
          0% {
            opacity: 0;
            transform: scale(0.4);
          }
          18% {
            opacity: 1;
            transform: scale(1.1);
          }
          70% {
            opacity: 1;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(1.18);
          }
        }

        .emptyState {
          border-radius: 22px;
          border: 1px dashed #d1d5db;
          background: rgba(255, 255, 255, 0.82);
          padding: 28px 18px;
          text-align: center;
          display: grid;
          gap: 8px;
        }

        .emptyIcon {
          font-size: 24px;
          color: #9ca3af;
        }

        .emptyTitle {
          font-size: 18px;
          font-weight: 800;
          color: #111827;
        }

        .emptySubtitle {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.45;
        }

        .emptyBtn {
          margin: 6px auto 0;
          height: 40px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: white;
          color: #111827;
          font-weight: 800;
          cursor: pointer;
        }

        .skeletonCard {
          height: 320px;
          border-radius: 22px;
          border: 1px solid #e5e7eb;
          background: linear-gradient(90deg, #f3f4f6 25%, #fafafa 50%, #f3f4f6 75%);
          background-size: 200% 100%;
          animation: shimmer 1.2s infinite linear;
        }

        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }

        .clamp2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .modal {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
        }

        .modalInner {
          width: min(1000px, 95vw);
          max-height: 90vh;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.2);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #e5e7eb;
        }

        .modalTitle {
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #111827;
        }

        .modalClose {
          background: #ffffff;
          color: #111827;
          border: 1px solid #e5e7eb;
          padding: 6px 10px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 800;
        }

        .modalImg {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #0b0f19;
        }

        @media (max-width: 560px) {
          .notifTopActions {
            flex-direction: column;
            align-items: stretch;
          }

          .notifGhostBtn {
            width: 100%;
          }

          .bottomRow {
            align-items: flex-start;
            flex-direction: column;
          }

          .primaryInlineBtn {
            width: 100%;
          }

          .bigHeartBurst {
            font-size: 78px;
          }
        }
      `}</style>
    </div>
  );
}