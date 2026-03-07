"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

/* ================================
   TYPES
================================ */

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
  post_type?: "give" | "request" | null;
};

type MyRequestRow = {
  item_id: string;
  created_at?: string | null;
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
    post_type?: "give" | "request" | null;
  } | null;
};

type OfferStatus = "pending" | "hold" | "accepted" | "declined" | "completed";

type IncomingInterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  created_at: string | null;
  owner_seen_at: string | null;
  owner_dismissed_at: string | null;
  status: string | null;
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
    owner_id: string;
    post_type?: "give" | "request" | null;
  } | null;
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
  request_item: {
    id: string;
    title: string;
    status: string | null;
    owner_id: string;
    post_type?: "give" | "request" | null;
  } | null;
  helper: {
    full_name: string | null;
    email: string | null;
    user_role: string | null;
  } | null;
};

type MyOfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  request_item: {
    id: string;
    title: string;
    status: string | null;
    post_type?: "give" | "request" | null;
  } | null;
};

type TabKey = "overview" | "listings" | "requests" | "activity" | "history";

/* ================================
   HELPERS
================================ */

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

function niceNameFromProfile(
  p: { full_name: string | null; email: string | null } | null,
  fallbackLabel: string
) {
  const name = (p?.full_name ?? "").trim();
  if (name) return name;
  const email = (p?.email ?? "").trim();
  if (email) return email.split("@")[0];
  return fallbackLabel;
}

function getFriendlyError(e: any) {
  if (!e) return "Something went wrong.";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  return "Something went wrong.";
}

function readableRole(role: string | null | undefined) {
  const raw = (role ?? "").trim().toLowerCase();
  if (!raw) return "Ashland member";
  if (raw === "student") return "Student member";
  if (raw === "faculty") return "Faculty member";
  return raw;
}

function statusTone(status: string | null | undefined) {
  const s = normStatus(status);
  if (s === "accepted" || s === "claimed" || s === "completed") return "green";
  if (s === "pending" || s === "hold") return "amber";
  if (s === "declined") return "red";
  return "gray";
}

function itemVerb(type: "give" | "request" | null | undefined) {
  return type === "request" ? "Request" : "Give";
}

/* ================================
   PAGE
================================ */

