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
  created_at?: string;
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
  id: string; // interests.id
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
  id: string; // request_offers.id
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
  id: string; // request_offers.id
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

/* ---------------- Page ---------------- */

export default function AccountPage() {
  const router = useRouter();

  // auth (single source of truth)
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // page state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // logged-out UI
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

  // tabs
  const [tab, setTab] = useState<"listings" | "my_activity" | "requests" | "history">("listings");

  // lightweight “counts”
  const [stats, setStats] = useState<{ listed: number; interests: number; offers: number; chats: number }>({
    listed: 0,
    interests: 0,
    offers: 0,
    chats: 0,
  });

  // drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // action states
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);
  const [offerActingId, setOfferActingId] = useState<string | null>(null);
  const [myOfferActingId, setMyOfferActingId] = useState<string | null>(null);

  // non-blocking UI feedback (replaces alert/confirm)
  const [toast, setToast] = useState<{ msg: string; kind?: "ok" | "err" } | null>(null);
  const toastTimer = useRef<any>(null);

  const [confirm, setConfirm] = useState<null | { title: string; body: string; actionLabel: string; onYes: () => Promise<void> }>(null);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  // “offers seen” local marker so the red dot clears after user opens Requests.
  const [offersSeenAt, setOffersSeenAt] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const unseenIncomingInterestCount = useMemo(() => {
    return incomingInterests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at).length;
  }, [incomingInterests]);

  const unseenIncomingOfferCount = useMemo(() => {
    // only treat “pending offers created after last seen” as “new”
    const pending = incomingOffers.filter((o) => (o.status ?? "pending") === "pending");
    if (!offersSeenAt) return pending.length;
    const seenT = new Date(offersSeenAt).getTime();
    return pending.filter((o) => {
      const t = o.created_at ? new Date(o.created_at).getTime() : 0;
      return t > seenT;
    }).length;
  }, [incomingOffers, offersSeenAt]);

  const hasNewRequests = unseenIncomingInterestCount + unseenIncomingOfferCount > 0;

  const activeListings = useMemo(() => myItems.filter((x) => normStatus(x.status) !== "claimed"), [myItems]);
  const completedListings = useMemo(() => myItems.filter((x) => normStatus(x.status) === "claimed"), [myItems]);

  const displayName =
    (profile?.full_name ?? "").trim() || (userEmail ? userEmail.split("@")[0] : "") || "Account";
  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  /* ---------------- Loaders (NO auth.getSession inside these) ---------------- */

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
      setMyItems([]);
      setErr(error.message);
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

    setMyOffers((data as MyOfferRow[]) ?? []);
    return (data as MyOfferRow[]) ?? [];
  }

  // ✅ collapsed into ONE query using joins (no owned-items fetch, no extra item/profile fetch)
  async function loadIncomingInterests(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select(
        `
        id,item_id,user_id,created_at,owner_seen_at,owner_dismissed_at,status,
        items:items(id,title,photo_url,status,owner_id,post_type),
        requester:profiles!interests_user_id_fkey(full_name,email,user_role)
      `
      )
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

  // ✅ collapsed into ONE query using joins
  async function loadIncomingOffers(uid: string) {
    const { data, error } = await supabase
      .from("request_offers")
      .select(
        `
        id,request_id,helper_id,status,availability,note,created_at,updated_at,
        request_item:items(id,title,status,owner_id,post_type),
        helper:profiles!request_offers_helper_id_fkey(full_name,email,user_role)
      `
      )
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
    // only for interests (offers don’t have owner_seen_at in your schema)
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

  /* ---------------- Actions (non-blocking confirm/toast) ---------------- */

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
      showToast(e?.message || "Could not open chat.", "err");
    } finally {
      setOfferActingId(null);
    }
  }

  async function withdrawMyOffer(off: MyOfferRow) {
    const st = (off.status ?? "pending") as OfferStatus;
    if (st === "accepted" || st === "completed") return showToast("Cannot withdraw after acceptance/completion.", "err");

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
      showToast(e?.message || "Could not open chat.", "err");
    } finally {
      setMyOfferActingId(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setDrawerOpen(false);
    // auth listener will handle clearing state
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
        const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
        if (error) setErr(error.message);
        return;
      }

      const { error } = await supabase.auth.signUp({ email, password: authPassword });
      if (error) setErr(error.message);
    } finally {
      setAuthBusy(false);
    }
  }

  /* ---------------- Single load pipeline ---------------- */

  async function loadAllFor(uid: string, email: string) {
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
      const { count, error: tErr } = await supabase
        .from("threads")
        .select("id", { count: "exact", head: true })
        .or(`owner_id.eq.${uid},requester_id.eq.${uid}`);
      if (!tErr) chats = count ?? 0;
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

  useEffect(() => {
    // ✅ ONE initial session fetch
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

      await loadAllFor(uid, email);
    })();

    // ✅ ONE auth listener that drives reloads
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

      await loadAllFor(uid, email);
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

  if (loading) return <div style={pageWrap}>Loading…</div>;

  /* ---------------- Logged Out ---------------- */
  if (!isLoggedIn) {
    return (
      <div style={{ ...pageWrap, paddingBottom: 120 }}>
        <div style={lightShell}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Account</h1>
          <p style={{ opacity: 0.75, marginTop: 10 }}>
            Sign in or sign up using your <b>@ashland.edu</b> email.
          </p>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setAuthMode("signin")} style={pillBtnLight(authMode === "signin")}>
              Sign in
            </button>
            <button onClick={() => setAuthMode("signup")} style={pillBtnLight(authMode === "signup")}>
              Sign up
            </button>
          </div>

          <div style={panelLight}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>
              {authMode === "signin" ? "Welcome back" : "Create an account"}
            </div>

            <input
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="you@ashland.edu"
              autoComplete="email"
              inputMode="email"
              style={inputStyleLight}
            />

            <input
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="password"
              type="password"
              autoComplete={authMode === "signin" ? "current-password" : "new-password"}
              style={{ ...inputStyleLight, marginTop: 10 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAuth();
              }}
            />

            <button onClick={handleAuth} disabled={authBusy} style={primaryBtnLight(authBusy)}>
              {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
            </button>

            {err && <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900 }}>{err}</div>}

            <div style={{ marginTop: 12, opacity: 0.72, fontSize: 13 }}>
              You can still browse the feed without logging in.
            </div>

            <button onClick={() => router.push("/feed")} style={{ ...outlineBtnLight, width: "100%", height: 44 }}>
              Browse feed
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- Logged In ---------------- */
  return (
    <div style={pageWrap}>
      <style jsx>{`
        /* Sticky reliability: never set overflow on ancestors of header */
        .shell {
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
          padding-bottom: calc(120px + env(safe-area-inset-bottom));
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 50;
          background: rgba(247, 247, 248, 0.86);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
        }

        .topRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
        }

        .identity {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .nameLine {
          font-size: 18px;
          font-weight: 950;
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .subLine {
          opacity: 0.72;
          font-size: 12px;
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tabs {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-top: 10px;
          padding-bottom: 6px;
        }
        .tabs::-webkit-scrollbar {
          display: none;
        }

        .statsRow {
          display: flex;
          gap: 12px;
          flex-wrap: nowrap;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin-top: 6px;
          opacity: 0.78;
          font-size: 12px;
          font-weight: 900;
          padding-bottom: 2px;
        }
        .statsRow::-webkit-scrollbar {
          display: none;
        }

        .content {
          margin-top: 12px;
        }

        .reqCard {
          border: 1px solid #e5e7eb;
          background: #ffffff;
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
        }

        .reqRow {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
          flex-wrap: wrap;
        }

        .reqMain {
          flex: 1;
          min-width: 0;
        }

        .reqTitle {
          font-weight: 950;
          font-size: 16px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #111827;
        }

        .reqMeta {
          opacity: 0.85;
          color: #374151;
          font-size: 12px;
          margin-top: 6px;
          line-height: 1.35;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .reqActions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-start;
          align-items: center;
          width: 100%;
          margin-top: 10px;
        }

        @media (min-width: 720px) {
          .reqActions {
            width: auto;
            margin-top: 0;
            justify-content: flex-end;
          }
        }

        .rail {
          margin-top: 12px;
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 10px;
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: x mandatory;
        }
        .rail::-webkit-scrollbar {
          display: none;
        }

        .railItem {
          scroll-snap-align: start;
          flex: 0 0 auto;
          width: min(320px, 86vw);
        }

        @media (min-width: 900px) {
          .railItem {
            width: 340px;
          }
        }
      `}</style>

      <div className="shell">
        {/* Header */}
        <div className="header">
          <div className="topRow">
            <div className="identity">
              <div style={avatarLight} title={displayName}>
                {displayName.slice(0, 1).toUpperCase()}
              </div>

              <div style={{ minWidth: 0 }}>
                <div className="nameLine">{displayName}</div>
                <div className="subLine">
                  {roleLabel} • {userEmail}
                </div>
              </div>
            </div>

            <button onClick={() => setDrawerOpen(true)} style={iconBtnLight} aria-label="Open menu" title="Menu">
              ☰
            </button>
          </div>

          {err && <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900 }}>{err}</div>}

          <div className="tabs">
            <button onClick={() => setTab("listings")} style={tabPillLight(tab === "listings")}>
              Listings
            </button>

            <button onClick={() => setTab("my_activity")} style={tabPillLight(tab === "my_activity")}>
              My activity
            </button>

            <button
              onClick={() => {
                // ✅ instant UI
                setTab("requests");

                // ✅ offers “seen” marker so dot clears
                setOffersSeenAt(new Date().toISOString());

                // ✅ mark seen in background (no await)
                void markIncomingSeen();
              }}
              style={tabPillLight(tab === "requests")}
            >
              Requests
              {hasNewRequests && <span style={dotLight} aria-label="New requests" title="New requests" />}
            </button>

            <button onClick={() => setTab("history")} style={tabPillLight(tab === "history")}>
              History
            </button>
          </div>

          <div className="statsRow">
            <span>Listed: {stats.listed}</span>
            <span>Interests: {stats.interests}</span>
            <span>Offers: {stats.offers}</span>
            <span>Chats: {stats.chats}</span>
          </div>
        </div>

        {/* Content */}
        <div className="content">
          {tab === "listings" && (
            <>
              <div style={sectionHintLight}>Your active posts (give + requests). Completed (claimed) posts live in History.</div>

              {activeListings.length === 0 ? (
                <EmptyBoxLight title="No active listings." body="List something or post a request to start exchanging.">
                  <button onClick={() => router.push("/create")} style={outlineBtnLight}>
                    ＋ Create post
                  </button>
                </EmptyBoxLight>
              ) : (
                <div className="rail">
                  {activeListings.map((item) => (
                    <div className="railItem" key={item.id}>
                      <ItemCardLight
                        item={item}
                        variant="active"
                        onEdit={() => router.push(`/item/${item.id}/edit`)}
                        onManage={() => router.push(`/manage/${item.id}`)}
                        onDelete={() => deleteListing(item.id)}
                        deleting={deletingId === item.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "my_activity" && (
            <>
              <div style={sectionHintLight}>Your activity across both flows.</div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#111827" }}>My interests (items I requested)</div>
                <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13, color: "#374151" }}>
                  These are GIVE posts you requested.
                </div>
              </div>

              {myRequests.length === 0 ? (
                <EmptyBoxLight title="No interests yet." body="Go to the feed and request an item.">
                  <button onClick={() => router.push("/feed")} style={outlineBtnLight}>
                    Browse feed
                  </button>
                </EmptyBoxLight>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {myRequests.map((r) => {
                    const it = r.items;
                    return (
                      <div key={r.item_id + (r.created_at ?? "")} className="reqCard">
                        <div className="reqRow">
                          <ThumbLight photoUrl={it?.photo_url ?? null} label={it?.title ?? "Item"} />

                          <div className="reqMain">
                            <div className="reqTitle">{it?.title ?? "Unknown item"}</div>
                            <div className="reqMeta">
                              Status: <b>{it?.status ?? "—"}</b>
                              {r.created_at ? ` • Sent: ${fmtWhen(r.created_at)}` : ""}
                            </div>
                          </div>

                          <div className="reqActions">
                            <button onClick={() => router.push(`/item/${r.item_id}`)} style={{ ...outlineBtnLight, marginTop: 0 }}>
                              View
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#111827" }}>My offers (help I offered)</div>
                <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13, color: "#374151" }}>
                  REQUEST posts where you offered help. Chat unlocks only after acceptance.
                </div>
              </div>

              {myOffers.length === 0 ? (
                <EmptyBoxLight title="No offers yet." body="Find a request post in the feed and tap “Offer help”.">
                  <button onClick={() => router.push("/feed")} style={outlineBtnLight}>
                    Browse feed
                  </button>
                </EmptyBoxLight>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {myOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = myOfferActingId === o.id;

                    return (
                      <div key={o.id} className="reqCard">
                        <div className="reqRow">
                          <div style={{ ...thumbWrapLight, width: 54, height: 54 }}>🤝</div>

                          <div className="reqMain">
                            <div className="reqTitle">
                              Offered help on <span style={{ opacity: 0.9 }}>{title}</span>
                            </div>
                            <div className="reqMeta">
                              Status: <b>{st}</b>
                              {o.created_at ? ` • Offered: ${fmtWhen(o.created_at)}` : ""}
                              {o.availability ? ` • Availability: ${o.availability}` : ""}
                            </div>
                            {o.note ? (
                              <div style={{ marginTop: 8, opacity: 0.9, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#374151" }}>
                                {o.note}
                              </div>
                            ) : null}
                          </div>

                          <div className="reqActions">
                            <button onClick={() => router.push(`/item/${o.request_id}`)} style={{ ...outlineBtnLight, marginTop: 0 }}>
                              View
                            </button>

                            <button
                              onClick={() => startChatFromMyOffer(o)}
                              disabled={acting || st !== "accepted"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: st === "accepted" ? "1px solid rgba(16,185,129,0.55)" : "1px solid #e5e7eb",
                                background: st === "accepted" ? "rgba(16,185,129,0.10)" : "transparent",
                                cursor: acting || st !== "accepted" ? "not-allowed" : "pointer",
                                opacity: acting || st !== "accepted" ? 0.65 : 1,
                              }}
                              title={st !== "accepted" ? "Chat unlocks after acceptance" : "Start chat"}
                            >
                              {acting ? "Opening…" : "Start chat"}
                            </button>

                            <button
                              onClick={() => withdrawMyOffer(o)}
                              disabled={acting || st === "accepted" || st === "completed"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: "1px solid rgba(185,28,28,0.55)",
                                cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                                opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                                color: "#991b1b",
                              }}
                              title={st === "accepted" || st === "completed" ? "Cannot withdraw after acceptance/completion" : "Withdraw offer"}
                            >
                              {acting ? "Working…" : "Withdraw"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === "requests" && (
            <>
              <div style={sectionHintLight}>Incoming requests for your GIVE listings + offers for your REQUEST posts.</div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    if (userId) void loadIncomingAll(userId);
                  }}
                  disabled={incomingLoading}
                  style={{
                    ...outlineBtnLight,
                    marginTop: 0,
                    cursor: incomingLoading ? "not-allowed" : "pointer",
                    opacity: incomingLoading ? 0.8 : 1,
                  }}
                >
                  {incomingLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#111827" }}>Incoming item requests (GIVE)</div>
                <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13, color: "#374151" }}>People who requested your items.</div>
              </div>

              {incomingInterests.length === 0 ? (
                <EmptyBoxLight title="No incoming item requests." body="When someone requests your item, it will appear here." />
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {incomingInterests.map((r) => {
                    const itemTitle = r.items?.title?.trim() ? r.items.title : "Unknown item";
                    const who = niceNameFromProfile(r.requester, "Ashland user");
                    const when = fmtWhen(r.created_at);
                    const deleting = deletingNotifId === r.id;

                    return (
                      <div key={r.id} className="reqCard">
                        <div className="reqRow">
                          <ThumbLight photoUrl={r.items?.photo_url ?? null} label={itemTitle} />

                          <div className="reqMain">
                            <div className="reqTitle">
                              {who} requested <span style={{ opacity: 0.9 }}>{itemTitle}</span>
                            </div>
                            <div className="reqMeta">
                              {when ? `Requested: ${when} • ` : ""}
                              {r.owner_seen_at ? "Seen" : "New"}
                              {r.status ? ` • ${r.status}` : ""}
                            </div>
                          </div>

                          <div className="reqActions">
                            <button onClick={() => router.push(`/manage/${r.item_id}`)} style={{ ...outlineBtnLight, marginTop: 0 }}>
                              Open
                            </button>

                            <button
                              onClick={() => deleteNotification(r)}
                              disabled={deleting}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: "1px solid rgba(185,28,28,0.55)",
                                cursor: deleting ? "not-allowed" : "pointer",
                                opacity: deleting ? 0.75 : 1,
                                color: "#991b1b",
                              }}
                              title="Delete request"
                            >
                              {deleting ? "Deleting…" : "Delete"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 950, fontSize: 18, color: "#111827" }}>Incoming help offers (REQUEST)</div>
                <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13, color: "#374151" }}>
                  Accept one helper; hold others; decline if needed. Chat opens only after acceptance.
                </div>
              </div>

              {incomingOffers.length === 0 ? (
                <EmptyBoxLight title="No incoming offers." body="When someone offers help on your request post, it will appear here." />
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {incomingOffers.map((o) => {
                    const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                    const who = niceNameFromProfile(o.helper, "Ashland user");
                    const when = fmtWhen(o.created_at);
                    const st = (o.status ?? "pending") as OfferStatus;
                    const acting = offerActingId === o.id;

                    return (
                      <div key={o.id} className="reqCard">
                        <div className="reqRow">
                          <div style={{ ...thumbWrapLight, width: 54, height: 54 }}>🤝</div>

                          <div className="reqMain">
                            <div className="reqTitle">
                              {who} offered help on <span style={{ opacity: 0.9 }}>{title}</span>
                            </div>
                            <div className="reqMeta">
                              {when ? `Offered: ${when} • ` : ""}
                              Status: <b>{st}</b>
                              {o.availability ? ` • Availability: ${o.availability}` : ""}
                            </div>
                            {o.note ? (
                              <div style={{ marginTop: 8, opacity: 0.9, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#374151" }}>
                                {o.note}
                              </div>
                            ) : null}
                          </div>

                          <div className="reqActions">
                            <button onClick={() => router.push(`/item/${o.request_id}`)} style={{ ...outlineBtnLight, marginTop: 0 }}>
                              View
                            </button>

                            <button
                              onClick={() => updateOfferStatus(o, "accepted")}
                              disabled={acting || st === "accepted" || st === "completed"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: "1px solid rgba(16,185,129,0.55)",
                                background: "rgba(16,185,129,0.10)",
                                cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                                opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                              }}
                            >
                              {acting ? "Working…" : "Accept"}
                            </button>

                            <button
                              onClick={() => updateOfferStatus(o, "hold")}
                              disabled={acting || st === "accepted" || st === "completed"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                                opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                              }}
                            >
                              Hold
                            </button>

                            <button
                              onClick={() => updateOfferStatus(o, "declined")}
                              disabled={acting || st === "declined" || st === "completed"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: "1px solid rgba(185,28,28,0.55)",
                                color: "#991b1b",
                                cursor: acting || st === "declined" || st === "completed" ? "not-allowed" : "pointer",
                                opacity: acting || st === "declined" || st === "completed" ? 0.65 : 1,
                              }}
                            >
                              Decline
                            </button>

                            <button
                              onClick={() => startChatWithHelper(o)}
                              disabled={acting || st !== "accepted"}
                              style={{
                                ...outlineBtnLight,
                                marginTop: 0,
                                border: st === "accepted" ? "1px solid rgba(16,185,129,0.55)" : "1px solid #e5e7eb",
                                background: st === "accepted" ? "rgba(16,185,129,0.10)" : "transparent",
                                cursor: acting || st !== "accepted" ? "not-allowed" : "pointer",
                                opacity: acting || st !== "accepted" ? 0.65 : 1,
                              }}
                              title={st !== "accepted" ? "Chat unlocks after acceptance" : "Start chat"}
                            >
                              {acting ? "Opening…" : "Start chat"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === "history" && (
            <>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 950, fontSize: 20, color: "#111827" }}>Completed listings</div>
                <div style={{ opacity: 0.75, marginTop: 6, color: "#374151" }}>
                  These were picked up (claimed). No actions needed.
                </div>
              </div>

              {completedListings.length === 0 ? (
                <EmptyBoxLight title="No completed listings yet." body="When a pickup is marked, it will move here." />
              ) : (
                <div className="rail">
                  {completedListings.map((item) => (
                    <div className="railItem" key={item.id}>
                      <ItemCardLight item={item} variant="history" />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Drawer */}
        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} style={backdrop}>
            <div onClick={(e) => e.stopPropagation()} style={drawerLight}>
              <div style={drawerTop}>
                <div style={{ fontWeight: 950 }}>Menu</div>
                <button onClick={() => setDrawerOpen(false)} style={smallCloseBtnLight}>
                  ✕
                </button>
              </div>

              <div style={{ padding: 14, display: "grid", gap: 10 }}>
                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/messages");
                  }}
                  style={drawerBtnLight}
                >
                  Messages
                </button>

                <button
                  onClick={() => {
                    setDrawerOpen(false);
                    router.push("/pickups");
                  }}
                  style={drawerBtnLight}
                >
                  My pickups
                </button>

                <button onClick={signOut} style={{ ...drawerBtnLight, border: "1px solid rgba(185,28,28,0.55)", color: "#991b1b" }}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm */}
        {confirm && (
          <ConfirmModal
            title={confirm.title}
            body={confirm.body}
            actionLabel={confirm.actionLabel}
            onCancel={() => setConfirm(null)}
            onConfirm={confirm.onYes}
          />
        )}

        {/* Toast */}
        {toast && <Toast msg={toast.msg} kind={toast.kind} />}
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function ItemCardLight({
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
    <div style={cardLight}>
      <div style={cardMediaWrapLight}>
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} style={cardImg} />
        ) : (
          <div style={noPhotoLight}>{type === "request" ? "Request" : "No photo"}</div>
        )}
      </div>

      <div style={{ marginTop: 10, minHeight: 44 }}>
        <div style={cardTitleLight}>{item.title}</div>
        <div style={cardSubLight}>{item.description ? item.description : "—"}</div>
      </div>

      <div style={cardMetaLight}>
        Type: <b>{type}</b> • Status: <b>{status}</b>
      </div>

      {variant === "active" ? (
        <div style={cardActions}>
          <button onClick={onEdit} style={cardBtnPrimaryLight}>
            Edit
          </button>
          <button onClick={onManage} style={cardBtnOutlineLight}>
            Manage
          </button>
          <button onClick={onDelete} disabled={!!deleting} style={cardBtnDangerLight(!!deleting)}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12, color: "#374151" }}>Completed ✅</div>
      )}
    </div>
  );
}

function ThumbLight({ photoUrl, label }: { photoUrl: string | null; label: string }) {
  return (
    <div style={thumbWrapLight}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        "—"
      )}
    </div>
  );
}

function EmptyBoxLight({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14, ...panelLight }}>
      <div style={{ fontWeight: 950, color: "#111827" }}>{title}</div>
      <div style={{ opacity: 0.85, marginTop: 6, color: "#374151" }}>{body}</div>
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
        bottom: 18,
        zIndex: 99999,
        borderRadius: 14,
        padding: "10px 12px",
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        color: "#111827",
        boxShadow: "0 18px 50px rgba(0,0,0,0.14)",
        fontWeight: 900,
        maxWidth: "min(560px, calc(100vw - 24px))",
        width: "fit-content",
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
      <div onClick={(e) => e.stopPropagation()} style={modalLight}>
        <div style={{ fontWeight: 950, fontSize: 16, color: "#111827" }}>{title}</div>
        <div style={{ marginTop: 6, color: "#374151", opacity: 0.92 }}>{body}</div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={onCancel} disabled={busy} style={outlineBtnLight}>
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
            style={{
              ...primaryBtnLight(busy),
              marginTop: 0,
              height: 44,
            }}
          >
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Styles (Light) ---------------- */

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f7f7f8",
  color: "#111827",
};

const lightShell: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: 16,
};

const avatarLight: React.CSSProperties = {
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
  color: "#111827",
  flexShrink: 0,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const iconBtnLight: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 900,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const panelLight: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const inputStyleLight: React.CSSProperties = {
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

function primaryBtnLight(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 12,
    width: "100%",
    height: 44,
    borderRadius: 14,
    border: "1px solid rgba(16,185,129,0.35)",
    background: disabled ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.14)",
    color: "#065f46",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 950,
    boxShadow: "0 14px 30px rgba(16,185,129,0.12)",
  };
}

function pillBtnLight(active: boolean): React.CSSProperties {
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

const outlineBtnLight: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
  whiteSpace: "nowrap",
  boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
};

function tabPillLight(active: boolean): React.CSSProperties {
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

const dotLight: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#ef4444",
  marginLeft: 8,
  boxShadow: "0 0 0 3px rgba(239,68,68,0.20)",
};

const sectionHintLight: React.CSSProperties = {
  marginTop: 14,
  opacity: 0.78,
  fontSize: 13,
  color: "#374151",
};

const cardLight: React.CSSProperties = {
  background: "#ffffff",
  padding: 14,
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  width: "100%",
  boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
};

const cardMediaWrapLight: React.CSSProperties = {
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

const noPhotoLight: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
  border: "1px dashed #e5e7eb",
  borderRadius: 16,
};

const cardTitleLight: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 950,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
};

const cardSubLight: React.CSSProperties = {
  opacity: 0.8,
  marginTop: 6,
  fontSize: 13,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as any,
  overflow: "hidden",
  overflowWrap: "anywhere",
  color: "#374151",
};

const cardMetaLight: React.CSSProperties = {
  opacity: 0.8,
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

const cardBtnPrimaryLight: React.CSSProperties = {
  border: "1px solid rgba(16,185,129,0.35)",
  background: "rgba(16,185,129,0.12)",
  color: "#065f46",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
};

const cardBtnOutlineLight: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
};

function cardBtnDangerLight(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid rgba(185,28,28,0.55)",
    background: disabled ? "rgba(185,28,28,0.12)" : "#ffffff",
    color: "#991b1b",
    padding: "10px 12px",
    borderRadius: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.8 : 1,
  };
}

const thumbWrapLight: React.CSSProperties = {
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

const smallCloseBtnLight: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  borderRadius: 14,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 900,
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(17,24,39,0.35)",
  zIndex: 9998,
};

const drawerLight: React.CSSProperties = {
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

const drawerBtnLight: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#111827",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
  textAlign: "left",
  boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
};

const modalLight: React.CSSProperties = {
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