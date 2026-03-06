"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

/* ---------------- Types ---------------- */

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

type TabKey = "overview" | "listings" | "activity" | "requests" | "history";

/* ---------------- Helpers ---------------- */

function isAshlandEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@ashland.edu");
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
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

/* ---------------- Page ---------------- */

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

  // local seen marker
  const [offersSeenAt, setOffersSeenAt] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const displayName =
    (profile?.full_name ?? "").trim() ||
    (userEmail ? userEmail.split("@")[0] : "") ||
    "Account";

  const roleLabel = (profile?.user_role ?? "").trim() || "member";

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

  const hasNewRequests = unseenIncomingInterestCount + unseenIncomingOfferCount > 0;

  const activeListings = useMemo(
    () => myItems.filter((x) => normStatus(x.status) !== "claimed"),
    [myItems]
  );

  const completedListings = useMemo(
    () => myItems.filter((x) => normStatus(x.status) === "claimed"),
    [myItems]
  );

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

  /* ---------------- Loaders ---------------- */

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
      .select("id,request_id,helper_id,status,availability,note,created_at,request_item:items(id,title,status,post_type)")
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

    const { error } = await supabase
      .from("interests")
      .update({ owner_seen_at: nowIso })
      .in("id", ids);

    if (error) return;

    setIncomingInterests((prev) =>
      prev.map((r) =>
        r.owner_seen_at || r.owner_dismissed_at ? r : { ...r, owner_seen_at: nowIso }
      )
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

  /* ---------------- Actions ---------------- */

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
      title: "Delete request?",
      body: "This removes it from your incoming list.",
      actionLabel: "Delete",
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

    const { error } = await supabase
      .from("request_offers")
      .update({ status: next })
      .eq("id", o.id);

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

      const { data, error } = await supabase
        .from("items")
        .select("owner_id")
        .eq("id", reqId)
        .single();

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

  /* ---------------- Effects ---------------- */

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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- Render ---------------- */

  if (loading) {
    return <div style={pageWrap}><div style={shell}>Loading…</div></div>;
  }

  if (!isLoggedIn) {
    return (
      <div style={pageWrap}>
        <div style={shell}>
          <div style={headerCard}>
            <div style={{ fontSize: 28, fontWeight: 950 }}>Account</div>
            <div style={{ marginTop: 8, color: "#4b5563" }}>
              Sign in or sign up using your <b>@ashland.edu</b> email.
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setAuthMode("signin")} style={pillBtn(authMode === "signin")}>
              Sign in
            </button>
            <button onClick={() => setAuthMode("signup")} style={pillBtn(authMode === "signup")}>
              Sign up
            </button>
          </div>

          <div style={{ ...panel, marginTop: 14 }}>
            <div style={{ fontWeight: 950, marginBottom: 12 }}>
              {authMode === "signin" ? "Welcome back" : "Create an account"}
            </div>

            <input
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@ashland.edu"
              autoComplete="email"
              inputMode="email"
              style={input}
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

            <button onClick={handleAuth} disabled={authBusy} style={primaryBtn(authBusy)}>
              {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
            </button>

            {err && <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 900 }}>{err}</div>}

            <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
              You can still browse the feed without logging in.
            </div>

            <button onClick={() => router.push("/feed")} style={{ ...outlineBtn, width: "100%", marginTop: 10 }}>
              Browse feed
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={shell}>
        {/* top */}
        <div style={headerCard}>
          <div style={topRow}>
            <div style={idWrap}>
              <div style={avatar}>{displayName.slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={nameLine}>{displayName}</div>
                <div style={subLine}>
                  {roleLabel} • {userEmail}
                </div>
              </div>
            </div>

            <button onClick={() => setDrawerOpen(true)} style={iconBtn} aria-label="Open menu">
              ☰
            </button>
          </div>

          {err && <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900 }}>{err}</div>}

          <div style={tabsRow}>
            <button onClick={() => setTab("overview")} style={tabPill(tab === "overview")}>
              Overview
            </button>
            <button onClick={() => setTab("listings")} style={tabPill(tab === "listings")}>
              Listings
            </button>
            <button onClick={() => setTab("activity")} style={tabPill(tab === "activity")}>
              My activity
            </button>
            <button
              onClick={() => {
                setTab("requests");
                setOffersSeenAt(new Date().toISOString());
                void markIncomingSeen();
              }}
              style={tabPill(tab === "requests")}
            >
              Requests
              {hasNewRequests && <span style={dot} />}
            </button>
            <button onClick={() => setTab("history")} style={tabPill(tab === "history")}>
              History
            </button>
          </div>

          <div style={statsRow}>
            <span>Listed: {stats.listed}</span>
            <span>Interests: {stats.interests}</span>
            <span>Offers: {stats.offers}</span>
            <span>Chats: {stats.chats}</span>
          </div>
        </div>

        {/* overview */}
        {tab === "overview" && (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            <div style={panel}>
              <div style={{ fontWeight: 950, fontSize: 18 }}>Quick actions</div>
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <button onClick={() => router.push("/create")} style={primaryBtn(false)}>
                  Create post
                </button>
                <button onClick={() => router.push("/feed")} style={outlineBtn}>
                  Browse feed
                </button>
                <button onClick={() => router.push("/messages")} style={outlineBtn}>
                  Messages
                </button>
                <button onClick={() => router.push("/pickups")} style={outlineBtn}>
                  My pickups
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <StatCard label="Active listings" value={activeListings.length} />
              <StatCard label="Completed listings" value={completedListings.length} />
              <StatCard label="Incoming requests" value={incomingInterests.length} />
              <StatCard label="Incoming offers" value={incomingOffers.length} />
            </div>
          </div>
        )}

        {/* listings */}
        {tab === "listings" && (
          <div style={{ marginTop: 14 }}>
            <div style={sectionHint}>Your active posts. Claimed items move to History.</div>

            {activeListings.length === 0 ? (
              <EmptyBox title="No active listings." body="List something or post a request to get started.">
                <button onClick={() => router.push("/create")} style={outlineBtn}>
                  ＋ Create post
                </button>
              </EmptyBox>
            ) : (
              <div style={grid}>
                {activeListings.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    variant="active"
                    onEdit={() => router.push(`/item/${item.id}/edit`)}
                    onManage={() => router.push(`/manage/${item.id}`)}
                    onDelete={() => deleteListing(item.id)}
                    deleting={deletingId === item.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* activity */}
        {tab === "activity" && (
          <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
            <section>
              <div style={sectionTitle}>My interests</div>
              <div style={sectionHint}>These are GIVE posts you requested.</div>

              {myRequests.length === 0 ? (
                <EmptyBox title="No interests yet." body="Go to the feed and request an item.">
                  <button onClick={() => router.push("/feed")} style={outlineBtn}>
                    Browse feed
                  </button>
                </EmptyBox>
              ) : (
                <div style={list}>
                  {myRequests.map((r) => {
                    const it = r.items;
                    return (
                      <div key={r.item_id + (r.created_at ?? "")} style={rowCard}>
                        <div style={rowMain}>
                          <Thumb photoUrl={it?.photo_url ?? null} label={it?.title ?? "Item"} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={rowTitle}>{it?.title ?? "Unknown item"}</div>
                            <div style={rowMeta}>
                              Status: <b>{it?.status ?? "—"}</b>
                              {r.created_at ? ` • Sent: ${fmtWhen(r.created_at)}` : ""}
                            </div>
                          </div>
                        </div>

                        <div style={rowActions}>
                          <button onClick={() => router.push(`/item/${r.item_id}`)} style={outlineBtn}>
                            View
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div style={sectionTitle}>My offers</div>
              <div style={sectionHint}>REQUEST posts where you offered help.</div>

              {myOffers.length === 0 ? (
                <EmptyBox title="No offers yet." body="Find a request post in the feed and offer help.">
                  <button onClick={() => router.push("/feed")} style={outlineBtn}>
                    Browse feed
                  </button>
                </EmptyBox>
              ) : (
                <div style={list}>
                  {myOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = myOfferActingId === o.id;

                    return (
                      <div key={o.id} style={rowCard}>
                        <div style={rowMain}>
                          <div style={{ ...thumbWrap, fontSize: 20 }}>🤝</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={rowTitle}>Offered help on {title}</div>
                            <div style={rowMeta}>
                              Status: <b>{st}</b>
                              {o.created_at ? ` • Offered: ${fmtWhen(o.created_at)}` : ""}
                              {o.availability ? ` • Availability: ${o.availability}` : ""}
                            </div>
                            {o.note ? <div style={noteText}>{o.note}</div> : null}
                          </div>
                        </div>

                        <div style={rowActions}>
                          <button onClick={() => router.push(`/item/${o.request_id}`)} style={outlineBtn}>
                            View
                          </button>

                          <button
                            onClick={() => startChatFromMyOffer(o)}
                            disabled={acting || st !== "accepted"}
                            style={softActionBtn(acting || st !== "accepted")}
                          >
                            {acting ? "Opening…" : "Start chat"}
                          </button>

                          <button
                            onClick={() => withdrawMyOffer(o)}
                            disabled={acting || st === "accepted" || st === "completed"}
                            style={dangerBtn(acting || st === "accepted" || st === "completed")}
                          >
                            {acting ? "Working…" : "Withdraw"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* requests */}
        {tab === "requests" && (
          <div style={{ marginTop: 14, display: "grid", gap: 18 }}>
            <section>
              <div style={sectionTitle}>Incoming item requests</div>
              <div style={sectionHint}>People who requested your GIVE listings.</div>

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    if (userId) void loadIncomingAll(userId);
                  }}
                  disabled={incomingLoading}
                  style={outlineBtn}
                >
                  {incomingLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {incomingInterests.length === 0 ? (
                <EmptyBox title="No incoming item requests." body="When someone requests your item, it will appear here." />
              ) : (
                <div style={list}>
                  {incomingInterests.map((r) => {
                    const itemTitle = r.items?.title?.trim() ? r.items.title : "Unknown item";
                    const who = niceNameFromProfile(r.requester, "Ashland user");
                    const when = fmtWhen(r.created_at);
                    const deleting = deletingNotifId === r.id;

                    return (
                      <div key={r.id} style={rowCard}>
                        <div style={rowMain}>
                          <Thumb photoUrl={r.items?.photo_url ?? null} label={itemTitle} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={rowTitle}>{who} requested {itemTitle}</div>
                            <div style={rowMeta}>
                              {when ? `Requested: ${when} • ` : ""}
                              {r.owner_seen_at ? "Seen" : "New"}
                              {r.status ? ` • ${r.status}` : ""}
                            </div>
                          </div>
                        </div>

                        <div style={rowActions}>
                          <button onClick={() => router.push(`/manage/${r.item_id}`)} style={outlineBtn}>
                            Open
                          </button>

                          <button
                            onClick={() => deleteNotification(r)}
                            disabled={deleting}
                            style={dangerBtn(deleting)}
                          >
                            {deleting ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div style={sectionTitle}>Incoming help offers</div>
              <div style={sectionHint}>Accept one helper, hold others, or decline.</div>

              {incomingOffers.length === 0 ? (
                <EmptyBox title="No incoming offers." body="When someone offers help on your request post, it will appear here." />
              ) : (
                <div style={list}>
                  {incomingOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const who = niceNameFromProfile(o.helper, "Ashland user");
                    const when = fmtWhen(o.created_at);
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = offerActingId === o.id;

                    return (
                      <div key={o.id} style={rowCard}>
                        <div style={rowMain}>
                          <div style={{ ...thumbWrap, fontSize: 20 }}>🤝</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={rowTitle}>{who} offered help on {title}</div>
                            <div style={rowMeta}>
                              {when ? `Offered: ${when} • ` : ""}
                              Status: <b>{st}</b>
                              {o.availability ? ` • Availability: ${o.availability}` : ""}
                            </div>
                            {o.note ? <div style={noteText}>{o.note}</div> : null}
                          </div>
                        </div>

                        <div style={rowActions}>
                          <button onClick={() => router.push(`/item/${o.request_id}`)} style={outlineBtn}>
                            View
                          </button>

                          <button
                            onClick={() => updateOfferStatus(o, "accepted")}
                            disabled={acting || st === "accepted" || st === "completed"}
                            style={acceptBtn(acting || st === "accepted" || st === "completed")}
                          >
                            {acting ? "Working…" : "Accept"}
                          </button>

                          <button
                            onClick={() => updateOfferStatus(o, "hold")}
                            disabled={acting || st === "accepted" || st === "completed"}
                            style={softActionBtn(acting || st === "accepted" || st === "completed")}
                          >
                            Hold
                          </button>

                          <button
                            onClick={() => updateOfferStatus(o, "declined")}
                            disabled={acting || st === "declined" || st === "completed"}
                            style={dangerBtn(acting || st === "declined" || st === "completed")}
                          >
                            Decline
                          </button>

                          <button
                            onClick={() => startChatWithHelper(o)}
                            disabled={acting || st !== "accepted"}
                            style={softActionBtn(acting || st !== "accepted")}
                          >
                            {acting ? "Opening…" : "Start chat"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* history */}
        {tab === "history" && (
          <div style={{ marginTop: 14 }}>
            <div style={sectionTitle}>Completed listings</div>
            <div style={sectionHint}>These were picked up and marked as claimed.</div>

            {completedListings.length === 0 ? (
              <EmptyBox title="No completed listings yet." body="When a pickup is marked, it will move here." />
            ) : (
              <div style={grid}>
                {completedListings.map((item) => (
                  <ItemCard key={item.id} item={item} variant="history" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* drawer */}
        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} style={backdrop}>
            <div onClick={(e) => e.stopPropagation()} style={drawer}>
              <div style={drawerTop}>
                <div style={{ fontWeight: 950 }}>Menu</div>
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
                  style={drawerBtn}
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

                <button onClick={signOut} style={{ ...drawerBtn, border: "1px solid rgba(185,28,28,0.55)", color: "#991b1b" }}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* confirm */}
        {confirm && (
          <ConfirmModal
            title={confirm.title}
            body={confirm.body}
            actionLabel={confirm.actionLabel}
            onCancel={() => setConfirm(null)}
            onConfirm={confirm.onYes}
          />
        )}

        {/* toast */}
        {toast && <Toast msg={toast.msg} kind={toast.kind} />}
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={panel}>
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 900 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 28, fontWeight: 950, color: "#111827" }}>{value}</div>
    </div>
  );
}

function ItemCard({
  item,
  variant,
  onEdit,
  onManage,
  onDelete,
  deleting,
}: {
  item: MyItemRow;
  variant: "active" | "history";
  onEdit?: () => void;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const status = item.status ?? "—";
  const type = (item.post_type ?? "give") as "give" | "request";

  return (
    <div style={card}>
      <div style={cardMediaWrap}>
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} style={cardImg} />
        ) : (
          <div style={noPhoto}>{type === "request" ? "Request" : "No photo"}</div>
        )}
      </div>

      <div style={{ marginTop: 10, minHeight: 44 }}>
        <div style={cardTitle}>{item.title}</div>
        <div style={cardSub}>{item.description ? item.description : "—"}</div>
      </div>

      <div style={cardMeta}>
        Type: <b>{type}</b> • Status: <b>{status}</b>
      </div>

      {variant === "active" ? (
        <div style={cardActions}>
          <button onClick={onEdit} style={acceptBtn(false)}>Edit</button>
          <button onClick={onManage} style={outlineBtn}>Manage</button>
          <button onClick={onDelete} disabled={!!deleting} style={dangerBtn(!!deleting)}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10, color: "#374151", fontSize: 12 }}>Completed ✅</div>
      )}
    </div>
  );
}

function Thumb({ photoUrl, label }: { photoUrl: string | null; label: string }) {
  return (
    <div style={thumbWrap}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        "—"
      )}
    </div>
  );
}

function EmptyBox({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ ...panel, marginTop: 14 }}>
      <div style={{ fontWeight: 950, color: "#111827" }}>{title}</div>
      <div style={{ color: "#374151", marginTop: 6 }}>{body}</div>
      {children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </div>
  );
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
        borderRadius: 14,
        padding: "10px 12px",
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        color: "#111827",
        boxShadow: "0 18px 50px rgba(0,0,0,0.14)",
        fontWeight: 900,
        maxWidth: "min(560px, calc(100vw - 24px))",
      }}
    >
      <span style={{ color: kind === "err" ? "#b91c1c" : "#065f46" }}>
        {kind === "err" ? "⚠ " : "✓ "}
      </span>
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
        <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>
        <div style={{ marginTop: 6, color: "#374151" }}>{body}</div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={outlineBtn}>
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

/* ---------------- Styles ---------------- */

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f7f7f8",
  color: "#111827",
};

const shell: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: 14,
  paddingBottom: "calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 24px)",
};

const headerCard: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 40,
  background: "rgba(247,247,248,0.92)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const topRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const idWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

const avatar: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  fontSize: 16,
  flexShrink: 0,
};

const nameLine: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 950,
  lineHeight: 1.1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const subLine: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const iconBtn: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 900,
};

const tabsRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  overflowX: "auto",
  paddingTop: 12,
};

const statsRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 10,
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 900,
};

const panel: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const input: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "0 12px",
  outline: "none",
  fontWeight: 800,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(16,185,129,0.35)",
    background: disabled ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.14)",
    color: "#065f46",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 950,
  };
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    border: active ? "1px solid rgba(16,185,129,0.35)" : "1px solid #e5e7eb",
    background: active ? "rgba(16,185,129,0.12)" : "#ffffff",
    color: active ? "#065f46" : "#111827",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
  };
}

function tabPill(active: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    borderRadius: 999,
    border: active ? "1px solid rgba(16,185,129,0.35)" : "1px solid #e5e7eb",
    background: active ? "rgba(16,185,129,0.12)" : "#ffffff",
    color: active ? "#065f46" : "#111827",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };
}

const outlineBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
  whiteSpace: "nowrap",
};

function acceptBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid rgba(16,185,129,0.35)",
    background: disabled ? "rgba(16,185,129,0.08)" : "rgba(16,185,129,0.12)",
    color: "#065f46",
    padding: "10px 12px",
    borderRadius: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.7 : 1,
  };
}

function softActionBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    padding: "10px 12px",
    borderRadius: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.65 : 1,
  };
}

function dangerBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid rgba(185,28,28,0.55)",
    background: "#ffffff",
    color: "#991b1b",
    padding: "10px 12px",
    borderRadius: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.65 : 1,
  };
}

const dot: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#ef4444",
  marginLeft: 8,
  boxShadow: "0 0 0 3px rgba(239,68,68,0.20)",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 20,
  color: "#111827",
};

const sectionHint: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "#6b7280",
};

const grid: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const list: React.CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 12,
};

