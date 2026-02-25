"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
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

/** Incoming item interests (GIVE flow) */
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

/** Incoming help offers (REQUEST flow) */
type OfferStatus = "pending" | "hold" | "accepted" | "declined" | "completed";

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

function shortId(id: string) {
  if (!id) return "";
  return id.slice(0, 6) + "…" + id.slice(-4);
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

function normStatus(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function niceNameFromProfile(p: { full_name: string | null; email: string | null } | null, fallbackId: string) {
  const name = (p?.full_name ?? "").trim();
  if (name) return name;
  const email = (p?.email ?? "").trim();
  if (email) return email.split("@")[0];
  return `User ${shortId(fallbackId)}`;
}

/* ---------------- Page ---------------- */

export default function AccountPage() {
  const router = useRouter();

  // page state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // logged-out UI (email+password)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  // data state
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  // tabs
  const [tab, setTab] = useState<"listings" | "my_activity" | "requests" | "history">("listings");

  const [myItems, setMyItems] = useState<MyItemRow[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]); // GIVE interests I made
  const [myOffers, setMyOffers] = useState<MyOfferRow[]>([]); // REQUEST offers I made

  const [incomingInterests, setIncomingInterests] = useState<IncomingInterestRow[]>([]);
  const [incomingOffers, setIncomingOffers] = useState<IncomingOfferRow[]>([]);

  const [incomingLoading, setIncomingLoading] = useState(false);

  const [stats, setStats] = useState<{ listed: number; requested: number; offers: number; chats: number }>({
    listed: 0,
    requested: 0,
    offers: 0,
    chats: 0,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);
  const [offerActingId, setOfferActingId] = useState<string | null>(null);
  const [myOfferActingId, setMyOfferActingId] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const unseenIncomingInterestCount = useMemo(() => {
    return incomingInterests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at).length;
  }, [incomingInterests]);

  // We don't have "seen" columns on request_offers; treat pending/hold as attention-needed
  const unseenIncomingOfferCount = useMemo(() => {
    return incomingOffers.filter((o) => (o.status ?? "pending") === "pending").length;
  }, [incomingOffers]);

  const hasNewRequests = unseenIncomingInterestCount + unseenIncomingOfferCount > 0;

  // Split listings vs history (claimed)
  const activeListings = useMemo(() => {
    return myItems.filter((x) => normStatus(x.status) !== "claimed");
  }, [myItems]);

  const completedListings = useMemo(() => {
    return myItems.filter((x) => normStatus(x.status) === "claimed");
  }, [myItems]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    const uid = s?.user?.id ?? null;
    const email = s?.user?.email ?? null;
    setUserId(uid);
    setUserEmail(email);
    return { uid, email };
  }

  async function loadProfile(uid: string) {
    const { data: pData, error: pErr } = await supabase
      .from("profiles")
      .select("id,email,full_name,user_role,created_at")
      .eq("id", uid)
      .maybeSingle()
      .returns<ProfileRow>();

    if (pErr) {
      console.warn("profile load:", pErr.message);
      setProfile(null);
      return;
    }
    setProfile(pData ?? null);
  }

  async function loadMyListings(uid: string) {
    const { data: iData, error: iErr } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url,post_type")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyItemRow[]>();

    if (iErr) {
      setMyItems([]);
      setErr(iErr.message);
      return [];
    }

    const rows = iData ?? [];
    setMyItems(rows);
    return rows;
  }

  /** GIVE flow: interests I made */
  async function loadMyRequests(uid: string) {
    const { data: rData, error: rErr } = await supabase
      .from("interests")
      .select("item_id,created_at,items:items(id,title,photo_url,status,post_type)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyRequestRow[]>();

    if (rErr) {
      console.warn("my requests load:", rErr.message);
      setMyRequests([]);
      return [];
    }

    const rows = rData ?? [];
    setMyRequests(rows);
    return rows;
  }

  /** REQUEST flow: offers I made (request_offers where helper_id = me) */
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

  /**
   * Incoming GIVE interests: only interests for items YOU own.
   * 2-step query is stable.
   */
  async function loadIncomingInterests(uid: string) {
    // 1) owned item ids
    const { data: owned, error: ownedErr } = await supabase.from("items").select("id").eq("owner_id", uid);

    if (ownedErr) {
      console.warn("incoming interests: owned items load:", ownedErr.message);
      setIncomingInterests([]);
      return;
    }

    const ownedIds = (owned ?? []).map((x: any) => x.id).filter(Boolean);

    if (ownedIds.length === 0) {
      setIncomingInterests([]);
      return;
    }

    // 2) interests for those items (include interests.id + status)
    const { data: ints, error: intsErr } = await supabase
      .from("interests")
      .select("id,item_id,user_id,created_at,owner_seen_at,owner_dismissed_at,status")
      .in("item_id", ownedIds)
      .is("owner_dismissed_at", null)
      .order("created_at", { ascending: false });

    if (intsErr) {
      console.warn("incoming interests: interests load:", intsErr.message);
      setIncomingInterests([]);
      return;
    }

    const interestRows = (ints ?? []) as Array<{
      id: string;
      item_id: string;
      user_id: string;
      created_at: string | null;
      owner_seen_at: string | null;
      owner_dismissed_at: string | null;
      status: string | null;
    }>;

    if (interestRows.length === 0) {
      setIncomingInterests([]);
      return;
    }

    // 3) item details
    const uniqueItemIds = Array.from(new Set(interestRows.map((r) => r.item_id)));

    const { data: itemsData, error: itemsErr } = await supabase
      .from("items")
      .select("id,title,photo_url,status,owner_id,post_type")
      .in("id", uniqueItemIds);

    if (itemsErr) console.warn("incoming interests: items load:", itemsErr.message);

    const itemMap: Record<string, { id: string; title: string; photo_url: string | null; status: string | null; owner_id: string; post_type?: "give" | "request" | null }> =
      {};
    (itemsData ?? []).forEach((it: any) => {
      itemMap[it.id] = {
        id: String(it.id),
        title: String(it.title ?? ""),
        photo_url: it.photo_url ?? null,
        status: it.status ?? null,
        owner_id: String(it.owner_id ?? ""),
        post_type: (it.post_type ?? null) as any,
      };
    });

    // 4) requester profiles
    const uniqueUserIds = Array.from(new Set(interestRows.map((r) => r.user_id)));

    const { data: profs, error: profErr } = await supabase.from("profiles").select("id,full_name,email,user_role").in("id", uniqueUserIds);
    if (profErr) console.warn("incoming interests: profiles load:", profErr.message);

    const profMap: Record<string, { full_name: string | null; email: string | null; user_role: string | null }> = {};
    (profs ?? []).forEach((p: any) => {
      profMap[p.id] = {
        full_name: p.full_name ?? null,
        email: p.email ?? null,
        user_role: p.user_role ?? null,
      };
    });

    // 5) merge + guardrail
    const merged: IncomingInterestRow[] = interestRows
      .map((r) => {
        const it = itemMap[r.item_id] ?? null;
        const req = profMap[r.user_id] ?? null;

        return {
          id: String(r.id),
          item_id: String(r.item_id),
          user_id: String(r.user_id),
          created_at: r.created_at ?? null,
          owner_seen_at: r.owner_seen_at ?? null,
          owner_dismissed_at: r.owner_dismissed_at ?? null,
          status: r.status ?? null,
          items: it,
          requester: req,
        };
      })
      .filter((r) => r.items?.owner_id === uid);

    setIncomingInterests(merged);
  }

  /**
   * Incoming REQUEST offers: request_offers for requests YOU posted.
   * We load owned request ids (items where owner_id = me AND post_type = 'request'),
   * then fetch request_offers rows and helper profiles.
   */
  async function loadIncomingOffers(uid: string) {
    const { data: ownedReqs, error: ownedErr } = await supabase.from("items").select("id,title,status,owner_id,post_type").eq("owner_id", uid).eq("post_type", "request");

    if (ownedErr) {
      console.warn("incoming offers: owned requests load:", ownedErr.message);
      setIncomingOffers([]);
      return;
    }

    const reqIds = (ownedReqs ?? []).map((x: any) => x.id).filter(Boolean);
    if (reqIds.length === 0) {
      setIncomingOffers([]);
      return;
    }

    const reqMap: Record<string, any> = {};
    (ownedReqs ?? []).forEach((r: any) => (reqMap[String(r.id)] = r));

    const { data: offers, error: offErr } = await supabase
      .from("request_offers")
      .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
      .in("request_id", reqIds)
      .order("created_at", { ascending: false });

    if (offErr) {
      console.warn("incoming offers: offers load:", offErr.message);
      setIncomingOffers([]);
      return;
    }

    const offerRows = (offers ?? []) as Array<{
      id: string;
      request_id: string;
      helper_id: string;
      status: OfferStatus | null;
      availability: string | null;
      note: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>;

    if (offerRows.length === 0) {
      setIncomingOffers([]);
      return;
    }

    const helperIds = Array.from(new Set(offerRows.map((o) => o.helper_id)));
    const { data: helpers, error: hErr } = await supabase.from("profiles").select("id,full_name,email,user_role").in("id", helperIds);
    if (hErr) console.warn("incoming offers: helper profiles load:", hErr.message);

    const helperMap: Record<string, any> = {};
    (helpers ?? []).forEach((p: any) => {
      helperMap[String(p.id)] = { full_name: p.full_name ?? null, email: p.email ?? null, user_role: p.user_role ?? null };
    });

    const merged: IncomingOfferRow[] = offerRows
      .map((o) => {
        const reqItem = reqMap[String(o.request_id)] ?? null;
        const helper = helperMap[String(o.helper_id)] ?? null;
        return {
          id: String(o.id),
          request_id: String(o.request_id),
          helper_id: String(o.helper_id),
          status: (o.status ?? "pending") as OfferStatus,
          availability: o.availability ?? null,
          note: o.note ?? null,
          created_at: o.created_at ?? null,
          updated_at: o.updated_at ?? null,
          request_item: reqItem
            ? {
                id: String(reqItem.id),
                title: String(reqItem.title ?? ""),
                status: reqItem.status ?? null,
                owner_id: String(reqItem.owner_id ?? ""),
                post_type: (reqItem.post_type ?? null) as any,
              }
            : null,
          helper,
        };
      })
      .filter((x) => x.request_item?.owner_id === uid);

    setIncomingOffers(merged);
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
    // only for GIVE interests (we have seen columns)
    const unseen = incomingInterests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at);
    if (unseen.length === 0) return;

    const nowIso = new Date().toISOString();
    const ids = unseen.map((r) => r.id).filter(Boolean);

    await supabase.from("interests").update({ owner_seen_at: nowIso }).in("id", ids);

    setIncomingInterests((prev) =>
      prev.map((r) => {
        if (r.owner_seen_at || r.owner_dismissed_at) return r;
        return { ...r, owner_seen_at: nowIso };
      })
    );
  }

  /** Hard delete an incoming GIVE interest notification row */
  async function deleteNotification(r: IncomingInterestRow) {
    if (!confirm("Delete this request notification? This will remove the request.")) return;

    setDeletingNotifId(r.id);
    const { error } = await supabase.from("interests").delete().eq("id", r.id);
    setDeletingNotifId(null);

    if (error) return alert(error.message);

    setIncomingInterests((prev) => prev.filter((x) => x.id !== r.id));
  }

  /** REQUEST offer actions (poster only) */
  async function updateOfferStatus(o: IncomingOfferRow, next: OfferStatus) {
    setOfferActingId(o.id);
    const { error } = await supabase.from("request_offers").update({ status: next }).eq("id", o.id);
    setOfferActingId(null);
    if (error) return alert(error.message);

    setIncomingOffers((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: next } : x)));
  }

  /** Start chat with helper ONLY when accepted */
  async function startChatWithHelper(o: IncomingOfferRow) {
    if (!userId) return;
    if ((o.status ?? "pending") !== "accepted") return alert("Accept this helper first.");

    if (!o.request_item?.id) return alert("Missing request id.");
    if (!o.helper_id) return alert("Missing helper id.");

    try {
      setOfferActingId(o.id);

      // owner = request poster (you), requester = helper
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
      alert(e?.message || "Could not open chat.");
    } finally {
      setOfferActingId(null);
    }
  }

  /** My offer: withdraw ONLY if not accepted/completed */
  async function withdrawMyOffer(off: MyOfferRow) {
    const st = (off.status ?? "pending") as OfferStatus;
    if (st === "accepted" || st === "completed") {
      return alert("This offer is already accepted/completed. You can't withdraw here.");
    }

    if (!confirm("Withdraw this offer?")) return;

    setMyOfferActingId(off.id);
    const { error } = await supabase.from("request_offers").delete().eq("id", off.id);
    setMyOfferActingId(null);

    if (error) return alert(error.message);

    setMyOffers((prev) => prev.filter((x) => x.id !== off.id));
    setStats((s) => ({ ...s, offers: Math.max(0, s.offers - 1) }));
  }

  /** My offer: start chat ONLY if accepted */
  async function startChatFromMyOffer(off: MyOfferRow) {
    if (!userId) return;
    const st = (off.status ?? "pending") as OfferStatus;
    if (st !== "accepted") return alert("You can chat only after the poster accepts your offer.");

    const reqId = off.request_item?.id ?? off.request_id;
    if (!reqId) return alert("Missing request id.");

    // Need request owner id to create thread properly; fetch it.
    try {
      setMyOfferActingId(off.id);
      const { data, error } = await supabase.from("items").select("owner_id").eq("id", reqId).single();
      if (error) throw new Error(error.message);

      const ownerId = (data as any)?.owner_id ?? null;
      if (!ownerId) throw new Error("Missing request owner.");

      const threadId = await ensureThread({
        itemId: reqId,
        ownerId: ownerId,
        requesterId: userId,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Helper here. My offer was accepted — ready to finalize details.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      alert(e?.message || "Could not open chat.");
    } finally {
      setMyOfferActingId(null);
    }
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    const { uid, email } = await syncAuth();

    if (!uid || !email || !isAshlandEmail(email)) {
      setProfile(null);
      setMyItems([]);
      setMyRequests([]);
      setMyOffers([]);
      setIncomingInterests([]);
      setIncomingOffers([]);
      setStats({ listed: 0, requested: 0, offers: 0, chats: 0 });
      setLoading(false);
      return;
    }

    await loadProfile(uid);

    const [iRows, rRows, oRows] = await Promise.all([loadMyListings(uid), loadMyRequests(uid), loadMyOffers(uid)]);
    await loadIncomingAll(uid);

    const listed = iRows.length;
    const requested = rRows.length;
    const offers = oRows.length;

    let chats = 0;
    try {
      const { count, error: tErr } = await supabase.from("threads").select("id", { count: "exact", head: true }).or(`owner_id.eq.${uid},requester_id.eq.${uid}`);
      if (!tErr) chats = count ?? 0;
    } catch {
      chats = 0;
    }

    setStats({ listed, requested, offers, chats });
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setDrawerOpen(false);
    await loadAll();
  }

  async function deleteListing(id: string) {
    if (!confirm("Delete this listing? This cannot be undone.")) return;

    setDeletingId(id);
    const { error } = await supabase.from("items").delete().eq("id", id);
    setDeletingId(null);

    if (error) return alert(error.message);

    setMyItems((prev) => prev.filter((x) => x.id !== id));
    setStats((s) => ({ ...s, listed: Math.max(0, s.listed - 1) }));
  }

  async function handleAuth() {
    setAuthMsg(null);
    setErr(null);

    const email = authEmail.trim().toLowerCase();
    if (!email) return setAuthMsg("Enter your email.");
    if (!isAshlandEmail(email)) return setAuthMsg("Use your @ashland.edu email.");
    if (authPassword.length < 6) return setAuthMsg("Password must be at least 6 characters.");

    setAuthBusy(true);

    if (authMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
      setAuthBusy(false);
      if (error) return setAuthMsg(error.message);
      await loadAll();
      return;
    }

    const { error } = await supabase.auth.signUp({ email, password: authPassword });
    setAuthBusy(false);
    if (error) return setAuthMsg(error.message);

    await loadAll();
  }

  useEffect(() => {
    loadAll();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadAll();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const displayName = (profile?.full_name ?? "").trim() || (userEmail ? userEmail.split("@")[0] : "") || "Account";
  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  if (loading) {
    return <div style={pageWrap}>Loading…</div>;
  }

  /* ---------------- LOGGED OUT ---------------- */

  if (!isLoggedIn) {
    return (
      <div style={{ ...pageWrap, paddingBottom: 120 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Account</h1>
        <p style={{ opacity: 0.8, marginTop: 10 }}>
          Sign in or sign up using your <b>@ashland.edu</b> email.
        </p>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setAuthMode("signin")} style={pillBtn(authMode === "signin")}>
            Sign in
          </button>
          <button onClick={() => setAuthMode("signup")} style={pillBtn(authMode === "signup")}>
            Sign up
          </button>
        </div>

        <div style={panel}>
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>{authMode === "signin" ? "Welcome back" : "Create an account"}</div>

          <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@ashland.edu" autoComplete="email" inputMode="email" style={inputStyle} />

          <input
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            placeholder="password"
            type="password"
            autoComplete={authMode === "signin" ? "current-password" : "new-password"}
            style={{ ...inputStyle, marginTop: 10 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAuth();
            }}
          />

          <button onClick={handleAuth} disabled={authBusy} style={primaryBtn(authBusy)}>
            {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
          </button>

          {authMsg && <div style={{ marginTop: 10, color: "#fca5a5", fontWeight: 900 }}>{authMsg}</div>}

          <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>You can still browse the feed without logging in.</div>

          <button onClick={() => router.push("/feed")} style={{ ...outlineBtn, width: "100%", height: 44 }}>
            Browse feed
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- LOGGED IN ---------------- */

  return (
    <div style={{ ...pageWrap, paddingBottom: 120 }}>
      <style jsx>{`
        .header {
          position: sticky;
          top: 0;
          z-index: 50;
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid #0f223f;
          padding-bottom: 10px;
        }
        .topRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .tabs {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: 8px;
          padding-right: 56px;
        }
        .tabs::-webkit-scrollbar {
          display: none;
        }
        .reqRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .reqMain {
          flex: 1;
          min-width: 220px;
        }
        .reqActions {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-shrink: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        @media (max-width: 420px) {
          .reqActions {
            width: 100%;
          }
        }
      `}</style>

      <div className="header">
        <div className="topRow">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={avatar} title={displayName}>
              {displayName.slice(0, 1).toUpperCase()}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 1000, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
              <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {roleLabel} • {userEmail}
              </div>
            </div>
          </div>

          <button onClick={() => setDrawerOpen(true)} style={iconBtn} aria-label="Open menu" title="Menu">
            ☰
          </button>
        </div>

        {err && <div style={{ marginTop: 10, color: "#f87171", fontWeight: 900 }}>{err}</div>}

        <div className="tabs" style={{ marginTop: 10 }}>
          <button onClick={() => setTab("listings")} style={tabPill(tab === "listings")}>
            Listings
          </button>

          <button onClick={() => setTab("my_activity")} style={tabPill(tab === "my_activity")}>
            My activity
          </button>

          <button
            onClick={async () => {
              setTab("requests");
              await markIncomingSeen();
            }}
            style={tabPill(tab === "requests")}
          >
            Requests
            {hasNewRequests && <span style={dot} aria-label="New requests" title="New requests" />}
          </button>

          <button onClick={() => setTab("history")} style={tabPill(tab === "history")}>
            History
          </button>
        </div>

        {/* small stats */}
        <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", opacity: 0.78, fontSize: 12, fontWeight: 900 }}>
          <span>Listed: {stats.listed}</span>
          <span>Interests: {stats.requested}</span>
          <span>Offers: {stats.offers}</span>
          <span>Chats: {stats.chats}</span>
        </div>
      </div>

      {/* CONTENT */}

      {tab === "listings" && (
        <>
          <div style={sectionHint}>Your active posts (give + requests). Completed (claimed) posts live in History.</div>

          {activeListings.length === 0 ? (
            <EmptyBox title="No active listings." body="List something or post a request to start exchanging.">
              <button onClick={() => router.push("/create")} style={outlineBtn}>
                ＋ Create post
              </button>
            </EmptyBox>
          ) : (
            <CardRail>
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
            </CardRail>
          )}
        </>
      )}

      {tab === "my_activity" && (
        <>
          <div style={sectionHint}>Your activity across both flows.</div>

          {/* MY INTERESTS (GIVE) */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>My interests (items I requested)</div>
            <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>These are GIVE posts you requested.</div>
          </div>

          {myRequests.length === 0 ? (
            <EmptyBox title="No interests yet." body="Go to the feed and request an item.">
              <button onClick={() => router.push("/feed")} style={outlineBtn}>
                Browse feed
              </button>
            </EmptyBox>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {myRequests.map((r) => {
                const it = r.items;
                return (
                  <div key={r.item_id + (r.created_at ?? "")} style={rowCard}>
                    <Thumb photoUrl={it?.photo_url ?? null} label={it?.title ?? "Item"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={rowTitle}>{it?.title ?? "Unknown item"}</div>
                      <div style={rowMeta}>
                        Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span> • Status: <b>{it?.status ?? "—"}</b>
                      </div>
                    </div>
                    <button onClick={() => router.push(`/item/${r.item_id}`)} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* MY OFFERS (REQUEST) */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>My offers (help I offered)</div>
            <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
              These are REQUEST posts where you offered help. Chat is only available after acceptance.
            </div>
          </div>

          {myOffers.length === 0 ? (
            <EmptyBox title="No offers yet." body="Find a request post in the feed and tap “Offer help”.">
              <button onClick={() => router.push("/feed")} style={outlineBtn}>
                Browse feed
              </button>
            </EmptyBox>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {myOffers.map((o) => {
                const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                const st = (o.status ?? "pending") as OfferStatus;
                const acting = myOfferActingId === o.id;

                return (
                  <div key={o.id} style={rowCard}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={rowTitle}>
                        Offered help on <span style={{ opacity: 0.9 }}>{title}</span>
                      </div>
                      <div style={rowMeta}>
                        Request: <span style={{ fontWeight: 900 }}>{shortId(o.request_id)}</span>
                        {o.created_at ? ` • Sent: ${fmtWhen(o.created_at)}` : ""}
                        {" • "}
                        Status: <b>{st}</b>
                        {o.availability ? ` • Availability: ${o.availability}` : ""}
                      </div>
                      {o.note ? <div style={{ marginTop: 8, opacity: 0.82, fontSize: 13, whiteSpace: "pre-wrap" }}>{o.note}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button onClick={() => router.push(`/item/${o.request_id}`)} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
                        View request
                      </button>

                      <button
                        onClick={() => startChatFromMyOffer(o)}
                        disabled={acting || st !== "accepted"}
                        style={{
                          ...outlineBtn,
                          marginTop: 0,
                          border: st === "accepted" ? "1px solid rgba(22,163,74,0.55)" : "1px solid #334155",
                          background: st === "accepted" ? "rgba(22,163,74,0.14)" : "transparent",
                          cursor: acting || st !== "accepted" ? "not-allowed" : "pointer",
                          opacity: acting || st !== "accepted" ? 0.65 : 1,
                          whiteSpace: "nowrap",
                        }}
                        title={st !== "accepted" ? "Chat unlocks after acceptance" : "Chat with poster"}
                      >
                        {acting ? "Opening…" : "Start chat"}
                      </button>

                      <button
                        onClick={() => withdrawMyOffer(o)}
                        disabled={acting || st === "accepted" || st === "completed"}
                        style={{
                          ...outlineBtn,
                          marginTop: 0,
                          border: "1px solid #7f1d1d",
                          cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                          opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                          whiteSpace: "nowrap",
                        }}
                        title={st === "accepted" || st === "completed" ? "Cannot withdraw after acceptance/completion" : "Withdraw offer"}
                      >
                        {acting ? "Working…" : "Withdraw"}
                      </button>
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
          <div style={sectionHint}>Requests people sent to your GIVE listings, and offers people sent to your REQUEST posts.</div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (userId) loadIncomingAll(userId);
              }}
              disabled={incomingLoading}
              style={{
                ...outlineBtn,
                marginTop: 0,
                cursor: incomingLoading ? "not-allowed" : "pointer",
                opacity: incomingLoading ? 0.8 : 1,
              }}
            >
              {incomingLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* Section A: incoming interests (give) */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Incoming item requests (GIVE)</div>
            <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>People who requested your items.</div>
          </div>

          {incomingInterests.length === 0 ? (
            <EmptyBox title="No incoming item requests." body="When someone requests your item, it will appear here." />
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {incomingInterests.map((r) => {
                const itemTitle = r.items?.title?.trim() ? r.items.title : "Unknown item";
                const who = niceNameFromProfile(r.requester, r.user_id);
                const when = fmtWhen(r.created_at);
                const deleting = deletingNotifId === r.id;

                return (
                  <div key={r.id} style={rowCard}>
                    <div className="reqRow">
                      <Thumb photoUrl={r.items?.photo_url ?? null} label={itemTitle} />

                      <div className="reqMain">
                        <div style={rowTitle}>
                          {who} requested <span style={{ opacity: 0.9 }}>{itemTitle}</span>
                        </div>
                        <div style={rowMeta}>
                          Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span>
                          {when ? ` • Requested: ${when}` : ""}
                          {r.owner_seen_at ? " • Seen" : " • New"}
                          {r.status ? ` • ${r.status}` : ""}
                        </div>
                      </div>

                      <div className="reqActions">
                        <button onClick={() => router.push(`/manage/${r.item_id}`)} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
                          Open
                        </button>

                        <button
                          onClick={() => deleteNotification(r)}
                          disabled={deleting}
                          style={{
                            ...outlineBtn,
                            marginTop: 0,
                            border: "1px solid #7f1d1d",
                            cursor: deleting ? "not-allowed" : "pointer",
                            opacity: deleting ? 0.75 : 1,
                            whiteSpace: "nowrap",
                          }}
                          title="Delete notification"
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

          {/* Section B: incoming offers (request) */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Incoming help offers (REQUEST)</div>
            <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
              People offering to help your request posts. You can accept one, keep others on hold, or decline. Chat is only opened after acceptance.
            </div>
          </div>

          {incomingOffers.length === 0 ? (
            <EmptyBox title="No incoming offers." body="When someone offers help on your request post, it will appear here." />
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {incomingOffers.map((o) => {
                const title = o.request_item?.title?.trim() ? o.request_item.title : "Unknown request";
                const who = niceNameFromProfile(o.helper, o.helper_id);
                const when = fmtWhen(o.created_at);
                const st = (o.status ?? "pending") as OfferStatus;
                const acting = offerActingId === o.id;

                return (
                  <div key={o.id} style={rowCard}>
                    <div className="reqRow">
                      <div style={{ ...thumbWrap, width: 54, height: 54 }}>
                        🤝
                      </div>

                      <div className="reqMain">
                        <div style={rowTitle}>
                          {who} offered help on <span style={{ opacity: 0.9 }}>{title}</span>
                        </div>
                        <div style={rowMeta}>
                          Request: <span style={{ fontWeight: 900 }}>{shortId(o.request_id)}</span>
                          {when ? ` • Offered: ${when}` : ""}
                          {" • "}
                          Status: <b>{st}</b>
                          {o.availability ? ` • Availability: ${o.availability}` : ""}
                        </div>
                        {o.note ? <div style={{ marginTop: 8, opacity: 0.82, fontSize: 13, whiteSpace: "pre-wrap" }}>{o.note}</div> : null}
                      </div>

                      <div className="reqActions">
                        <button onClick={() => router.push(`/item/${o.request_id}`)} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
                          View request
                        </button>

                        <button
                          onClick={() => updateOfferStatus(o, "accepted")}
                          disabled={acting || st === "accepted" || st === "completed"}
                          style={{
                            ...outlineBtn,
                            marginTop: 0,
                            border: "1px solid rgba(22,163,74,0.55)",
                            background: "rgba(22,163,74,0.14)",
                            cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                            opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                            whiteSpace: "nowrap",
                          }}
                          title="Accept this helper"
                        >
                          {acting ? "Working…" : "Accept"}
                        </button>

                        <button
                          onClick={() => updateOfferStatus(o, "hold")}
                          disabled={acting || st === "accepted" || st === "completed"}
                          style={{
                            ...outlineBtn,
                            marginTop: 0,
                            cursor: acting || st === "accepted" || st === "completed" ? "not-allowed" : "pointer",
                            opacity: acting || st === "accepted" || st === "completed" ? 0.65 : 1,
                            whiteSpace: "nowrap",
                          }}
                          title="Put this offer on hold"
                        >
                          Hold
                        </button>

                        <button
                          onClick={() => updateOfferStatus(o, "declined")}
                          disabled={acting || st === "declined" || st === "completed"}
                          style={{
                            ...outlineBtn,
                            marginTop: 0,
                            border: "1px solid #7f1d1d",
                            cursor: acting || st === "declined" || st === "completed" ? "not-allowed" : "pointer",
                            opacity: acting || st === "declined" || st === "completed" ? 0.65 : 1,
                            whiteSpace: "nowrap",
                          }}
                          title="Decline this offer"
                        >
                          Decline
                        </button>

                        <button
                          onClick={() => startChatWithHelper(o)}
                          disabled={acting || st !== "accepted"}
                          style={{
                            ...outlineBtn,
                            marginTop: 0,
                            border: st === "accepted" ? "1px solid rgba(22,163,74,0.55)" : "1px solid #334155",
                            background: st === "accepted" ? "rgba(22,163,74,0.14)" : "transparent",
                            cursor: acting || st !== "accepted" ? "not-allowed" : "pointer",
                            opacity: acting || st !== "accepted" ? 0.65 : 1,
                            whiteSpace: "nowrap",
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
            <div style={{ fontWeight: 1000, fontSize: 20 }}>Completed listings</div>
            <div style={{ opacity: 0.75, marginTop: 6 }}>These were picked up (claimed). No actions needed.</div>
          </div>

          {completedListings.length === 0 ? (
            <EmptyBox title="No completed listings yet." body="When a pickup is marked, it will move here." />
          ) : (
            <CardRail>
              {completedListings.map((item) => (
                <ItemCard key={item.id} item={item} variant="history" />
              ))}
            </CardRail>
          )}
        </>
      )}

      {/* Drawer */}
      {drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9998 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              width: "min(360px, calc(100vw - 24px))",
              background: "#0b1730",
              border: "1px solid #0f223f",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 14, borderBottom: "1px solid #0f223f", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 1000 }}>Menu</div>
              <button onClick={() => setDrawerOpen(false)} style={smallCloseBtn}>
                ✕
              </button>
            </div>

            <div style={{ padding: 14, display: "grid", gap: 10 }}>
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

              <button onClick={signOut} style={{ ...drawerBtn, border: "1px solid #7f1d1d" }}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Components ---------------- */

function CardRail({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div style={railMobile}>{children}</div>
      <div style={gridDesktop}>{children}</div>
      <style jsx>{`
        @media (min-width: 900px) {
          div[style*="display: none"] {
            display: grid !important;
          }
        }
      `}</style>
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
          <button onClick={onEdit} style={cardBtnPrimary}>
            Edit
          </button>
          <button onClick={onManage} style={cardBtnOutline}>
            Manage
          </button>
          <button onClick={onDelete} disabled={!!deleting} style={cardBtnDanger(!!deleting)}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>Completed ✅</div>
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

function EmptyBox({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14, ...panel }}>
      <div style={{ fontWeight: 1000 }}>{title}</div>
      <div style={{ opacity: 0.8, marginTop: 6 }}>{body}</div>
      {children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </div>
  );
}

/* ---------------- Styles ---------------- */

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "black",
  color: "white",
  padding: 16,
};

const avatar: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  border: "1px solid #0f223f",
  background: "#0b1730",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 1000,
  fontSize: 16,
  flexShrink: 0,
};

const iconBtn: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const panel: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid #0f223f",
  background: "#0b1730",
  padding: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 12,
  border: "1px solid #334155",
  background: "rgba(0,0,0,0.35)",
  color: "white",
  padding: "0 12px",
  outline: "none",
  fontWeight: 700,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 12,
    width: "100%",
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(22,163,74,0.55)",
    background: disabled ? "rgba(22,163,74,0.10)" : "rgba(22,163,74,0.18)",
    color: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 1000,
  };
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    border: active ? "1px solid #16a34a" : "1px solid #334155",
    background: active ? "rgba(22,163,74,0.18)" : "transparent",
    color: "white",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
  };
}

const outlineBtn: React.CSSProperties = {
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};

function tabPill(active: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    borderRadius: 999,
    border: active ? "1px solid #16a34a" : "1px solid #334155",
    background: active ? "rgba(22,163,74,0.18)" : "transparent",
    color: "white",
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
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

const sectionHint: React.CSSProperties = {
  marginTop: 14,
  opacity: 0.78,
  fontSize: 13,
};

const railMobile: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  gap: 12,
  overflowX: "auto",
  paddingBottom: 10,
  WebkitOverflowScrolling: "touch",
};

const gridDesktop: React.CSSProperties = {
  marginTop: 12,
  display: "none",
  gap: 12,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
};

const card: React.CSSProperties = {
  background: "#0b1730",
  padding: 14,
  borderRadius: 16,
  border: "1px solid #0f223f",
  width: 280,
  flex: "0 0 auto",
};

const cardMediaWrap: React.CSSProperties = {
  width: "100%",
  height: 150,
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid #0f223f",
  background: "#020617",
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
  color: "#94a3b8",
  border: "1px dashed #334155",
  borderRadius: 14,
};

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 1000,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const cardSub: React.CSSProperties = {
  opacity: 0.78,
  marginTop: 6,
  fontSize: 13,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as any,
  overflow: "hidden",
};

const cardMeta: React.CSSProperties = {
  opacity: 0.78,
  marginTop: 10,
  fontSize: 13,
};

const cardActions: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 10,
  marginTop: 12,
};

const cardBtnPrimary: React.CSSProperties = {
  border: "1px solid #16a34a",
  background: "rgba(22,163,74,0.14)",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};

const cardBtnOutline: React.CSSProperties = {
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};

function cardBtnDanger(disabled: boolean): React.CSSProperties {
  return {
    border: "1px solid #7f1d1d",
    background: disabled ? "#7f1d1d" : "transparent",
    color: "white",
    padding: "10px 12px",
    borderRadius: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.8 : 1,
  };
}

const rowCard: React.CSSProperties = {
  border: "1px solid #0f223f",
  background: "#0b1730",
  borderRadius: 16,
  padding: 14,
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const thumbWrap: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 14,
  border: "1px solid #0f223f",
  background: "#020617",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#94a3b8",
  flexShrink: 0,
};

const rowTitle: React.CSSProperties = {
  fontWeight: 1000,
  fontSize: 16,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMeta: React.CSSProperties = {
  opacity: 0.8,
  fontSize: 12,
  marginTop: 4,
};

const smallCloseBtn: React.CSSProperties = {
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  borderRadius: 12,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 900,
};

const drawerBtn: React.CSSProperties = {
  width: "100%",
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
  textAlign: "left",
};