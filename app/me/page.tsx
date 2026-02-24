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

  // tabs (NEW)
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
        await supabase.from("interests").update({ owner_seen_at: nowIso }).eq("item_id", r.item_id).eq("user_id", r.user_id);
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

    // stats (keep your logic)
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

  const displayName = (profile?.full_name ?? "").trim() || (userEmail ? userEmail.split("@")[0] : "") || "Account";
  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  if (loading) {
    return <div style={pageWrap}>Loading…</div>;
  }

  // ---------------- LOGGED OUT VIEW ----------------
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

          <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>You can still browse the feed without logging in.</div>

          <button onClick={() => router.push("/feed")} style={{ ...outlineBtn, width: "100%", height: 44 }}>
            Browse feed
          </button>
        </div>
      </div>
    );
  }

  // ---------------- LOGGED IN VIEW ----------------
  return (
    <div style={{ ...pageWrap, paddingBottom: 120 }}>
      {/* ✅ Compact sticky header */}
      <div style={stickyHeader}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={avatar} title={displayName}>
              {displayName.slice(0, 1).toUpperCase()}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 1000, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </div>
              <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {roleLabel} • {userEmail}
              </div>
            </div>
          </div>

          <button onClick={() => setDrawerOpen(true)} style={iconBtn} aria-label="Open menu" title="Menu">
            ☰
          </button>
        </div>

              {/* Stats (fixed: action icons won't overlap on phone) */}
      <div
        style={{
          marginTop: 14,
          border: "1px solid #0f223f",
          background: "#020617",
          borderRadius: 16,
          padding: 12,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {/* Listed */}
        <div
          style={{
            borderRadius: 14,
            border: "1px solid #0f223f",
            background: "#0b1730",
            padding: 12,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 1000 }}>{stats.listed}</div>
          <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>Listed</div>
        </div>

        {/* Requested */}
        <div
          style={{
            borderRadius: 14,
            border: "1px solid #0f223f",
            background: "#0b1730",
            padding: 12,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 1000 }}>{stats.requested}</div>
          <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>Requested</div>
        </div>

        {/* Chats (+ icons) */}
        <div
          style={{
            position: "relative",
            borderRadius: 14,
            border: "1px solid #0f223f",
            background: "#0b1730",
            padding: 12,
            paddingTop: 44, // ✅ reserve space for the icon row on mobile
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          {/* Icon row pinned top-right */}
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            {/* Create (+) */}
            <button
              onClick={() => router.push("/create")}
              aria-label="List new item"
              title="List new item"
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: "1px solid rgba(22,163,74,0.55)",
                background: "rgba(22,163,74,0.14)",
                color: "white",
                cursor: "pointer",
                fontWeight: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              +
            </button>

            {/* Messages */}
            <button
              onClick={() => router.push("/messages")}
              aria-label="Open messages"
              title="Open messages"
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: "1px solid #334155",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
            >
              💬
            </button>
          </div>

          <div style={{ fontSize: 20, fontWeight: 1000 }}>{stats.chats}</div>
          <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>Chats</div>
        </div>
      </div>

        {err && <div style={{ marginTop: 10, color: "#f87171", fontWeight: 900 }}>{err}</div>}

        {/* ✅ Horizontal scroll tab bar (no stacking on phone) */}
        <div style={tabBar}>
          <button onClick={() => setTab("listings")} style={tabPill(tab === "listings")}>
            Listings
          </button>
          <button onClick={() => setTab("my_interests")} style={tabPill(tab === "my_interests")}>
            My interests
          </button>
          <button
            onClick={async () => {
              setTab("requests");
              await markIncomingSeen();
            }}
            style={tabPill(tab === "requests")}
          >
            Requests
            {unseenIncomingCount > 0 && <span style={dot} aria-label="New requests" title="New requests" />}
          </button>
          <button onClick={() => setTab("history")} style={tabPill(tab === "history")}>
            History
          </button>
        </div>
      </div>

      {/* CONTENT */}
      {tab === "listings" && (
        <>
          <div style={sectionHint}>Active listings only (not picked up).</div>

          {activeListings.length === 0 ? (
            <EmptyBox title="No active listings." body="List something to start exchanging.">
              <button onClick={() => router.push("/create")} style={outlineBtn}>
                ＋ Create listing
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

      {tab === "my_interests" && (
        <>
          <div style={sectionHint}>Items you requested.</div>

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
        </>
      )}

      {tab === "requests" && (
        <>
          <div style={sectionHint}>Requests people sent to your listings.</div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (userId) loadIncomingRequests(userId);
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

          {incomingRequests.length === 0 ? (
            <EmptyBox title="No incoming requests." body="If you KNOW requests exist but this is empty, it’s likely RLS blocking owners from reading interests." />
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {incomingRequests.map((r) => {
                const key = `${r.item_id}:${r.user_id}`;
                const itemTitle = r.items?.title ?? "Unknown item";
                const who = niceName(r);
                const when = fmtWhen(r.created_at);

                return (
                  <div key={key} style={rowCard}>
                    <Thumb photoUrl={r.items?.photo_url ?? null} label={itemTitle} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={rowTitle}>
                        {who} requested <span style={{ opacity: 0.9 }}>{itemTitle}</span>
                      </div>
                      <div style={rowMeta}>
                        Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span>
                        {when ? ` • Requested: ${when}` : ""}
                        {r.owner_seen_at ? " • Seen" : " • New"}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <button onClick={() => router.push(`/manage/${r.item_id}`)} style={{ ...outlineBtn, marginTop: 0, whiteSpace: "nowrap" }}>
                        Open
                      </button>

                      <button
                        onClick={() => dismissIncoming(r)}
                        disabled={dismissingKey === key}
                        style={{
                          ...outlineBtn,
                          marginTop: 0,
                          border: "1px solid #7f1d1d",
                          cursor: dismissingKey === key ? "not-allowed" : "pointer",
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

              {/* ✅ NEW: My pickups lives here (new page route) */}
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

/* ---------------- UI helpers/components ---------------- */

function CardRail({ children }: { children: React.ReactNode }) {
  // Phone: horizontal scroll rail
  // Desktop: grid
  return (
    <div>
      <div style={railMobile}>{children}</div>
      <div style={gridDesktop}>{children}</div>
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

  return (
    <div style={card}>
      <div style={cardMediaWrap}>
        {item.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo_url} alt={item.title} style={cardImg} />
        ) : (
          <div style={noPhoto}>No photo</div>
        )}
      </div>

      <div style={{ marginTop: 10, minHeight: 44 }}>
        <div style={cardTitle}>{item.title}</div>
        <div style={cardSub}>{item.description ? item.description : "—"}</div>
      </div>

      <div style={cardMeta}>
        Status: <b>{status}</b>
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
        // ✅ history: no actions
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

const stickyHeader: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  background: "rgba(0,0,0,0.90)",
  backdropFilter: "blur(8px)",
  paddingBottom: 12,
  borderBottom: "1px solid #0f223f",
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

const statsRow: React.CSSProperties = {
  marginTop: 10,
  border: "1px solid #0f223f",
  background: "#020617",
  borderRadius: 16,
  padding: 10,
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 8,
};

const statTile: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid #0f223f",
  background: "#0b1730",
  padding: 10,
  textAlign: "center",
  position: "relative",
  minHeight: 64,
};

const statValue: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 1000,
};

const statLabel: React.CSSProperties = {
  opacity: 0.8,
  fontSize: 12,
  marginTop: 4,
};

const statActions: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: 8,
  display: "flex",
  gap: 6,
};

const miniIconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 10,
  border: "1px solid #334155",
  background: "rgba(22,163,74,0.12)",
  color: "white",
  cursor: "pointer",
  fontWeight: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const tabBar: React.CSSProperties = {
  marginTop: 10,
  display: "flex",
  gap: 10,
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  paddingBottom: 6,
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

/**
 * Desktop-only grid: we can enable it via a tiny media query trick:
 * You can remove this if you later move to CSS/Tailwind.
 */
if (typeof window !== "undefined") {
  const w = window.innerWidth;
  // NOTE: we keep it simple: show grid on wider screens
  // (React inline styles can't do media queries cleanly)
}