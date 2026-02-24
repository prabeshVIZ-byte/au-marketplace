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
  user_role: string | null; // "student" | "faculty" etc
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

function formatWhen(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [tab, setTab] = useState<"listings" | "my_requests" | "requests_for_you">("listings");

  const [myItems, setMyItems] = useState<MyItemRow[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequestRow[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingRequestRow[]>([]);

  const [stats, setStats] = useState<{ listed: number; requested: number; chats: number }>({
    listed: 0,
    requested: 0,
    chats: 0,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const unseenIncomingCount = useMemo(() => {
    return incomingRequests.filter((r) => !r.owner_dismissed_at && !r.owner_seen_at).length;
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

 async function loadIncomingRequests(uid: string) {
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
    .returns<IncomingRequestRow[]>(); // ✅ important

  if (error) {
    console.warn("incoming requests load:", error.message);
    setIncomingRequests([]);
    return;
  }

  setIncomingRequests(data ?? []); // ✅ no cast needed
}
  async function markIncomingSeen(uid: string) {
    // Mark all unseen incoming requests as seen
    // We only update rows that are currently unseen (owner_seen_at is null) and not dismissed
    const { error } = await supabase
      .from("interests")
      .update({ owner_seen_at: new Date().toISOString() })
      .is("owner_seen_at", null)
      .is("owner_dismissed_at", null)
      // Only rows for items you own. Policy enforces this, but we also limit scope:
      .in(
        "item_id",
        incomingRequests
          .filter((r) => r.items?.owner_id === uid)
          .map((r) => r.item_id)
      );

    if (error) {
      console.warn("mark seen:", error.message);
      return;
    }

    // Update UI instantly
    setIncomingRequests((prev) =>
      prev.map((r) => (r.owner_seen_at || r.owner_dismissed_at ? r : { ...r, owner_seen_at: new Date().toISOString() }))
    );
  }

  async function dismissIncoming(itemId: string, requesterId: string) {
    // Dismiss = hide it from inbox
    const key = `${itemId}:${requesterId}`;
    setDismissingKey(key);

    const { error } = await supabase
      .from("interests")
      .update({ owner_dismissed_at: new Date().toISOString() })
      .eq("item_id", itemId)
      .eq("user_id", requesterId);

    setDismissingKey(null);

    if (error) return alert(error.message);

    setIncomingRequests((prev) => prev.filter((r) => !(r.item_id === itemId && r.user_id === requesterId)));
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    const { uid, email } = await syncAuth();
    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      setLoading(false);
      return;
    }

    // 1) profile
    const { data: pData, error: pErr } = await supabase
      .from("profiles")
      .select("id,email,full_name,user_role,created_at")
      .eq("id", uid)
      .maybeSingle()
      .returns<ProfileRow>();

    if (pErr) {
      console.warn("profile load:", pErr.message);
      setProfile(null);
    } else {
      setProfile(pData ?? null);
    }

    // 2) my listings
    const { data: iData, error: iErr } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyItemRow[]>();

    if (iErr) {
      setMyItems([]);
      setErr(iErr.message);
    } else {
      setMyItems(iData ?? []);
    }

    // 3) my requests (things I requested)
    const { data: rData, error: rErr } = await supabase
      .from("interests")
      .select("item_id,created_at,items:items(id,title,photo_url,status)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .returns<MyRequestRow[]>();

    if (rErr) {
      console.warn("my requests load:", rErr.message);
      setMyRequests([]);
    } else {
      setMyRequests(rData ?? []);
    }

    // 4) incoming requests for your items (notifications)
    await loadIncomingRequests(uid);

    // 5) stats
    const listed = (iData ?? []).length;
    const requested = (rData ?? []).length;

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
    router.push("/me");
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

  // When user opens "Requests for your items", mark as seen and clear dot
  useEffect(() => {
    (async () => {
      if (tab !== "requests_for_you") return;
      if (!userId) return;
      if (unseenIncomingCount <= 0) return;
      await markIncomingSeen(userId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const displayName =
    (profile?.full_name ?? "").trim() ||
    (userEmail ? userEmail.split("@")[0] : "") ||
    "Account";

  const roleLabel = (profile?.user_role ?? "").trim() || "member";

  if (loading) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Loading…</div>;
  }

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Account</h1>
        <p style={{ opacity: 0.8, marginTop: 10 }}>Please log in with your @ashland.edu email.</p>

        <button
          onClick={() => router.push("/me")}
          style={{
            marginTop: 14,
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Go to login
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120 }}>
      {/* Top header */}
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

      {/* Stats row */}
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
          { label: "My requests", value: stats.requested },
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

      {/* Primary actions */}
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
        {[
          { key: "listings", label: "Listings" },
          { key: "my_requests", label: "My requests" },
          { key: "requests_for_you", label: "Requests for your items" },
        ].map((t) => {
          const active = tab === (t.key as any);
          const showDot = t.key === "requests_for_you" && unseenIncomingCount > 0;

          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              style={{
                position: "relative",
                borderRadius: 999,
                border: active ? "1px solid #16a34a" : "1px solid #334155",
                background: active ? "rgba(22,163,74,0.18)" : "transparent",
                color: "white",
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              {t.label}
              {showDot && (
                <span
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: "#ef4444",
                    boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
                  }}
                  aria-label="New requests"
                  title="New requests"
                />
              )}
            </button>
          );
        })}
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

      {/* REQUESTS FOR YOUR ITEMS (INBOX) */}
      {tab === "requests_for_you" && (
        <>
          <div style={{ marginTop: 14, opacity: 0.85 }}>
            People who requested your listings. Click one to jump straight to that item’s management screen.
          </div>

          {incomingRequests.length === 0 ? (
            <div style={{ marginTop: 14, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
              <div style={{ fontWeight: 1000 }}>No one has requested your items yet.</div>
              <div style={{ opacity: 0.8, marginTop: 6 }}>When someone clicks “Request item”, it will show up here.</div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {incomingRequests.map((r) => {
                const it = r.items;
                const req = r.requester;

                const requesterName =
                  (req?.full_name ?? "").trim() ||
                  (req?.email ? req.email.split("@")[0] : "") ||
                  "Someone";

                const key = `${r.item_id}:${r.user_id}`;
                const isUnseen = !r.owner_seen_at && !r.owner_dismissed_at;

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
                        position: "relative",
                      }}
                      title={it?.title ?? "Item"}
                    >
                      {it?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.photo_url} alt={it.title ?? "Item"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        "—"
                      )}

                      {isUnseen && (
                        <span
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: "#ef4444",
                            boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
                          }}
                          title="New"
                        />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {requesterName} requested <span style={{ opacity: 0.92 }}>{it?.title ?? "your item"}</span>
                      </div>

                      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>
                        {req?.user_role ? <span style={{ marginRight: 8 }}>{req.user_role}</span> : null}
                        {req?.email ? <span style={{ marginRight: 8 }}>{req.email}</span> : null}
                        <span>Requested: <b>{formatWhen(r.created_at) || "—"}</b></span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
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
                        View
                      </button>

                      <button
                        onClick={() => dismissIncoming(r.item_id, r.user_id)}
                        disabled={dismissingKey === key}
                        style={{
                          border: "1px solid #7f1d1d",
                          background: "transparent",
                          color: "white",
                          padding: "10px 12px",
                          borderRadius: 12,
                          cursor: dismissingKey === key ? "not-allowed" : "pointer",
                          fontWeight: 900,
                          opacity: dismissingKey === key ? 0.7 : 1,
                          whiteSpace: "nowrap",
                        }}
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
                  setTab("requests_for_you");
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
                Requests for your items {unseenIncomingCount > 0 ? `• ${unseenIncomingCount} new` : ""}
              </button>

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