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
  status: string | null; // available | reserved | claimed
  created_at: string;
  photo_url: string | null;
};

type MyRequestRow = {
  item_id: string;
  created_at?: string | null;
  status: string | null; // ✅ from interests.status
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
  } | null;
};

/**
 * Incoming requests for YOUR items.
 * NOTE: This requires RLS policies that allow item owners to SELECT interests for their items.
 * Optional: owner_seen_at and owner_dismissed_at columns (nullable timestamptz)
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
  return `User ${shortId(r.user_id)}`;
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

  // ✅ NEW TABS
  const [tab, setTab] = useState<"listings" | "my_interests" | "requests" | "history">("listings");

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
    return incomingRequests.filter((r) => !r.owner_seen_at && !r.owner_dismissed_at).length;
  }, [incomingRequests]);

  // ✅ Derived buckets
  const activeListings = useMemo(() => myItems.filter((x) => normStatus(x.status) !== "claimed"), [myItems]);
  const claimedListings = useMemo(() => myItems.filter((x) => normStatus(x.status) === "claimed"), [myItems]);

  const pickups = useMemo(() => {
    // “My pickups” = interests where buyer confirmed -> usually "reserved"
    // also include "accepted" as “awaiting your confirm” so it shows somewhere useful
    return myRequests.filter((r) => {
      const st = normStatus(r.status);
      return st === "reserved" || st === "accepted";
    });
  }, [myRequests]);

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
    // ✅ include interests.status so we can classify (pickups in drawer + better UI)
    const { data: rData, error: rErr } = await supabase
      .from("interests")
      .select("item_id,created_at,status,items:items(id,title,photo_url,status)")
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
      .eq("items.owner_id", uid)
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

    // stats (keep your logic; you can change later if you want “active only”)
    const listed = iRows.length;
    const requested = rRows.length;

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

  const displayName =
    (profile?.full_name ?? "").trim() || (userEmail ? userEmail.split("@")[0] : "") || "Account";
  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Loading…</div>;
  }

  // ---------------- LOGGED OUT VIEW ----------------
  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Account</h1>
        <p style={{ opacity: 0.8, marginTop: 10 }}>
          Sign in or sign up using your <b>@ashland.edu</b> email.
        </p>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setAuthMode("signin")} style={tabBtn(authMode === "signin")}>
            Sign in
          </button>
          <button onClick={() => setAuthMode("signup")} style={tabBtn(authMode === "signup")}>
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
            style={inputStyle}
          />

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

          <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
            You can still browse the feed without logging in.
          </div>

          <button onClick={() => router.push("/feed")} style={{ ...outlineBtn, width: "100%", height: 44 }}>
            Browse feed
          </button>
        </div>
      </div>
    );
  }

  // ---------------- LOGGED IN VIEW ----------------
  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", paddingBottom: 120 }}>
      {/* ✅ Sticky Profile Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "black",
          padding: 24,
          borderBottom: "1px solid #0f223f",
        }}
      >
        {/* Header row */}
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

        {/* Tabs */}
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setTab("listings")} style={tabBtn(tab === "listings")}>
            Listings
          </button>

          <button onClick={() => setTab("my_interests")} style={tabBtn(tab === "my_interests")}>
            My interests
          </button>

          <button
            onClick={async () => {
              setTab("requests");
              await markIncomingSeen();
            }}
            style={{ ...tabBtn(tab === "requests"), position: "relative" }}
          >
            Requests
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

          <button onClick={() => setTab("history")} style={tabBtn(tab === "history")}>
            History
          </button>
        </div>

        {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}
      </div>

      {/* ✅ Body */}
      <div style={{ padding: 24 }}>
        {/* LISTINGS (ACTIVE ONLY) */}
        {tab === "listings" && (
          <>
            <div style={{ opacity: 0.85 }}>
              Active listings only. Completed (picked up) listings are in <b>History</b>.
            </div>

            {activeListings.length === 0 ? (
              <EmptyCard
                title="No active listings."
                body="Create your next listing to start exchanging items."
                ctaLabel="+ List new item"
                onCta={() => router.push("/create")}
              />
            ) : (
              <SectionSlider
                title="Active listings"
                subtitle="Edit details, Manage requests."
                items={activeListings}
                onEdit={(id) => router.push(`/item/${id}/edit`)}
                onManage={(id) => router.push(`/manage/${id}`)}
                onDelete={(id) => deleteListing(id)}
                deletingId={deletingId}
              />
            )}
          </>
        )}

        {/* MY INTERESTS (your outgoing requests) */}
        {tab === "my_interests" && (
          <>
            <div style={{ opacity: 0.85 }}>These are items you requested (your interests).</div>

            {myRequests.length === 0 ? (
              <EmptyCard
                title="No interests yet."
                body="Go to the feed and request an item."
                ctaLabel="Browse feed"
                onCta={() => router.push("/feed")}
              />
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {myRequests.map((r) => {
                  const it = r.items;
                  const st = normStatus(r.status);

                  return (
                    <MiniRowCard
                      key={r.item_id + (r.created_at ?? "")}
                      photo={it?.photo_url ?? null}
                      title={it?.title ?? "Unknown item"}
                      meta={`Interest: ${st || "—"} • Item status: ${it?.status ?? "—"} • ${shortId(r.item_id)}`}
                      primaryLabel="View"
                      onPrimary={() => router.push(`/item/${r.item_id}`)}
                      secondaryLabel={st === "accepted" ? "Open chat" : undefined}
                      onSecondary={
                        st === "accepted"
                          ? () => router.push("/messages")
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* REQUESTS (incoming requests on your items) */}
        {tab === "requests" && (
          <>
            <div style={{ opacity: 0.85 }}>
              These are people requesting <b>your</b> items.
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (userId) loadIncomingRequests(userId);
                }}
                disabled={incomingLoading}
                style={{
                  ...outlineBtn,
                  cursor: incomingLoading ? "not-allowed" : "pointer",
                  opacity: incomingLoading ? 0.8 : 1,
                }}
              >
                {incomingLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {incomingRequests.length === 0 ? (
              <EmptyCard
                title="No incoming requests."
                body="If you KNOW requests exist but this is empty, your RLS policy may be blocking owners from reading interests."
              />
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {incomingRequests.map((r) => {
                  const key = `${r.item_id}:${r.user_id}`;
                  const itemTitle = r.items?.title ?? "Unknown item";
                  const who = niceName(r);
                  const when = fmtWhen(r.created_at);

                  return (
                    <MiniRowCard
                      key={key}
                      photo={r.items?.photo_url ?? null}
                      title={`${who} requested ${itemTitle}`}
                      meta={`Item: ${shortId(r.item_id)}${when ? ` • Requested: ${when}` : ""}${r.owner_seen_at ? " • Seen" : " • New"}`}
                      primaryLabel="Open"
                      onPrimary={() => router.push(`/manage/${r.item_id}`)}
                      secondaryLabel="Dismiss"
                      onSecondary={() => dismissIncoming(r)}
                      secondaryDisabled={dismissingKey === key}
                      secondaryDanger
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* HISTORY (claimed listings only) */}
        {tab === "history" && (
          <>
            <div style={{ opacity: 0.85 }}>
              Completed listings (picked up / claimed).
            </div>

            {claimedListings.length === 0 ? (
              <EmptyCard
                title="No history yet."
                body="Once a listing is marked picked up (claimed), it will appear here."
              />
            ) : (
              <SectionSlider
                title="Completed listings"
                subtitle="These were picked up (claimed)."
                items={claimedListings}
                onEdit={(id) => router.push(`/item/${id}/edit`)}
                onManage={(id) => router.push(`/manage/${id}`)}
                onDelete={(id) => deleteListing(id)}
                deletingId={deletingId}
                // history: still allow manage/edit if you want; if not, we can disable
              />
            )}
          </>
        )}
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9998 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              width: "min(380px, calc(100vw - 24px))",
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

            <div style={{ padding: 14, display: "grid", gap: 12 }}>
              {/* ✅ My pickups section (your requirement) */}
              <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 12, background: "#020617" }}>
                <div style={{ fontWeight: 1000 }}>My pickups</div>
                <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                  Items you’re scheduled to pick up (accepted/reserved).
                </div>

                {pickups.length === 0 ? (
                  <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>No pickups yet.</div>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {pickups.map((r) => (
                      <button
                        key={r.item_id + (r.created_at ?? "")}
                        onClick={() => router.push(`/item/${r.item_id}`)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid #334155",
                          background: "transparent",
                          color: "white",
                          padding: "10px 10px",
                          borderRadius: 12,
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 1000, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.items?.title ?? "Item"}
                        </div>
                        <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                          Interest: <b>{normStatus(r.status) || "—"}</b> • {shortId(r.item_id)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setDrawerOpen(false);
                  router.push("/messages");
                }}
                style={drawerBtn}
              >
                Messages
              </button>

              <button onClick={signOut} style={{ ...drawerBtn, border: "1px solid #7f1d1d" }}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ CSS for Desktop Slider vs Mobile Stack */}
      <style jsx global>{`
        .ss-section-title { margin-top: 14px; font-size: 16px; font-weight: 1000; }
        .ss-section-sub { margin-top: 6px; opacity: 0.75; font-size: 13px; }

        /* Desktop: horizontal slider */
        .ss-slider {
          margin-top: 12px;
          display: flex;
          gap: 14px;
          overflow-x: auto;
          padding-bottom: 10px;
          scroll-snap-type: x mandatory;
        }
        .ss-card {
          scroll-snap-align: start;
          min-width: 280px;
          max-width: 320px;
        }

        /* Mobile: stack */
        @media (max-width: 640px) {
          .ss-slider {
            display: grid;
            grid-template-columns: 1fr;
            overflow: visible;
          }
          .ss-card {
            min-width: 100%;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

/* ---------------- UI components (same file, no external deps) ---------------- */

function SectionSlider(props: {
  title: string;
  subtitle?: string;
  items: MyItemRow[];
  onEdit: (id: string) => void;
  onManage: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const { title, subtitle, items, onEdit, onManage, onDelete, deletingId } = props;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="ss-section-title">{title}</div>
      {subtitle ? <div className="ss-section-sub">{subtitle}</div> : null}

      <div className="ss-slider">
        {items.map((item) => (
          <div
            key={item.id}
            className="ss-card"
            style={{
              background: "#0b1730",
              padding: 14,
              borderRadius: 16,
              border: "1px solid #0f223f",
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Thumb photoUrl={item.photo_url} title={item.title} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 1000, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.title}
                </div>
                <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                  Status: <b>{item.status ?? "—"}</b>
                </div>
              </div>
            </div>

            <div style={{ opacity: 0.78, marginTop: 10, fontSize: 13, lineHeight: 1.35 }}>
              {item.description ? item.description : "—"}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => onEdit(item.id)} style={miniPrimaryBtn}>
                Edit
              </button>
              <button onClick={() => onManage(item.id)} style={miniOutlineBtn}>
                Manage
              </button>
              <button
                onClick={() => onDelete(item.id)}
                disabled={deletingId === item.id}
                style={{
                  ...miniOutlineBtn,
                  border: "1px solid #7f1d1d",
                  opacity: deletingId === item.id ? 0.7 : 1,
                  cursor: deletingId === item.id ? "not-allowed" : "pointer",
                }}
              >
                {deletingId === item.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniRowCard(props: {
  photo: string | null;
  title: string;
  meta: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
  secondaryDanger?: boolean;
}) {
  const { photo, title, meta, primaryLabel, onPrimary, secondaryLabel, onSecondary, secondaryDisabled, secondaryDanger } = props;

  return (
    <div
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
      <div style={{ width: 54, height: 54, borderRadius: 14, border: "1px solid #0f223f", background: "#020617", overflow: "hidden", flexShrink: 0 }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>—</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>{meta}</div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={onPrimary} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
          {primaryLabel}
        </button>

        {secondaryLabel && onSecondary ? (
          <button
            onClick={onSecondary}
            disabled={!!secondaryDisabled}
            style={{
              ...outlineBtn,
              marginTop: 0,
              whiteSpace: "nowrap",
              border: secondaryDanger ? "1px solid #7f1d1d" : "1px solid #334155",
              opacity: secondaryDisabled ? 0.7 : 1,
              cursor: secondaryDisabled ? "not-allowed" : "pointer",
            }}
          >
            {secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyCard(props: { title: string; body: string; ctaLabel?: string; onCta?: () => void }) {
  const { title, body, ctaLabel, onCta } = props;
  return (
    <div style={{ marginTop: 14, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
      <div style={{ fontWeight: 1000 }}>{title}</div>
      <div style={{ opacity: 0.8, marginTop: 6 }}>{body}</div>
      {ctaLabel && onCta ? (
        <button onClick={onCta} style={outlineBtn}>
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

function Thumb({ photoUrl, title }: { photoUrl: string | null; title: string }) {
  if (!photoUrl) {
    return (
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 14,
          border: "1px dashed #334155",
          background: "rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          flexShrink: 0,
          fontWeight: 900,
        }}
      >
        —
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt={title}
      style={{
        width: 58,
        height: 58,
        objectFit: "cover",
        borderRadius: 14,
        border: "1px solid #0f223f",
        flexShrink: 0,
        display: "block",
      }}
    />
  );
}

/* ---------------- styles ---------------- */

function tabBtn(active: boolean): React.CSSProperties {
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
  marginTop: 12,
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
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

const miniPrimaryBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 90,
  border: "1px solid #16a34a",
  background: "rgba(22,163,74,0.14)",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};

const miniOutlineBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 90,
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};