const card: React.CSSProperties = {
  background: "#ffffff",
  padding: 14,
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const cardMediaWrap: React.CSSProperties = {
  width: "100%",
  height: 150,
  borderRadius: 16,
  overflow: "hidden",
  border: "1px solid #e5e7eb",
  background: "#f3f4f6",
};

const cardImg: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const noPhoto: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
};

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 950,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const cardSub: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "#374151",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as any,
  overflow: "hidden",
};

const cardMeta: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  color: "#374151",
};

const cardActions: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 10,
  marginTop: 12,
};

const rowCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.05)",
};

const rowMain: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  minWidth: 0,
};

const rowTitle: React.CSSProperties = {
  fontWeight: 950,
  fontSize: 16,
  color: "#111827",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMeta: React.CSSProperties = {
  color: "#374151",
  fontSize: 12,
  marginTop: 6,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
};

const rowActions: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 12,
};

const thumbWrap: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#f3f4f6",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
  flexShrink: 0,
};

const noteText: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  color: "#374151",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
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
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 30px 80px rgba(0,0,0,0.12)",
};

const drawerTop: React.CSSProperties = {
  padding: 14,
  borderBottom: "1px solid #e5e7eb",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const drawerBtn: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
  textAlign: "left",
};

const smallCloseBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  borderRadius: 14,
  padding: "6px 10px",
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
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 30px 80px rgba(0,0,0,0.12)",
};