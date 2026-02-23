"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type OwnerRole = "student" | "faculty" | null;

type FeedRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  expires_at: string | null;
  interest_count: number;
  owner_role?: OwnerRole; // from view
};

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until I cancel";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Until I cancel";

  const now = new Date();
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "Expired";

  const oneDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const dayDiff = Math.round((startOfEnd - startOfToday) / oneDay);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff < 7) return `in ${dayDiff} days`;
  return end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isAvailableNow(row: FeedRow) {
  const st = (row.status ?? "available").toLowerCase();
  if (st !== "available") return false;
  if (!row.expires_at) return true;
  const t = new Date(row.expires_at).getTime();
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}

export default function FeedPage() {
  const router = useRouter();

  const [items, setItems] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [myInterested, setMyInterested] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // photo modal
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState<string>("");

  // sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "expiring_3d">("all");

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  const isLoggedIn = !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  async function loadMyInterestMap(uid: string, itemIds: string[]) {
    if (itemIds.length === 0) return;

    const { data, error } = await supabase
      .from("interests")
      .select("item_id")
      .eq("user_id", uid)
      .in("item_id", itemIds);

    if (error) return;

    const map: Record<string, boolean> = {};
    for (const r of (data as any[]) || []) map[String(r.item_id)] = true;
    setMyInterested(map);
  }

  async function loadFeed() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("v_feed_items")
      .select("id,title,description,category,status,created_at,photo_url,expires_at,interest_count,owner_role")
      .order("created_at", { ascending: false });

    if (error) {
      setItems([]);
      setMyInterested({});
      setErr(error.message || "Error loading feed.");
      setLoading(false);
      return;
    }

    const rows = (data as FeedRow[]) || [];
    setItems(rows);

    if (isLoggedIn && userId) {
      await loadMyInterestMap(
        userId,
        rows.map((x) => x.id)
      );
    } else {
      setMyInterested({});
    }

    setLoading(false);
  }

  async function toggleInterest(itemId: string) {
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    const already = myInterested[itemId] === true;
    setSavingId(itemId);

    if (already) {
      const { error } = await supabase.from("interests").delete().eq("item_id", itemId).eq("user_id", userId);
      setSavingId(null);

      if (error) return alert(error.message);

      setMyInterested((p) => ({ ...p, [itemId]: false }));
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, interest_count: Math.max(0, (x.interest_count || 0) - 1) } : x)));
      return;
    }

    const { error } = await supabase.from("interests").insert([{ item_id: itemId, user_id: userId }]);
    setSavingId(null);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setMyInterested((p) => ({ ...p, [itemId]: true }));
        return;
      }
      return alert(error.message);
    }

    setMyInterested((p) => ({ ...p, [itemId]: true }));
    setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, interest_count: (x.interest_count || 0) + 1 } : x)));
  }

  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadFeed();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadFeed();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenImg(null);
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const x of items) {
      const c = (x.category ?? "").trim();
      if (c) set.add(c);
    }
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filteredItems = useMemo(() => {
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;

    return items.filter((x) => {
      // category
      if (categoryFilter !== "all" && (x.category ?? "") !== categoryFilter) return false;

      // role
      if (roleFilter !== "all") {
        const r = (x.owner_role ?? null) as OwnerRole;
        if (!r) return false;
        if (r !== roleFilter) return false;
      }

      // availability
      if (availabilityFilter === "available") {
        if (!isAvailableNow(x)) return false;
      }
      if (availabilityFilter === "expiring_3d") {
        if (!isAvailableNow(x)) return false;
        if (!x.expires_at) return false;
        const t = new Date(x.expires_at).getTime();
        if (Number.isNaN(t)) return false;
        if (t - now > threeDays) return false;
      }

      return true;
    });
  }, [items, categoryFilter, roleFilter, availabilityFilter]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      {/* top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
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
            aria-label="Open filters"
            title="Filters"
          >
            ☰
          </button>

          <div>
            <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>AU Zero Marketplace</h1>
            <p style={{ marginTop: 8, opacity: 0.8 }}>Browse publicly. Login with @ashland.edu to post or express interest.</p>
          </div>
        </div>

        <button
          onClick={() => router.push("/my-items")}
          style={{
            background: "transparent",
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #334155",
            color: "white",
            cursor: "pointer",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {isLoggedIn ? "My listings" : "Request Access"}
        </button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        {isLoggedIn ? (
          <span>
            Logged in as <b>{userEmail}</b>
          </span>
        ) : (
          <span>Not logged in — browse only.</span>
        )}
      </div>

      {err && <p style={{ color: "#f87171", marginTop: 12 }}>{err}</p>}
      {loading && <p style={{ marginTop: 12, opacity: 0.8 }}>Loading…</p>}

      {/* sidebar drawer */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 9998,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 320,
              background: "#0b1730",
              borderRight: "1px solid #0f223f",
              padding: 16,
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Filters</div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid #334155",
                  color: "white",
                  padding: "6px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginTop: 14, border: "1px solid #0f223f", borderRadius: 14, padding: 12, background: "#020617" }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Category</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {categories.map((c) => {
                  const active = categoryFilter === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryFilter(c)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid #334155",
                        padding: "8px 10px",
                        background: active ? "#052e16" : "transparent",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 800,
                        opacity: active ? 1 : 0.9,
                      }}
                    >
                      {c === "all" ? "All" : c}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 12, border: "1px solid #0f223f", borderRadius: 14, padding: 12, background: "#020617" }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Lister type</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(["all", "student", "faculty"] as const).map((v) => {
                  const active = roleFilter === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRoleFilter(v)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid #334155",
                        padding: "8px 10px",
                        background: active ? "#052e16" : "transparent",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      {v === "all" ? "All" : v[0].toUpperCase() + v.slice(1)}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                If this stays empty, your view isn’t returning <code>owner_role</code>.
              </div>
            </div>

            <div style={{ marginTop: 12, border: "1px solid #0f223f", borderRadius: 14, padding: 12, background: "#020617" }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Availability</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(
                  [
                    ["all", "All"],
                    ["available", "Available now"],
                    ["expiring_3d", "Expiring ≤ 3 days"],
                  ] as const
                ).map(([v, label]) => {
                  const active = availabilityFilter === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAvailabilityFilter(v)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid #334155",
                        padding: "8px 10px",
                        background: active ? "#052e16" : "transparent",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: 800,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setRoleFilter("all");
                setAvailabilityFilter("all");
              }}
              style={{
                marginTop: 14,
                width: "100%",
                borderRadius: 12,
                border: "1px solid #334155",
                background: "transparent",
                color: "white",
                padding: "10px 12px",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 26 }}>Public Feed</h2>
      <div style={{ marginTop: 8, opacity: 0.8 }}>
        Showing <b>{filteredItems.length}</b> of <b>{items.length}</b>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 12 }}>
        {filteredItems.map((item) => {
          const mine = myInterested[item.id] === true;
          const expiryText = formatExpiry(item.expires_at);

          return (
            <div
              key={item.id}
              style={{
                background: "#0b1730",
                padding: 16,
                borderRadius: 14,
                border: "1px solid #0f223f",
              }}
            >
              {/* photo */}
              {item.photo_url ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenImg(item.photo_url!);
                    setOpenTitle(item.title);
                  }}
                  style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", width: "100%", marginBottom: 12 }}
                  aria-label="Open photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.photo_url}
                    alt={item.title}
                    loading="lazy"
                    style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, border: "1px solid #0f223f", display: "block" }}
                  />
                </button>
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: 160,
                    borderRadius: 12,
                    border: "1px dashed #334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    marginBottom: 12,
                  }}
                >
                  No photo
                </div>
              )}

              <div style={{ fontSize: 18, fontWeight: 900 }}>{item.title}</div>

              {item.category && (
                <div style={{ opacity: 0.85, marginTop: 6 }}>
                  Category: <span style={{ fontWeight: 800 }}>{item.category}</span>
                </div>
              )}

              {!!item.owner_role && (
                <div style={{ opacity: 0.85, marginTop: 6 }}>
                  Lister: <span style={{ fontWeight: 800 }}>{item.owner_role}</span>
                </div>
              )}

              <div style={{ opacity: 0.75, marginTop: 6 }}>
                {item.expires_at ? `Available until: ${new Date(item.expires_at).toLocaleDateString()}` : "Contributor will de-list themselves"}{" "}
                <span style={{ opacity: 0.75 }}>({expiryText})</span>
              </div>

              <div
                style={{
                  opacity: 0.75,
                  marginTop: 8,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.description || "—"}
              </div>

              <div style={{ opacity: 0.75, marginTop: 10 }}>{item.interest_count || 0} interested</div>

              <button
                onClick={() => router.push(`/item/${item.id}`)}
                style={{
                  marginTop: 12,
                  width: "100%",
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                View item
              </button>

              <button
                onClick={() => toggleInterest(item.id)}
                disabled={savingId === item.id}
                style={{
                  marginTop: 10,
                  width: "100%",
                  border: "1px solid #334155",
                  background: isLoggedIn ? (mine ? "#1f2937" : "#052e16") : "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: savingId === item.id ? "not-allowed" : "pointer",
                  fontWeight: 900,
                  opacity: savingId === item.id ? 0.7 : 1,
                }}
              >
                {savingId === item.id ? "Saving…" : isLoggedIn ? (mine ? "Uninterested" : "Interested") : "Interested (login required)"}
              </button>
            </div>
          );
        })}
      </div>

      {/* fullscreen image modal */}
      {openImg && (
        <div
          onClick={() => setOpenImg(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1000px, 95vw)",
              maxHeight: "90vh",
              background: "#0b1730",
              border: "1px solid #0f223f",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #0f223f" }}>
              <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{openTitle || "Photo"}</div>
              <button
                type="button"
                onClick={() => setOpenImg(null)}
                style={{ background: "transparent", color: "white", border: "1px solid #334155", padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 900 }}
              >
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={openImg}
              alt={openTitle || "Full photo"}
              style={{ width: "100%", height: "auto", maxHeight: "80vh", objectFit: "contain", display: "block", background: "black" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}