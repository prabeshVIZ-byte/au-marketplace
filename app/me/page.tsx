"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
};

type MyRequestRow = {
  item_id: string;
  created_at?: string | null;
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
  } | null;
};

/**
 * Incoming requests for YOUR items (someone clicked "Request item" on your listing).
 * Backed by interests table, joined to items and requester profile.
 *
 * Requires interests.owner_seen_at and interests.owner_dismissed_at (nullable timestamptz).
 */
type IncomingRequestRow = {
  item_id: string;
  user_id: string;
  created_at: string | null;
  owner_seen_at: string | null;
  owner_dismissed_at: string | null;
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
    owner_id: string;
  } | null;
  requester: {
    full_name: string | null;
    email: string | null;
    user_role: string | null;
  } | null;
};

function shortId(id: string) {
  if (!id) return "";
  return id.slice(0, 6) + "…" + id.slice(-4);
}

function isAshlandEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@ashland.edu");
}

function niceName(r: IncomingRequestRow) {
  const name = (r.requester?.full_name ?? "").trim();
  if (name) return name;
  const email = (r.requester?.email ?? "").trim();
  if (email) return email.split("@")[0];
  return "Someone";
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function AccountPage() {
  const router = useRouter();

  // page state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // logged-out auth UI (email+password)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  // data state
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  // tabs: listings | my_requests | incoming
  const [tab, setTab] = useState<"listings" | "my_requests" | "incoming">("listings");

  const [myItems, setMyItems] = useState<MyItemRow[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]);

  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([]);
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);

  const [stats, setStats] = useState<{ listed: number; requested: number; chats: number }>({
    listed: 0,
    requested: 0,
    chats: 0,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const unseenIncomingCount = useMemo(() => {
    // unseen = owner_seen_at is null AND not dismissed
    return incomingRequests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at).length;
  }, [incomingRequests]);

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
      .select("id,title,description,status,created_at,photo_url")
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

  async function loadMyRequests(uid: string) {
    const { data: rData, error: rErr } = await supabase
      .from("interests")
      .select("item_id,created_at,items:items(id,title,photo_url,status)")
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

  // ✅ Option A typing fix: .returns<IncomingRequestRow[]>()
  async function loadIncomingRequests(uid: string) {
    setIncomingLoading(true);

    const { data, error } = await supabase
      .from("interests")
      .select(
        `
        item_id,
        user_id,
        created_at,
        owner_seen_at,
        owner_dismissed_at,
        items:items!inner(id,title,photo_url,status,owner_id),
        requester:profiles(full_name,email,user_role)
      `
      )
      // only requests on items you own
      .eq("items.owner_id", uid)
      // hide dismissed rows
      .is("owner_dismissed_at", null)
      .order("created_at", { ascending: false })
      .returns<IncomingRequestRow[]>();

    if (error) {
      console.warn("incoming requests load:", error.message);
      setIncomingRequests([]);
      setIncomingLoading(false);
      return;
    }

    setIncomingRequests(data ?? []);
    setIncomingLoading(false);
  }

  async function markIncomingSeen() {
    // mark all unseen incoming as seen
    const unseen = incomingRequests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at);
    if (unseen.length === 0) return;

    const nowIso = new Date().toISOString();

    await Promise.all(
      unseen.map(async (r) => {
        await supabase
          .from("interests")
          .update({ owner_seen_at: nowIso })
          .eq("item_id", r.item_id)
          .eq("user_id", r.user_id);
      })
    );

    setIncomingRequests((prev) =>
      prev.map((r) => {
        if (r.owner_seen_at || r.owner_dismissed_at) return r;
        return { ...r, owner_seen_at: nowIso };
      })
    );
  }

  async function dismissIncoming(r: IncomingRequestRow) {
    const key = `${r.item_id}:${r.user_id}`;
    setDismissingKey(key);

    const { error } = await supabase
      .from("interests")
      .update({ owner_dismissed_at: new Date().toISOString() })
      .eq("item_id", r.item_id)
      .eq("user_id", r.user_id);

    setDismissingKey(null);

    if (error) return alert(error.message);

    // remove from UI
    setIncomingRequests((prev) => prev.filter((x) => !(x.item_id === r.item_id && x.user_id === r.user_id)));
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    const { uid, email } = await syncAuth();

    if (!uid || !email || !isAshlandEmail(email)) {
      // logged out: reset data but keep auth UI
      setProfile(null);
      setMyItems([]);
      setMyRequests([]);
      setIncomingRequests([]);
      setStats({ listed: 0, requested: 0, chats: 0 });
      setLoading(false);
      return;
    }

    await loadProfile(uid);

    const [iRows, rRows] = await Promise.all([loadMyListings(uid), loadMyRequests(uid)]);
    await loadIncomingRequests(uid);

    const listed = iRows.length;
    const requested = rRows.length;

    // chats: best-effort
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

    setStats({ listed, requested, chats });
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setDrawerOpen(false);
    // keep you on /me; loadAll will switch UI
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

      // session exists now → load dashboard data
      await loadAll();
      router.push("/me");
      return;
    }

    // signup
    const { error } = await supabase.auth.signUp({ email, password: authPassword });
    setAuthBusy(false);

    if (error) return setAuthMsg(error.message);

    // If confirmations are OFF, session will exist immediately.
    // If confirmations are ON, you won't be logged in yet.
    await loadAll();
    router.push("/me");
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

  const displayName =
    (profile?.full_name ?? "").trim() ||
    (userEmail ? userEmail.split("@")[0] : "") ||
    "Account";

  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Loading…
      </div>
    );
  }

  // ============================
  // LOGGED OUT VIEW (FIXED)
  // ============================
  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Account</h1>
        <p style={{ opacity: 0.8, marginTop: 10 }}>
          Sign in or sign up using your <b>@ashland.edu</b> email.
        </p>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setAuthMode("signin")}
            style={{
              borderRadius: 999,
              border: authMode === "signin" ? "1px solid #16a34a" : "1px solid #334155",
              background: authMode === "signin" ? "rgba(22,163,74,0.18)" : "transparent",
              color: "white",
              padding: "10px 12px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Sign in
          </button>

          <button
            onClick={() => setAuthMode("signup")}
            style={{
              borderRadius: 999,
              border: authMode === "signup" ? "1px solid #16a34a" : "1px solid #334155",
              background: authMode === "signup" ? "rgba(22,163,74,0.18)" : "transparent",
              color: "white",
              padding: "10px 12px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Sign up
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            borderRadius: 16,
            border: "1px solid #0f223f",
            background: "#0b1730",
            padding: 14,
            maxWidth: 520,
          }}
        >
          <div style={{ fontWeight: 1000, marginBottom: 10 }}>
            {authMode === "signin" ? "Welcome back" : "Create an account"}
          </div>

          <input
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            placeholder="you@ashland.edu"
            autoComplete="email"
            inputMode="email"
            style={{
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "1px solid #334155",
              background: "rgba(0,0,0,0.35)",
              color: "white",
              padding: "0 12px",
              outline: "none",
              fontWeight: 700,
            }}
          />

          <input
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            placeholder="password"
            type="password"
            autoComplete={authMode === "signin" ? "current-password" : "new-password"}
            style={{
              marginTop: 10,
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "1px solid #334155",
              background: "rgba(0,0,0,0.35)",
              color: "white",
              padding: "0 12px",
              outline: "none",
              fontWeight: 700,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAuth();
            }}
          />

          <button
            onClick={handleAuth}
            disabled={authBusy}
            style={{
              marginTop: 12,
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "1px solid rgba(22,163,74,0.55)",
              background: authBusy ? "rgba(22,163,74,0.10)" : "rgba(22,163,74,0.18)",
              color: "white",
              cursor: authBusy ? "not-allowed" : "pointer",
              fontWeight: 1000,
            }}
          >
            {authBusy ? "Working…" : authMode === "signin" ? "Sign in" : "Sign up"}
          </button>

          {authMsg && <div style={{ marginTop: 10, color: "#fca5a5", fontWeight: 900 }}>{authMsg}</div>}

          <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
            You can still browse the feed without logging in.
          </div>

          <button
            onClick={() => router.push("/feed")}
            style={{
              marginTop: 10,
              width: "100%",
              height: 44,
              borderRadius: 12,
              border: "1px solid #334155",
              background: "transparent",
              color: "white",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Browse feed
          </button>
        </div>
      </div>
    );
  }

  // ============================
  // LOGGED IN VIEW
  // ============================
  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              border: "1px solid #0f223f",
              background: "#0b1730",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 1000,
              fontSize: 18,
            }}
            title={displayName}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </div>

          <div>
            <div style={{ fontSize: 22, fontWeight: 1000, lineHeight: 1.1 }}>{displayName}</div>
            <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>
              {roleLabel} • <span style={{ opacity: 0.9 }}>{userEmail}</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            cursor: "pointer",
            fontWeight: 900,
          }}
          aria-label="Open menu"
          title="Menu"
        >
          ☰
        </button>
      </div>

      {/* Stats */}
      <div
        style={{
          marginTop: 14,
          border: "1px solid #0f223f",
          background: "#020617",
          borderRadius: 16,
          padding: 14,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {[
          { label: "Listed", value: stats.listed },
          { label: "Requested", value: stats.requested },
          { label: "Chats", value: stats.chats },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              borderRadius: 14,
              border: "1px solid #0f223f",
              background: "#0b1730",
              padding: 12,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 1000 }}>{s.value}</div>
            <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <Link
          href="/create"
          style={{
            border: "1px solid #16a34a",
            background: "rgba(22,163,74,0.14)",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          + List new item
        </Link>

        <Link
          href="/messages"
          style={{
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          Open messages
        </Link>
      </div>

      {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}

      {/* Tabs */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setTab("listings")}
          style={{
            borderRadius: 999,
            border: tab === "listings" ? "1px solid #16a34a" : "1px solid #334155",
            background: tab === "listings" ? "rgba(22,163,74,0.18)" : "transparent",
            color: "white",
            padding: "10px 12px",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Listings
        </button>

        <button
          onClick={() => setTab("my_requests")}
          style={{
            borderRadius: 999,
            border: tab === "my_requests" ? "1px solid #16a34a" : "1px solid #334155",
            background: tab === "my_requests" ? "rgba(22,163,74,0.18)" : "transparent",
            color: "white",
            padding: "10px 12px",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          My requests
        </button>

        <button
          onClick={async () => {
            setTab("incoming");
            await markIncomingSeen(); // mark seen when opened
          }}
          style={{
            borderRadius: 999,
            border: tab === "incoming" ? "1px solid #16a34a" : "1px solid #334155",
            background: tab === "incoming" ? "rgba(22,163,74,0.18)" : "transparent",
            color: "white",
            padding: "10px 12px",
            cursor: "pointer",
            fontWeight: 900,
            position: "relative",
          }}
        >
          Requests for your items
          {unseenIncomingCount > 0 && (
            <span
              style={{
                display: "inline-block",
                width: 9,
                height: 9,
                borderRadius: 999,
                background: "#ef4444",
                marginLeft: 8,
                boxShadow: "0 0 0 3px rgba(239,68,68,0.20)",
              }}
              aria-label="New requests"
              title="New requests"
            />
          )}
        </button>
      </div>

      {/* LISTINGS */}
      {tab === "listings" && (
        <>
          <div style={{ marginTop: 14, opacity: 0.85 }}>
            Your listings are public in the feed. Use <b>Edit</b> to manage requests / status.
          </div>

          {myItems.length === 0 ? (
            <div style={{ marginTop: 14, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
              <div style={{ fontWeight: 1000 }}>No listings yet.</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>Create your first listing to start exchanging items.</div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              {myItems.map((item) => (
                <div key={item.id} style={{ background: "#0b1730", padding: 14, borderRadius: 16, border: "1px solid #0f223f" }}>
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photo_url}
                      alt={item.title}
                      style={{
                        width: "100%",
                        height: 160,
                        objectFit: "cover",
                        borderRadius: 14,
                        border: "1px solid #0f223f",
                        marginBottom: 10,
                        display: "block",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 160,
                        borderRadius: 14,
                        border: "1px dashed #334155",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#94a3b8",
                        marginBottom: 10,
                      }}
                    >
                      No photo
                    </div>
                  )}

                  <div style={{ fontSize: 18, fontWeight: 1000 }}>{item.title}</div>
                  <div style={{ opacity: 0.78, marginTop: 6, fontSize: 13 }}>{item.description ? item.description : "—"}</div>

                  <div style={{ opacity: 0.78, marginTop: 10, fontSize: 13 }}>
                    Status: <b>{item.status ?? "—"}</b>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                      onClick={() => router.push(`/manage/${item.id}`)}
                      style={{
                        flex: 1,
                        border: "1px solid #334155",
                        background: "transparent",
                        color: "white",
                        padding: "10px 12px",
                        borderRadius: 12,
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      Edit
                    </button>

                    <button
                      onClick={() => deleteListing(item.id)}
                      disabled={deletingId === item.id}
                      style={{
                        flex: 1,
                        border: "1px solid #7f1d1d",
                        background: deletingId === item.id ? "#7f1d1d" : "transparent",
                        color: "white",
                        padding: "10px 12px",
                        borderRadius: 12,
                        cursor: deletingId === item.id ? "not-allowed" : "pointer",
                        fontWeight: 900,
                        opacity: deletingId === item.id ? 0.8 : 1,
                      }}
                    >
                      {deletingId === item.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* MY REQUESTS */}
      {tab === "my_requests" && (
        <>
          <div style={{ marginTop: 14, opacity: 0.85 }}>These are items you requested (your “Request Item” clicks).</div>

          {myRequests.length === 0 ? (
            <div style={{ marginTop: 14, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
              <div style={{ fontWeight: 1000 }}>No requests yet.</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>Go to the feed and request an item to start a request.</div>
              <button
                onClick={() => router.push("/feed")}
                style={{
                  marginTop: 12,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Browse feed
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {myRequests.map((r) => {
                const it = r.items;
                return (
                  <div
                    key={r.item_id + (r.created_at ?? "")}
                    style={{
                      border: "1px solid #0f223f",
                      background: "#0b1730",
                      borderRadius: 16,
                      padding: 14,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
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
                      }}
                    >
                      {it?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.photo_url} alt={it.title ?? "Item"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        "—"
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it?.title ?? "Unknown item"}
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>
                        Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span> • Status: <b>{it?.status ?? "—"}</b>
                      </div>
                    </div>

                    <button
                      onClick={() => router.push(`/item/${r.item_id}`)}
                      style={{
                        border: "1px solid #334155",
                        background: "transparent",
                        color: "white",
                        padding: "10px 12px",
                        borderRadius: 12,
                        cursor: "pointer",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* INCOMING REQUESTS */}
      {tab === "incoming" && (
        <>
          <div style={{ marginTop: 14, opacity: 0.85 }}>
            These are requests people sent to <b>your</b> listings.
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (userId) loadIncomingRequests(userId);
              }}
              disabled={incomingLoading}
              style={{
                border: "1px solid #334155",
                background: "transparent",
                color: "white",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: incomingLoading ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: incomingLoading ? 0.8 : 1,
              }}
            >
              {incomingLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {incomingRequests.length === 0 ? (
            <div style={{ marginTop: 14, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
              <div style={{ fontWeight: 1000 }}>No incoming requests.</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>When someone requests your item, it will show up here.</div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {incomingRequests.map((r) => {
                const key = `${r.item_id}:${r.user_id}`;
                const itemTitle = r.items?.title ?? "Unknown item";
                const who = niceName(r);
                const when = fmtWhen(r.created_at);

                return (
                  <div
                    key={key}
                    style={{
                      border: "1px solid #0f223f",
                      background: "#0b1730",
                      borderRadius: 16,
                      padding: 14,
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
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
                      }}
                    >
                      {r.items?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.items.photo_url} alt={itemTitle} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        "—"
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {who} requested <span style={{ opacity: 0.9 }}>{itemTitle}</span>
                      </div>

                      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>
                        Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span>
                        {when ? ` • Requested: ${when}` : ""}
                        {r.owner_seen_at ? " • Seen" : " • New"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <button
                        onClick={() => router.push(`/manage/${r.item_id}`)}
                        style={{
                          border: "1px solid #334155",
                          background: "transparent",
                          color: "white",
                          padding: "10px 12px",
                          borderRadius: 12,
                          cursor: "pointer",
                          fontWeight: 900,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Open
                      </button>

                      <button
                        onClick={() => dismissIncoming(r)}
                        disabled={dismissingKey === key}
                        style={{
                          border: "1px solid #7f1d1d",
                          background: "transparent",
                          color: "white",
                          padding: "10px 12px",
                          borderRadius: 12,
                          cursor: dismissingKey === key ? "not-allowed" : "pointer",
                          fontWeight: 900,
                          opacity: dismissingKey === key ? 0.75 : 1,
                          whiteSpace: "nowrap",
                        }}
                        title="Dismiss notification"
                      >
                        {dismissingKey === key ? "…" : "Dismiss"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
              <button
                onClick={() => setDrawerOpen(false)}
                style={{
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "white",
                  borderRadius: 12,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 14, display: "grid", gap: 10 }}>
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  router.push("/messages");
                }}
                style={{
                  width: "100%",
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                Messages
              </button>

              <button
                onClick={signOut}
                style={{
                  width: "100%",
                  border: "1px solid #7f1d1d",
                  background: "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}