export default function AccountPage() {
  const router = useRouter();
  const toastTimer = useRef<any>(null);

  // auth
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // ui
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // auth form
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // data
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [myItems, setMyItems] = useState<MyItemRow[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]);
  const [myOffers, setMyOffers] = useState<MyOfferRow[]>([]);
  const [incomingInterests, setIncomingInterests] = useState<IncomingInterestRow[]>([]);
  const [incomingOffers, setIncomingOffers] = useState<IncomingOfferRow[]>([]);
  const [incomingLoading, setIncomingLoading] = useState(false);

  // stats
  const [stats, setStats] = useState({
    listed: 0,
    interests: 0,
    offers: 0,
    chats: 0,
  });

  // feedback
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    actionLabel: string;
    onYes: () => Promise<void>;
  }>(null);

  // action state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);
  const [offerActingId, setOfferActingId] = useState<string | null>(null);
  const [myOfferActingId, setMyOfferActingId] = useState<string | null>(null);

  // seen marker for offers
  const [offersSeenAt, setOffersSeenAt] = useState<string | null>(null);

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
    () => myItems.filter((x) => normStatus(x.status) !== "claimed" && normStatus(x.status) !== "completed"),
    [myItems]
  );

  const completedListings = useMemo(
    () => myItems.filter((x) => {
      const s = normStatus(x.status);
      return s === "claimed" || s === "completed";
    }),
    [myItems]
  );

  const unseenIncomingInterestCount = useMemo(() => {
    return incomingInterests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at).length;
  }, [incomingInterests]);

  const unseenIncomingOfferCount = useMemo(() => {
    const pending = incomingOffers.filter((o) => (o.status ?? "pending") === "pending");
    if (!offersSeenAt) return pending.length;
    const seenT = new Date(offersSeenAt).getTime();
    return pending.filter((o) => {
      const t = o.created_at ? new Date(o.created_at).getTime() : 0;
      return t > seenT;
    }).length;
  }, [incomingOffers, offersSeenAt]);

  const acceptedIncomingOffers = useMemo(() => {
    return incomingOffers.filter((o) => (o.status ?? "pending") === "accepted").length;
  }, [incomingOffers]);

  const acceptedMyOffers = useMemo(() => {
    return myOffers.filter((o) => (o.status ?? "pending") === "accepted").length;
  }, [myOffers]);

  const pendingIncomingOffers = useMemo(() => {
    return incomingOffers.filter((o) => (o.status ?? "pending") === "pending").length;
  }, [incomingOffers]);

  const hasNewRequests = unseenIncomingInterestCount + unseenIncomingOfferCount > 0;

  const overviewHighlights = useMemo(() => {
    const rows: Array<{ key: string; title: string; body: string; cta: string; onClick: () => void }> = [];

    if (unseenIncomingInterestCount > 0) {
      rows.push({
        key: "new-item-requests",
        title: `${unseenIncomingInterestCount} new item request${unseenIncomingInterestCount > 1 ? "s" : ""}`,
        body: "People want your give posts. Review them first.",
        cta: "Open requests",
        onClick: () => {
          setTab("requests");
          setOffersSeenAt(new Date().toISOString());
          void markIncomingSeen();
        },
      });
    }

    if (pendingIncomingOffers > 0) {
      rows.push({
        key: "helper-offers",
        title: `${pendingIncomingOffers} helper offer${pendingIncomingOffers > 1 ? "s" : ""} waiting`,
        body: "Accept one, place some on hold, or decline.",
        cta: "Review offers",
        onClick: () => {
          setTab("requests");
          setOffersSeenAt(new Date().toISOString());
          void markIncomingSeen();
        },
      });
    }

    if (acceptedIncomingOffers > 0) {
      rows.push({
        key: "accepted-helper",
        title: `${acceptedIncomingOffers} accepted helper${acceptedIncomingOffers > 1 ? "s" : ""}`,
        body: "You can open chat and finalize details.",
        cta: "Go to requests",
        onClick: () => setTab("requests"),
      });
    }

    if (acceptedMyOffers > 0) {
      rows.push({
        key: "my-accepted-offers",
        title: `${acceptedMyOffers} of your offers got accepted`,
        body: "Open chat and finish the coordination.",
        cta: "View activity",
        onClick: () => setTab("activity"),
      });
    }

    if (rows.length === 0) {
      rows.push({
        key: "all-caught-up",
        title: "You’re all caught up",
        body: "No urgent actions right now. Create something new or browse the feed.",
        cta: "Create post",
        onClick: () => router.push("/create"),
      });
    }

    return rows.slice(0, 3);
  }, [
    unseenIncomingInterestCount,
    pendingIncomingOffers,
    acceptedIncomingOffers,
    acceptedMyOffers,
    router,
  ]);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  function clearAll() {
    setProfile(null);
    setMyItems([]);
    setMyRequests([]);
    setMyOffers([]);
    setIncomingInterests([]);
    setIncomingOffers([]);
    setStats({ listed: 0, interests: 0, offers: 0, chats: 0 });
    setOffersSeenAt(null);
  }

  /* ================================
     LOADERS
  ================================ */

  async function loadProfile(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,user_role,created_at")
      .eq("id", uid)
      .maybeSingle()
      .returns<ProfileRow>();

    if (error) {
      console.warn("profile load:", error.message);
      setProfile(null);
      return;
    }

    setProfile(data ?? null);
  }

  async function loadMyListings(uid: string) {
    const { data, error } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url,post_type")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyItemRow[]>();

    if (error) {
      console.warn("my listings load:", error.message);
      setMyItems([]);
      return [];
    }

    setMyItems(data ?? []);
    return data ?? [];
  }

  async function loadMyRequests(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select("item_id,created_at,items:items(id,title,photo_url,status,post_type)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyRequestRow[]>();

    if (error) {
      console.warn("my requests load:", error.message);
      setMyRequests([]);
      return [];
    }

    setMyRequests(data ?? []);
    return data ?? [];
  }

  async function loadMyOffers(uid: string) {
    const { data, error } = await supabase
      .from("request_offers")
      .select(
        "id,request_id,helper_id,status,availability,note,created_at,request_item:items(id,title,status,post_type)"
      )
      .eq("helper_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyOfferRow[]>();

    if (error) {
      console.warn("my offers load:", error.message);
      setMyOffers([]);
      return [];
    }

    const rows = (data as MyOfferRow[]) ?? [];
    setMyOffers(rows);
    return rows;
  }

  async function loadIncomingInterests(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select(`
        id,item_id,user_id,created_at,owner_seen_at,owner_dismissed_at,status,
        items:items(id,title,photo_url,status,owner_id,post_type),
        requester:profiles!interests_user_id_fkey(full_name,email,user_role)
      `)
      .is("owner_dismissed_at", null)
      .eq("items.owner_id", uid)
      .order("created_at", { ascending: false })
      .returns<IncomingInterestRow[]>();

    if (error) {
      console.warn("incoming interests load:", error.message);
      setIncomingInterests([]);
      return;
    }

    setIncomingInterests(data ?? []);
  }

  async function loadIncomingOffers(uid: string) {
    const { data, error } = await supabase
      .from("request_offers")
      .select(`
        id,request_id,helper_id,status,availability,note,created_at,updated_at,
        request_item:items(id,title,status,owner_id,post_type),
        helper:profiles!request_offers_helper_id_fkey(full_name,email,user_role)
      `)
      .eq("request_item.owner_id", uid)
      .eq("request_item.post_type", "request")
      .order("created_at", { ascending: false })
      .returns<IncomingOfferRow[]>();

    if (error) {
      console.warn("incoming offers load:", error.message);
      setIncomingOffers([]);
      return;
    }

    setIncomingOffers(data ?? []);
  }

  async function loadIncomingAll(uid: string) {
    setIncomingLoading(true);
    try {
      await Promise.all([loadIncomingInterests(uid), loadIncomingOffers(uid)]);
    } finally {
      setIncomingLoading(false);
    }
  }

  async function markIncomingSeen() {
    const unseen = incomingInterests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at);
    if (unseen.length === 0) return;

    const nowIso = new Date().toISOString();
    const ids = unseen.map((r) => r.id).filter(Boolean);

    const { error } = await supabase.from("interests").update({ owner_seen_at: nowIso }).in("id", ids);

    if (error) return;

    setIncomingInterests((prev) =>
      prev.map((r) => (r.owner_seen_at || r.owner_dismissed_at ? r : { ...r, owner_seen_at: nowIso }))
    );
  }

  async function loadAllFor(uid: string) {
    setLoading(true);
    setErr(null);

    await loadProfile(uid);

    const [iRows, rRows, oRows] = await Promise.all([
      loadMyListings(uid),
      loadMyRequests(uid),
      loadMyOffers(uid),
    ]);

    await loadIncomingAll(uid);

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

    setStats({
      listed: iRows.length,
      interests: rRows.length,
      offers: oRows.length,
      chats,
    });

    setLoading(false);
  }

  /* ================================
     ACTIONS
  ================================ */

  async function deleteListing(id: string) {
    setConfirm({
      title: "Delete post?",
      body: "This cannot be undone.",
      actionLabel: "Delete",
      onYes: async () => {
        setConfirm(null);
        setDeletingId(id);

        const { error } = await supabase.from("items").delete().eq("id", id);

        setDeletingId(null);

        if (error) return showToast(error.message, "err");

        setMyItems((prev) => prev.filter((x) => x.id !== id));
        setStats((s) => ({ ...s, listed: Math.max(0, s.listed - 1) }));
        showToast("Deleted.");
      },
    });
  }

  async function deleteNotification(r: IncomingInterestRow) {
    setConfirm({
      title: "Remove this request?",
      body: "This removes it from your incoming list.",
      actionLabel: "Remove",
      onYes: async () => {
        setConfirm(null);
        setDeletingNotifId(r.id);

        const { error } = await supabase.from("interests").delete().eq("id", r.id);

        setDeletingNotifId(null);

        if (error) return showToast(error.message, "err");

        setIncomingInterests((prev) => prev.filter((x) => x.id !== r.id));
        showToast("Removed.");
      },
    });
  }

  async function updateOfferStatus(o: IncomingOfferRow, next: OfferStatus) {
    setOfferActingId(o.id);

    const { error } = await supabase.from("request_offers").update({ status: next }).eq("id", o.id);

    setOfferActingId(null);

    if (error) return showToast(error.message, "err");

    setIncomingOffers((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: next } : x)));
    showToast(`Set to ${next}.`);
  }

  async function startChatWithHelper(o: IncomingOfferRow) {
    if (!userId) return;
    if ((o.status ?? "pending") !== "accepted") return showToast("Accept this helper first.", "err");
    if (!o.request_item?.id) return showToast("Missing request.", "err");
    if (!o.helper_id) return showToast("Missing helper.", "err");

    try {
      setOfferActingId(o.id);

      const threadId = await ensureThread({
        itemId: o.request_item.id,
        ownerId: userId,
        requesterId: o.helper_id,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Offer accepted. Use this chat to finalize details and confirm completion.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(getFriendlyError(e), "err");
    } finally {
      setOfferActingId(null);
    }
  }

  async function withdrawMyOffer(off: MyOfferRow) {
    const st = (off.status ?? "pending") as OfferStatus;
    if (st === "accepted" || st === "completed") {
      return showToast("Cannot withdraw after acceptance/completion.", "err");
    }

    setConfirm({
      title: "Withdraw offer?",
      body: "This removes your offer from the request post.",
      actionLabel: "Withdraw",
      onYes: async () => {
        setConfirm(null);
        setMyOfferActingId(off.id);

        const { error } = await supabase.from("request_offers").delete().eq("id", off.id);

        setMyOfferActingId(null);

        if (error) return showToast(error.message, "err");

        setMyOffers((prev) => prev.filter((x) => x.id !== off.id));
        setStats((s) => ({ ...s, offers: Math.max(0, s.offers - 1) }));
        showToast("Offer withdrawn.");
      },
    });
  }

  async function startChatFromMyOffer(off: MyOfferRow) {
    if (!userId) return;

    const st = (off.status ?? "pending") as OfferStatus;
    if (st !== "accepted") return showToast("Chat unlocks after acceptance.", "err");

    const reqId = off.request_item?.id ?? off.request_id;
    if (!reqId) return showToast("Missing request.", "err");

    try {
      setMyOfferActingId(off.id);

      const { data, error } = await supabase.from("items").select("owner_id").eq("id", reqId).single();

      if (error) throw new Error(error.message);

      const ownerId = (data as any)?.owner_id ?? null;
      if (!ownerId) throw new Error("Missing request owner.");

      const threadId = await ensureThread({
        itemId: reqId,
        ownerId,
        requesterId: userId,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Helper here. My offer was accepted — ready to finalize details.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      showToast(getFriendlyError(e), "err");
    } finally {
      setMyOfferActingId(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setDrawerOpen(false);
  }

  async function handleAuth() {
    setErr(null);

    const email = authEmail.trim().toLowerCase();
    if (!email) return setErr("Enter your email.");
    if (!isAshlandEmail(email)) return setErr("Use your @ashland.edu email.");
    if (authPassword.length < 6) return setErr("Password must be at least 6 characters.");

    setAuthBusy(true);

    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: authPassword,
        });
        if (error) setErr(error.message);
        return;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password: authPassword,
      });
      if (error) setErr(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  /* ================================
     EFFECTS
  ================================ */

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      const uid = s?.user?.id ?? null;
      const email = s?.user?.email ?? null;

      setUserId(uid);
      setUserEmail(email);

      if (!uid || !email || !isAshlandEmail(email)) {
        clearAll();
        setLoading(false);
        return;
      }

      await loadAllFor(uid);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;

      setUserId(uid);
      setUserEmail(email);

      if (!uid || !email || !isAshlandEmail(email)) {
        clearAll();
        setLoading(false);
        return;
      }

      await loadAllFor(uid);
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setConfirm(null);
        setActiveMenuId(null);
      }
    }

    function onClick() {
      setActiveMenuId(null);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, []);

  /* ================================
     RENDER - LOADING / AUTH
  ================================ */

  if (loading) {
    return (
      <div style={pageWrap}>
        <div style={shell}>
          <div style={heroCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={avatarLargeSkeleton} />
              <div style={{ flex: 1 }}>
                <div style={skel(180, 18)} />
                <div style={{ ...skel(240, 12), marginTop: 10 }} />
              </div>
            </div>

            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
              <div style={skeletonCard} />
              <div style={skeletonCard} />
              <div style={skeletonCard} />
              <div style={skeletonCard} />
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div style={panelSoft}>
              <div style={skel(150, 16)} />
              <div style={{ ...skel("100%", 52), marginTop: 12 }} />
            </div>
            <div style={panel}>
              <div style={skel(120, 16)} />
              <div style={{ ...skel("100%", 92), marginTop: 12 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={pageWrap}>
        <div style={shellNarrow}>
          <div style={heroCard}>
            <div style={heroTop}>
              <div>
                <div style={eyebrow}>My account</div>
                <div style={heroTitle}>Sign in to manage your campus activity</div>
                <div style={heroSub}>
                  Use your <b>@ashland.edu</b> email to manage listings, requests, offers, and chats.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => setAuthMode("signin")} style={segBtn(authMode === "signin")}>
                Sign in
              </button>
              <button onClick={() => setAuthMode("signup")} style={segBtn(authMode === "signup")}>
                Sign up
              </button>
            </div>
          </div>

          <div style={{ ...panel, marginTop: 14 }}>
            <div style={{ fontWeight: 950, fontSize: 18 }}>
              {authMode === "signin" ? "Welcome back" : "Create your account"}
            </div>
            <div style={{ color: "#6b7280", marginTop: 6 }}>
              Keep everything in one place: your posts, incoming requests, and active chats.
            </div>

            <input
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@ashland.edu"
              autoComplete="email"
              inputMode="email"
              style={{ ...input, marginTop: 14 }}
            />

            <input
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="password"
              type="password"
              autoComplete={authMode === "signin" ? "current-password" : "new-password"}
              style={{ ...input, marginTop: 10 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAuth();
              }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <button onClick={handleAuth} disabled={authBusy} style={primaryBtn(authBusy)}>
                {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
              </button>

              <button onClick={() => router.push("/feed")} style={secondaryBtn}>
                Browse feed
              </button>
            </div>

            {err && <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 900 }}>{err}</div>}
          </div>
        </div>
      </div>
    );
  }

  /* ================================
     MAIN
  ================================ */

  return (
    <div style={pageWrap}>
      <div style={shell}>
        <section style={heroCard}>
          <div style={heroTop}>
            <div style={heroIdentity}>
              <div style={avatarLarge}>{displayName.slice(0, 1).toUpperCase()}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={eyebrow}>My space</div>
                <div style={heroTitle}>{displayName}</div>
                <div style={heroSub}>
                  {displayRole} • {userEmail}
                  {memberSince ? ` • Joined ${memberSince}` : ""}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Chip label={`${activeListings.length} active`} tone="green" />
                  <Chip
                    label={`${unseenIncomingInterestCount + unseenIncomingOfferCount} new`}
                    tone={hasNewRequests ? "red" : "gray"}
                  />
                  <Chip label={`${stats.chats} chats`} tone="gray" />
                </div>
              </div>
            </div>

            <div style={heroActions}>
              <button onClick={() => router.push("/create")} style={primaryCtaBtn}>
                + Create post
              </button>
              <button onClick={() => router.push("/messages")} style={secondaryCtaBtn}>
                Messages
              </button>
              <button onClick={() => setDrawerOpen(true)} style={iconBtn} aria-label="Open menu">
                ☰
              </button>
            </div>
          </div>

          <div style={metricGrid}>
            <MetricCard
              label="Active listings"
              value={activeListings.length}
              hint="Posts currently live"
              onClick={() => setTab("listings")}
            />
            <MetricCard
              label="Incoming requests"
              value={incomingInterests.length + incomingOffers.length}
              hint="People waiting on you"
              onClick={() => {
                setTab("requests");
                setOffersSeenAt(new Date().toISOString());
                void markIncomingSeen();
              }}
              highlight={hasNewRequests}
            />
            <MetricCard
              label="My activity"
              value={myRequests.length + myOffers.length}
              hint="Interests and help offers"
              onClick={() => setTab("activity")}
            />
            <MetricCard
              label="Completed"
              value={completedListings.length}
              hint="Finished items"
              onClick={() => setTab("history")}
            />
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <div style={sectionHeaderRow}>
            <div>
              <div style={sectionTitle}>Needs attention</div>
              <div style={sectionHint}>Surface what matters first instead of making you dig through tabs.</div>
            </div>
          </div>

          <div style={attentionGrid}>
            {overviewHighlights.map((row) => (
              <AttentionCard
                key={row.key}
                title={row.title}
                body={row.body}
                cta={row.cta}
                onClick={row.onClick}
              />
            ))}
          </div>
        </section>

        <section style={{ marginTop: 14 }}>
          <div style={tabsShell}>
            <button onClick={() => setTab("overview")} style={tabBtn(tab === "overview")}>
              Overview
            </button>

            <button onClick={() => setTab("listings")} style={tabBtn(tab === "listings")}>
              Listings
            </button>

            <button
              onClick={() => {
                setTab("requests");
                setOffersSeenAt(new Date().toISOString());
                void markIncomingSeen();
              }}
              style={tabBtn(tab === "requests")}
            >
              Requests
              {hasNewRequests ? <span style={badgeRed}>{unseenIncomingInterestCount + unseenIncomingOfferCount}</span> : null}
            </button>

            <button onClick={() => setTab("activity")} style={tabBtn(tab === "activity")}>
              Activity
            </button>

            <button onClick={() => setTab("history")} style={tabBtn(tab === "history")}>
              History
            </button>
          </div>
        </section>

        {tab === "overview" && (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <section style={panel}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={sectionTitle}>Quick actions</div>
                  <div style={sectionHint}>The actions you are most likely to need next.</div>
                </div>
              </div>

              <div style={quickActionGrid}>
                <QuickActionCard
                  emoji="📝"
                  title="Create a new post"
                  body="Share a give item, ask for help, or publish an event."
                  actionLabel="Create"
                  onClick={() => router.push("/create")}
                  primary
                />
                <QuickActionCard
                  emoji="📩"
                  title="Open messages"
                  body="Continue accepted requests and helper conversations."
                  actionLabel="Messages"
                  onClick={() => router.push("/messages")}
                />
                <QuickActionCard
                  emoji="🔎"
                  title="Browse the feed"
                  body="Explore what the campus community is posting now."
                  actionLabel="Browse"
                  onClick={() => router.push("/feed")}
                />
                <QuickActionCard
                  emoji="📦"
                  title="My pickups"
                  body="See pickup progress and next coordination steps."
                  actionLabel="Pickups"
                  onClick={() => router.push("/pickups")}
                />
              </div>
            </section>

            <section style={doubleCol}>
              <div style={panel}>
                <div style={sectionHeaderRow}>
                  <div>
                    <div style={sectionTitle}>Recent listings</div>
                    <div style={sectionHint}>A quick view of what you posted most recently.</div>
                  </div>
                  <button onClick={() => setTab("listings")} style={linkBtn}>
                    See all
                  </button>
                </div>

                {activeListings.slice(0, 3).length === 0 ? (
                  <EmptyState
                    title="No active listings yet"
                    body="Your active give posts and request posts will appear here."
                    compact
                  />
                ) : (
                  <div style={stackList}>
                    {activeListings.slice(0, 3).map((item) => (
                      <CompactItemRow
                        key={item.id}
                        title={item.title}
                        subtitle={item.description || "No description"}
                        photoUrl={item.photo_url}
                        chip1={itemVerb(item.post_type)}
                        chip2={item.status ?? "—"}
                        onClick={() => router.push(`/manage/${item.id}`)}
                        ctaLabel="Manage"
                      />
                    ))}
                  </div>
                )}
              </div>

              <div style={panel}>
                <div style={sectionHeaderRow}>
                  <div>
                    <div style={sectionTitle}>Latest activity</div>
                    <div style={sectionHint}>Your recent interests and offers in one place.</div>
                  </div>
                  <button onClick={() => setTab("activity")} style={linkBtn}>
                    See all
                  </button>
                </div>

                {myRequests.length === 0 && myOffers.length === 0 ? (
                  <EmptyState
                    title="No activity yet"
                    body="When you request an item or offer help, it will show here."
                    compact
                  />
                ) : (
                  <div style={stackList}>
                    {myRequests.slice(0, 2).map((r, i) => (
                      <CompactTextRow
                        key={`req-${r.item_id}-${i}`}
                        icon="🙋"
                        title={r.items?.title ?? "Unknown item"}
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
        )}

        {tab === "listings" && (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <section style={panelSoft}>
              <div style={sectionTitle}>Your listings</div>
              <div style={sectionHint}>
                Active posts stay here. Claimed or completed ones move to History.
              </div>
            </section>

            {activeListings.length === 0 ? (
              <EmptyState
                title="No active listings"
                body="Post your first give item or request to get started."
                actionLabel="Create post"
                onAction={() => router.push("/create")}
              />
            ) : (
              <div style={grid}>
                {activeListings.map((item) => (
                  <ListingCardModern
                    key={item.id}
                    item={item}
                    deleting={deletingId === item.id}
                    menuOpen={activeMenuId === item.id}
                    onToggleMenu={(e) => {
                      e.stopPropagation();
                      setActiveMenuId((prev) => (prev === item.id ? null : item.id));
                    }}
                    onOpen={() => router.push(`/manage/${item.id}`)}
                    onEdit={() => router.push(`/item/${item.id}/edit`)}
                    onDelete={() => deleteListing(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "requests" && (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <section style={panelSoft}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={sectionTitle}>Requests and offers waiting on you</div>
                  <div style={sectionHint}>This is your decision center.</div>
                </div>

                <button
                  onClick={() => {
                    if (userId) void loadIncomingAll(userId);
                  }}
                  disabled={incomingLoading}
                  style={secondaryBtn}
                >
                  {incomingLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </section>

            <section style={panel}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={subSectionTitle}>Incoming item requests</div>
                  <div style={sectionHint}>People who requested your give listings.</div>
                </div>
                <Chip label={`${incomingInterests.length}`} tone={incomingInterests.length ? "green" : "gray"} />
              </div>

              {incomingInterests.length === 0 ? (
                <EmptyState
                  title="No incoming item requests"
                  body="When someone requests one of your give posts, it will appear here."
                  compact
                />
              ) : (
                <div style={stackList}>
                  {incomingInterests.map((r) => {
                    const itemTitle = r.items?.title?.trim() ? r.items.title : "Unknown item";
                    const who = niceNameFromProfile(r.requester, "Ashland user");
                    const deleting = deletingNotifId === r.id;

                    return (
                      <RequestRowCard
                        key={r.id}
                        photoUrl={r.items?.photo_url ?? null}
                        title={`${who} requested ${itemTitle}`}
                        subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}${r.owner_seen_at ? "Seen" : "New"}`}
                        chips={[
                          { label: r.owner_seen_at ? "Seen" : "New", tone: r.owner_seen_at ? "gray" : "red" },
                          { label: r.items?.status ?? "—", tone: statusTone(r.items?.status) as any },
                        ]}
                        primaryLabel="Open"
                        onPrimary={() => router.push(`/manage/${r.item_id}`)}
                        secondaryLabel={deleting ? "Removing…" : "Remove"}
                        onSecondary={() => deleteNotification(r)}
                        secondaryDanger
                        secondaryDisabled={deleting}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            <section style={panel}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={subSectionTitle}>Incoming helper offers</div>
                  <div style={sectionHint}>Accept one, pause others, or decline.</div>
                </div>
                <Chip label={`${incomingOffers.length}`} tone={incomingOffers.length ? "green" : "gray"} />
              </div>

              {incomingOffers.length === 0 ? (
                <EmptyState
                  title="No incoming help offers"
                  body="When someone offers help on your request post, it will appear here."
                  compact
                />
              ) : (
                <div style={stackList}>
                  {incomingOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const who = niceNameFromProfile(o.helper, "Ashland user");
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = offerActingId === o.id;

                    return (
                      <OfferRowCard
                        key={o.id}
                        icon="🤝"
                        title={`${who} offered help on ${title}`}
                        subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                        note={o.note}
                        statusLabel={st}
                        onView={() => router.push(`/item/${o.request_id}`)}
                        onAccept={() => updateOfferStatus(o, "accepted")}
                        onHold={() => updateOfferStatus(o, "hold")}
                        onDecline={() => updateOfferStatus(o, "declined")}
                        onChat={() => startChatWithHelper(o)}
                        busy={acting}
                        accepted={st === "accepted"}
                        completed={st === "completed"}
                        declined={st === "declined"}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "activity" && (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <section style={panel}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={sectionTitle}>My interests</div>
                  <div style={sectionHint}>Give posts you requested.</div>
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
                <div style={stackList}>
                  {myRequests.map((r, i) => {
                    const it = r.items;
                    return (
                      <RequestRowCard
                        key={`${r.item_id}-${r.created_at ?? i}`}
                        photoUrl={it?.photo_url ?? null}
                        title={it?.title ?? "Unknown item"}
                        subtitle={`${r.created_at ? `Requested ${fmtWhen(r.created_at)} • ` : ""}Status: ${it?.status ?? "—"}`}
                        chips={[
                          { label: "Interest sent", tone: "green" },
                          { label: it?.status ?? "—", tone: statusTone(it?.status) as any },
                        ]}
                        primaryLabel="View"
                        onPrimary={() => router.push(`/item/${r.item_id}`)}
                      />
                    );
                  })}
                </div>
              )}
            </section>

            <section style={panel}>
              <div style={sectionHeaderRow}>
                <div>
                  <div style={sectionTitle}>My offers</div>
                  <div style={sectionHint}>Request posts where you offered help.</div>
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
                <div style={stackList}>
                  {myOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = myOfferActingId === o.id;

                    return (
                      <OfferRowCard
                        key={o.id}
                        icon="🙌"
                        title={`You offered help on ${title}`}
                        subtitle={`${o.created_at ? `Offered ${fmtWhen(o.created_at)} • ` : ""}${o.availability ? `Availability: ${o.availability}` : "Availability not provided"}`}
                        note={o.note}
                        statusLabel={st}
                        onView={() => router.push(`/item/${o.request_id}`)}
                        onChat={() => startChatFromMyOffer(o)}
                        onDecline={() => withdrawMyOffer(o)}
                        busy={acting}
                        accepted={st === "accepted"}
                        completed={st === "completed"}
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
        )}

        {tab === "history" && (
          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <section style={panelSoft}>
              <div style={sectionTitle}>Completed listings</div>
              <div style={sectionHint}>These were picked up or finished and are now archived.</div>
            </section>

            {completedListings.length === 0 ? (
              <EmptyState
                title="No completed listings yet"
                body="When a listing is claimed or completed, it moves here."
                compact
              />
            ) : (
              <div style={grid}>
                {completedListings.map((item) => (
                  <HistoryCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        )}

        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} style={backdrop}>
            <div onClick={(e) => e.stopPropagation()} style={drawer}>
              <div style={drawerTop}>
                <div>
                  <div style={{ fontWeight: 950, fontSize: 18 }}>Account menu</div>
                  <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>{displayName}</div>
                </div>
                <button onClick={() => setDrawerOpen(false)} style={smallCloseBtn}>
                  ✕
                </button>
              </div>

              <div style={{ padding: 14, display: "grid", gap: 10 }}>
                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/create");
                  }}
                  style={drawerBtnPrimary}
                >
                  Create post
                </button>

                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/messages");
                  }}
                  style={drawerBtn}
                >
                  Messages
                </button>

                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/pickups");
                  }}
                  style={drawerBtn}
                >
                  My pickups
                </button>

                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/feed");
                  }}
                  style={drawerBtn}
                >
                  Browse feed
                </button>

                <button onClick={signOut} style={drawerDangerBtn}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        {confirm && (
          <ConfirmModal
            title={confirm.title}
            body={confirm.body}
            actionLabel={confirm.actionLabel}
            onCancel={() => setConfirm(null)}
            onConfirm={confirm.onYes}
          />
        )}

        {toast && <Toast msg={toast.msg} kind={toast.kind} />}
      </div>
    </div>
  );
}

/* ================================
   COMPONENTS
================================ */

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
    <button onClick={onClick} style={metricCard(highlight)} type="button">
      <div style={{ fontSize: 12, fontWeight: 900, color: highlight ? "#065f46" : "#6b7280" }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 950, color: "#111827" }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280", lineHeight: 1.35 }}>{hint}</div>
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
    <div style={attentionCard}>
      <div>
        <div style={{ fontWeight: 950, fontSize: 18, color: "#111827" }}>{title}</div>
        <div style={{ marginTop: 6, color: "#4b5563", lineHeight: 1.45 }}>{body}</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button onClick={onClick} style={primaryInlineBtn}>
          {cta}
        </button>
      </div>
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
    <div style={quickCard(primary)}>
      <div style={quickEmoji}>{emoji}</div>
      <div style={{ fontWeight: 950, fontSize: 16, color: "#111827", marginTop: 12 }}>{title}</div>
      <div style={{ marginTop: 6, color: "#4b5563", lineHeight: 1.45 }}>{body}</div>
      <button onClick={onClick} style={primary ? primaryInlineBtn : secondaryInlineBtn}>
        {actionLabel}
      </button>
    </div>
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
    <div style={compactRow}>
      <MediaThumb photoUrl={photoUrl} label={title} size={62} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={compactTitle}>{title}</div>
        <div style={compactSub}>{subtitle}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {chip1 ? <Chip label={chip1} tone="gray" /> : null}
          {chip2 ? <Chip label={chip2} tone={statusTone(chip2) as any} /> : null}
        </div>
      </div>
      <button onClick={onClick} style={secondaryInlineBtn}>
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
    <div style={compactRow}>
      <div style={iconPill}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={compactTitle}>{title}</div>
        <div style={compactSub}>{subtitle}</div>
      </div>
      <button onClick={onClick} style={secondaryInlineBtn}>
        {ctaLabel}
      </button>
    </div>
  );
}

function ListingCardModern({
  item,
  deleting,
  menuOpen,
  onToggleMenu,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: MyItemRow;
  deleting: boolean;
  menuOpen: boolean;
  onToggleMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={listingCard}>
      <div style={listingImageWrap}>
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} style={listingImg} />
        ) : (
          <div style={listingImageFallback}>{item.post_type === "request" ? "Request" : "No image"}</div>
        )}

        <div style={listingTopBadgeWrap}>
          <Chip label={itemVerb(item.post_type)} tone="gray" />
          <Chip label={item.status ?? "—"} tone={statusTone(item.status) as any} />
        </div>
      </div>

      <div style={{ padding: 14 }}>
        <div style={cardTitleModern}>{item.title}</div>
        <div style={cardSubModern}>{item.description || "No description provided yet."}</div>

        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
          Posted {fmtWhen(item.created_at)}
        </div>

        <div style={listingActionRow}>
          <button onClick={onOpen} style={primaryInlineBtn}>
            Manage
          </button>
          <button onClick={onEdit} style={secondaryInlineBtn}>
            Edit
          </button>

          <div style={{ position: "relative" }}>
            <button onClick={onToggleMenu} style={iconMenuBtn} type="button">
              ⋯
            </button>

            {menuOpen ? (
              <div
                style={miniMenu}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <button onClick={onEdit} style={miniMenuBtn}>
                  Edit post
                </button>
                <button onClick={onDelete} disabled={deleting} style={miniMenuDangerBtn}>
                  {deleting ? "Deleting…" : "Delete post"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ item }: { item: MyItemRow }) {
  return (
    <div style={historyCard}>
      <div style={listingImageWrap}>
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} style={listingImg} />
        ) : (
          <div style={listingImageFallback}>Completed</div>
        )}
      </div>

      <div style={{ padding: 14 }}>
        <div style={cardTitleModern}>{item.title}</div>
        <div style={cardSubModern}>{item.description || "No description provided."}</div>

        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip label={itemVerb(item.post_type)} tone="gray" />
          <Chip label="Completed" tone="green" />
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
          Posted {fmtWhen(item.created_at)}
        </div>
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
  secondaryLabel,
  onSecondary,
  secondaryDanger,
  secondaryDisabled,
}: {
  photoUrl: string | null;
  title: string;
  subtitle: string;
  chips?: Array<{ label: string; tone: "green" | "amber" | "red" | "gray" }>;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDanger?: boolean;
  secondaryDisabled?: boolean;
}) {
  return (
    <div style={rowCardModern}>
      <div style={rowMainModern}>
        <MediaThumb photoUrl={photoUrl} label={title} size={68} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={rowTitleModern}>{title}</div>
          <div style={rowMetaModern}>{subtitle}</div>
          {chips?.length ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {chips.map((chip, i) => (
                <Chip key={`${chip.label}-${i}`} label={chip.label} tone={chip.tone} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={actionRowModern}>
        <button onClick={onPrimary} style={primaryInlineBtn}>
          {primaryLabel}
        </button>

        {secondaryLabel && onSecondary ? (
          <button
            onClick={onSecondary}
            disabled={secondaryDisabled}
            style={secondaryDanger ? dangerInlineBtn(!!secondaryDisabled) : secondaryInlineBtn}
          >
            {secondaryLabel}
          </button>
        ) : null}
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
    <div style={rowCardModern}>
      <div style={rowMainModern}>
        <div style={offerIconPill}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={rowTitleModern}>{title}</div>
          <div style={rowMetaModern}>{subtitle}</div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip label={statusLabel} tone={statusTone(statusLabel) as any} />
          </div>

          {note ? <div style={noteTextModern}>{note}</div> : null}
        </div>
      </div>

      <div style={actionRowModern}>
        <button onClick={onView} style={secondaryInlineBtn}>
          View
        </button>

        {!hideAccept && onAccept ? (
          <button
            onClick={onAccept}
            disabled={busy || accepted || completed}
            style={acceptInlineBtn(busy || accepted || completed)}
          >
            {busy ? "Working…" : "Accept"}
          </button>
        ) : null}

        {!hideHold && onHold ? (
          <button
            onClick={onHold}
            disabled={busy || accepted || completed}
            style={secondaryBtnDisabledCapable(busy || accepted || completed)}
          >
            Hold
          </button>
        ) : null}

        {onDecline ? (
          <button
            onClick={onDecline}
            disabled={busy || completed || declined}
            style={dangerInlineBtn(busy || completed || declined)}
          >
            {customDeclineLabel || "Decline"}
          </button>
        ) : null}

        <button
          onClick={onChat}
          disabled={busy || !accepted}
          style={secondaryBtnDisabledCapable(busy || !accepted)}
        >
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
    <div style={compact ? emptyCompact : emptyBox}>
      <div style={{ fontWeight: 950, fontSize: compact ? 16 : 18, color: "#111827" }}>{title}</div>
      <div style={{ marginTop: 6, color: "#4b5563", lineHeight: 1.5 }}>{body}</div>

      {actionLabel && onAction ? (
        <div style={{ marginTop: 12 }}>
          <button onClick={onAction} style={secondaryInlineBtn}>
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
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 18,
        border: "1px solid #e5e7eb",
        background: "#f3f4f6",
        overflow: "hidden",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#6b7280",
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
  return <span style={chipStyle(tone)}>{label}</span>;
}

function Toast({ msg, kind = "ok" }: { msg: string; kind?: "ok" | "err" }) {
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 16px)",
        zIndex: 99999,
        borderRadius: 16,
        padding: "12px 14px",
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        color: "#111827",
        boxShadow: "0 18px 50px rgba(0,0,0,0.14)",
        fontWeight: 900,
        maxWidth: "min(560px, calc(100vw - 24px))",
      }}
    >
      <span style={{ color: kind === "err" ? "#b91c1c" : "#065f46" }}>{kind === "err" ? "⚠ " : "✓ "}</span>
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
    <div onClick={onCancel} style={backdrop} role="dialog" aria-modal="true">
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 950, fontSize: 18 }}>{title}</div>
        <div style={{ marginTop: 8, color: "#4b5563", lineHeight: 1.5 }}>{body}</div>

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={secondaryBtn}>
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
            style={primaryBtn(busy)}
          >
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================
   STYLES
================================ */

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "linear-gradient(180deg, #f8fafc 0%, #f7f7f8 18%, #f3f4f6 100%)",
  color: "#111827",
};

const shell: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: 14,
  paddingBottom: "calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 28px)",
};

const shellNarrow: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: 14,
  paddingBottom: "calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 28px)",
};

const heroCard: React.CSSProperties = {
  borderRadius: 28,
  border: "1px solid rgba(229,231,235,0.9)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.88) 100%)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
  padding: 18,
};

const heroTop: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const heroIdentity: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 14,
  minWidth: 0,
  flex: 1,
};

const avatarLarge: React.CSSProperties = {
  width: 76,
  height: 76,
  borderRadius: 24,
  border: "1px solid #e5e7eb",
  background: "linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  fontSize: 28,
  color: "#111827",
  flexShrink: 0,
};

const avatarLargeSkeleton: React.CSSProperties = {
  width: 76,
  height: 76,
  borderRadius: 24,
  background: "#e5e7eb",
  flexShrink: 0,
};

const eyebrow: React.CSSProperties = {
  fontSize: 12,
  color: "#065f46",
  fontWeight: 900,
  letterSpacing: 0.4,
  textTransform: "uppercase",
};

const heroTitle: React.CSSProperties = {
  fontSize: 30,
  lineHeight: 1.05,
  fontWeight: 950,
  color: "#111827",
  marginTop: 6,
};

const heroSub: React.CSSProperties = {
  marginTop: 8,
  color: "#4b5563",
  fontSize: 14,
  lineHeight: 1.5,
  overflowWrap: "anywhere",
};

const heroActions: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const primaryCtaBtn: React.CSSProperties = {
  height: 46,
  borderRadius: 16,
  border: "1px solid rgba(16,185,129,0.35)",
  background: "linear-gradient(180deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.10) 100%)",
  color: "#065f46",
  padding: "0 16px",
  fontWeight: 950,
  cursor: "pointer",
};

const secondaryCtaBtn: React.CSSProperties = {
  height: 46,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "0 16px",
  fontWeight: 900,
  cursor: "pointer",
};

const metricGrid: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

function metricCard(highlight?: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    borderRadius: 22,
    border: highlight ? "1px solid rgba(16,185,129,0.32)" : "1px solid #e5e7eb",
    background: highlight ? "rgba(16,185,129,0.08)" : "#ffffff",
    padding: 16,
    cursor: "pointer",
    boxShadow: highlight ? "0 10px 30px rgba(16,185,129,0.08)" : "0 8px 22px rgba(15,23,42,0.04)",
  };
}

const attentionGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
  marginTop: 12,
};

const attentionCard: React.CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(16,185,129,0.22)",
  background: "linear-gradient(180deg, rgba(16,185,129,0.10) 0%, rgba(255,255,255,1) 100%)",
  padding: 16,
  boxShadow: "0 12px 30px rgba(16,185,129,0.06)",
};

const tabsShell: React.CSSProperties = {
  display: "flex",
  gap: 10,
  overflowX: "auto",
  padding: 6,
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  background: "rgba(255,255,255,0.8)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    border: active ? "1px solid rgba(16,185,129,0.30)" : "1px solid transparent",
    background: active ? "rgba(16,185,129,0.12)" : "transparent",
    color: active ? "#065f46" : "#111827",
    padding: "0 14px",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const badgeRed: React.CSSProperties = {
  minWidth: 20,
  height: 20,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 6px",
  fontSize: 11,
  background: "#ef4444",
  color: "#ffffff",
  fontWeight: 900,
};

const panel: React.CSSProperties = {
  borderRadius: 24,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: 16,
  boxShadow: "0 12px 32px rgba(15,23,42,0.06)",
};

const panelSoft: React.CSSProperties = {
  borderRadius: 22,
  border: "1px solid #e5e7eb",
  background: "rgba(255,255,255,0.7)",
  padding: 16,
};

const sectionHeaderRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 22,
  color: "#111827",
};

const subSectionTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 18,
  color: "#111827",
};

const sectionHint: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "#6b7280",
  lineHeight: 1.45,
};

const quickActionGrid: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

function quickCard(primary?: boolean): React.CSSProperties {
  return {
    borderRadius: 22,
    border: primary ? "1px solid rgba(16,185,129,0.32)" : "1px solid #e5e7eb",
    background: primary ? "rgba(16,185,129,0.08)" : "#ffffff",
    padding: 16,
    minHeight: 190,
    display: "flex",
    flexDirection: "column",
    boxShadow: primary ? "0 12px 28px rgba(16,185,129,0.06)" : "0 8px 22px rgba(15,23,42,0.04)",
  };
}

const quickEmoji: React.CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 16,
  background: "#f3f4f6",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 22,
};

const doubleCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 14,
};

const stackList: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 12,
};

const compactRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  borderRadius: 18,
  border: "1px solid #eef0f3",
  background: "#ffffff",
  padding: 12,
};

const compactTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 15,
  color: "#111827",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const compactSub: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13,
  color: "#6b7280",
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const iconPill: React.CSSProperties = {
  width: 62,
  height: 62,
  borderRadius: 18,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 24,
  flexShrink: 0,
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 14,
};

const listingCard: React.CSSProperties = {
  borderRadius: 24,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  overflow: "hidden",
  boxShadow: "0 14px 32px rgba(15,23,42,0.06)",
};

const historyCard: React.CSSProperties = {
  borderRadius: 24,
  border: "1px solid #e5e7eb",
  background: "linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)",
  overflow: "hidden",
  boxShadow: "0 12px 28px rgba(15,23,42,0.05)",
};

const listingImageWrap: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: 180,
  background: "#f3f4f6",
};

const listingImg: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const listingImageFallback: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
  fontWeight: 900,
};

const listingTopBadgeWrap: React.CSSProperties = {
  position: "absolute",
  left: 12,
  top: 12,
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const cardTitleModern: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 950,
  color: "#111827",
  lineHeight: 1.25,
};

const cardSubModern: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  color: "#4b5563",
  lineHeight: 1.5,
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical" as any,
  overflow: "hidden",
};

const listingActionRow: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const iconMenuBtn: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 950,
  fontSize: 20,
};

const miniMenu: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 48,
  width: 180,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(15,23,42,0.14)",
  padding: 8,
  zIndex: 30,
};

const miniMenuBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  color: "#111827",
  padding: "10px 10px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 800,
};

const miniMenuDangerBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  color: "#991b1b",
  padding: "10px 10px",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 900,
};

const rowCardModern: React.CSSProperties = {
  borderRadius: 22,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
};

const rowMainModern: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  minWidth: 0,
};

const rowTitleModern: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 16,
  color: "#111827",
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const rowMetaModern: React.CSSProperties = {
  marginTop: 6,
  color: "#6b7280",
  fontSize: 13,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

const actionRowModern: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const offerIconPill: React.CSSProperties = {
  width: 68,
  height: 68,
  borderRadius: 20,
  background: "rgba(16,185,129,0.08)",
  border: "1px solid rgba(16,185,129,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 26,
  flexShrink: 0,
};

const noteTextModern: React.CSSProperties = {
  marginTop: 10,
  padding: 12,
  borderRadius: 14,
  background: "#f9fafb",
  border: "1px solid #eef0f3",
  fontSize: 13,
  color: "#374151",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const emptyBox: React.CSSProperties = {
  borderRadius: 24,
  border: "1px dashed #d1d5db",
  background: "#ffffff",
  padding: 18,
};

const emptyCompact: React.CSSProperties = {
  borderRadius: 18,
  border: "1px dashed #d1d5db",
  background: "#ffffff",
  padding: 14,
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17,24,39,0.35)",
  zIndex: 9998,
};

const drawer: React.CSSProperties = {
  position: "absolute",
  right: 12,
  top: 12,
  width: "min(360px, calc(100vw - 24px))",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 22,
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(0,0,0,0.12)",
};

const drawerTop: React.CSSProperties = {
  padding: 16,
  borderBottom: "1px solid #e5e7eb",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const drawerBtnPrimary: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(16,185,129,0.30)",
  background: "rgba(16,185,129,0.10)",
  color: "#065f46",
  padding: "12px 14px",
  borderRadius: 16,
  cursor: "pointer",
  fontWeight: 950,
  textAlign: "left",
};

const drawerBtn: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "12px 14px",
  borderRadius: 16,
  cursor: "pointer",
  fontWeight: 900,
  textAlign: "left",
};

const drawerDangerBtn: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(185,28,28,0.25)",
  background: "rgba(185,28,28,0.05)",
  color: "#991b1b",
  padding: "12px 14px",
  borderRadius: 16,
  cursor: "pointer",
  fontWeight: 900,
  textAlign: "left",
};

const smallCloseBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  borderRadius: 14,
  padding: "8px 10px",
  cursor: "pointer",
  fontWeight: 900,
};

const modal: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(520px, calc(100vw - 24px))",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 22,
  padding: 16,
  boxShadow: "0 30px 80px rgba(0,0,0,0.12)",
};

const input: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "0 14px",
  outline: "none",
  fontWeight: 800,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 46,
    borderRadius: 16,
    border: "1px solid rgba(16,185,129,0.35)",
    background: disabled ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.14)",
    color: "#065f46",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 950,
  };
}

const secondaryBtn: React.CSSProperties = {
  width: "100%",
  height: 46,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 900,
};

function segBtn(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    border: active ? "1px solid rgba(16,185,129,0.35)" : "1px solid #e5e7eb",
    background: active ? "rgba(16,185,129,0.12)" : "#ffffff",
    color: active ? "#065f46" : "#111827",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 900,
  };
}

const iconBtn: React.CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 900,
};

const primaryInlineBtn: React.CSSProperties = {
  height: 42,
  borderRadius: 14,
  border: "1px solid rgba(16,185,129,0.32)",
  background: "rgba(16,185,129,0.12)",
  color: "#065f46",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 950,
};

const secondaryInlineBtn: React.CSSProperties = {
  height: 42,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 900,
};

function acceptInlineBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 42,
    borderRadius: 14,
    border: "1px solid rgba(16,185,129,0.32)",
    background: disabled ? "rgba(16,185,129,0.08)" : "rgba(16,185,129,0.12)",
    color: "#065f46",
    padding: "0 14px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 950,
    opacity: disabled ? 0.72 : 1,
  };
}

function secondaryBtnDisabledCapable(disabled: boolean): React.CSSProperties {
  return {
    height: 42,
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    padding: "0 14px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.65 : 1,
  };
}

function dangerInlineBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 42,
    borderRadius: 14,
    border: "1px solid rgba(185,28,28,0.35)",
    background: "#ffffff",
    color: "#991b1b",
    padding: "0 14px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.65 : 1,
  };
}

function chipStyle(tone: "green" | "amber" | "red" | "gray"): React.CSSProperties {
  const map = {
    green: {
      border: "1px solid rgba(16,185,129,0.25)",
      background: "rgba(16,185,129,0.10)",
      color: "#065f46",
    },
    amber: {
      border: "1px solid rgba(245,158,11,0.25)",
      background: "rgba(245,158,11,0.10)",
      color: "#92400e",
    },
    red: {
      border: "1px solid rgba(239,68,68,0.25)",
      background: "rgba(239,68,68,0.10)",
      color: "#991b1b",
    },
    gray: {
      border: "1px solid #e5e7eb",
      background: "#f9fafb",
      color: "#374151",
    },
  } as const;

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    borderRadius: 999,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
    ...map[tone],
  };
}

const linkBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#065f46",
  fontWeight: 900,
  cursor: "pointer",
  padding: 0,
};

function skel(width: any, height: number): React.CSSProperties {
  return {
    width,
    height,
    borderRadius: 12,
    background: "#e5e7eb",
  };
}

const skeletonCard: React.CSSProperties = {
  height: 118,
  borderRadius: 22,
  background: "#e5e7eb",
};
