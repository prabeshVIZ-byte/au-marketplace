"use client";

import Image from "next/image";
import { Grand_Hotel } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const brandFont = Grand_Hotel({
  subsets: ["latin"],
  weight: "400",
});

type OwnerRole = "student" | "faculty" | null;

type FeedRowFromView = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  expires_at: string | null;
  interest_count: number;
  owner_role?: OwnerRole;
};

type ItemMeta = {
  id: string;
  owner_id: string | null;
  is_claimed: boolean | null;
};

type FeedRow = FeedRowFromView & {
  owner_id?: string | null;
  is_claimed?: boolean | null;
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

function statusBadge(status: string | null) {
  const st = (status ?? "available").toLowerCase();
  const base = {
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid rgba(148,163,184,0.25)",
    background: "rgba(0,0,0,0.35)",
    color: "rgba(255,255,255,0.82)",
  } as const;

  if (st === "reserved") {
    return {
      ...base,
      border: "1px solid rgba(96,165,250,0.35)",
      background: "rgba(59,130,246,0.16)",
      color: "rgba(191,219,254,0.95)",
    };
  }
  if (st === "available") {
    return {
      ...base,
      border: "1px solid rgba(52,211,153,0.35)",
      background: "rgba(16,185,129,0.14)",
      color: "rgba(209,250,229,0.95)",
    };
  }
  if (st === "claimed" || st === "expired") {
    return {
      ...base,
      border: "1px solid rgba(248,113,113,0.35)",
      background: "rgba(239,68,68,0.12)",
      color: "rgba(254,202,202,0.95)",
    };
  }
  return base;
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

  // filters
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "faculty">("all");

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  const isLoggedIn =
    !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

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

  async function loadOwnerMeta(itemIds: string[]) {
    if (itemIds.length === 0) return new Map<string, ItemMeta>();
    const { data, error } = await supabase
      .from("items")
      .select("id,owner_id,is_claimed")
      .in("id", itemIds);

    if (error) return new Map<string, ItemMeta>();

    const m = new Map<string, ItemMeta>();
    for (const r of (data as ItemMeta[]) || []) m.set(r.id, r);
    return m;
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

    const rows = ((data as FeedRowFromView[]) || []).map((x) => ({ ...x })) as FeedRow[];
    const ids = rows.map((x) => x.id);

    const meta = await loadOwnerMeta(ids);
    const merged = rows.map((x) => {
      const m = meta.get(x.id);
      return { ...x, owner_id: m?.owner_id ?? null, is_claimed: m?.is_claimed ?? null };
    });

    const visible = merged.filter((x) => {
      const st = (x.status ?? "available").toLowerCase();
      const claimed = !!x.is_claimed || st === "claimed";
      return !claimed;
    });

    setItems(visible);

    if (isLoggedIn && userId) {
      await loadMyInterestMap(userId, visible.map((x) => x.id));
    } else {
      setMyInterested({});
    }

    setLoading(false);
  }

  async function toggleRequest(item: FeedRow) {
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    const isMineListing = !!item.owner_id && item.owner_id === userId;
    if (isMineListing) return;

    const already = myInterested[item.id] === true;
    setSavingId(item.id);

    if (already) {
      const { error } = await supabase
        .from("interests")
        .delete()
        .eq("item_id", item.id)
        .eq("user_id", userId);

      setSavingId(null);
      if (error) return alert(error.message);

      setMyInterested((p) => ({ ...p, [item.id]: false }));
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? { ...x, interest_count: Math.max(0, (x.interest_count || 0) - 1) }
            : x
        )
      );
      return;
    }

    const { error } = await supabase
      .from("interests")
      .insert([{ item_id: item.id, user_id: userId }]);

    setSavingId(null);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        setMyInterested((p) => ({ ...p, [item.id]: true }));
        return;
      }
      return alert(error.message);
    }

    setMyInterested((p) => ({ ...p, [item.id]: true }));
    setItems((prev) =>
      prev.map((x) =>
        x.id === item.id ? { ...x, interest_count: (x.interest_count || 0) + 1 } : x
      )
    );
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
      if (e.key === "Escape") setOpenImg(null);
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
    return items.filter((x) => {
      if (categoryFilter !== "all" && (x.category ?? "") !== categoryFilter) return false;

      if (roleFilter !== "all") {
        const r = (x.owner_role ?? null) as OwnerRole;
        if (!r) return false;
        if (r !== roleFilter) return false;
      }

      return true;
    });
  }, [items, categoryFilter, roleFilter]);

  const topWrap: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 30,
    background: "rgba(0,0,0,0.90)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(148,163,184,0.12)",
  };

  const pagePad: React.CSSProperties = { padding: "14px 16px 90px" };

  const pill: React.CSSProperties = {
    flex: "0 0 auto",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.22)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.86)",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white" }}>
      {/* TOP BAR */}
      <div style={topWrap}>
        <div style={{ ...pagePad, paddingBottom: 10 }}>
          {/* Header row with perfect center brand */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr 56px",
              alignItems: "center",
              gap: 12,
            }}
          >
            {/* Left: logo icon */}
            <button
              type="button"
              onClick={() => router.push("/feed")}
              aria-label="Home"
              title="Home"
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.08)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <Image
                src="/scholarswap-icon.png"
                alt="ScholarSwap"
                width={56}
                height={56}
                priority
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </button>

            {/* Center: brand wordmark (Instagram-like font) */}
            <div style={{ textAlign: "center", lineHeight: 1 }}>
              <div
                className={brandFont.className}
                style={{
                  fontSize: 44,
                  letterSpacing: 0.2,
                  transform: "translateY(2px)",
                  color: "rgba(255,255,255,0.96)",
                  userSelect: "none",
                }}
              >
                ScholarSwap
              </div>
            </div>

            {/* Right: create */}
            <button
              type="button"
              onClick={() => router.push("/create")}
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                border: "1px solid rgba(52,211,153,0.25)",
                background: "rgba(16,185,129,0.16)",
                color: "rgba(209,250,229,0.95)",
                cursor: "pointer",
                fontWeight: 1000,
                fontSize: 26,
                display: "grid",
                placeItems: "center",
              }}
              aria-label="Create listing"
              title="Create listing"
            >
              +
            </button>
          </div>

          {/* FILTER ROW */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 6,
                WebkitOverflowScrolling: "touch",
                alignItems: "center",
              }}
            >
              {/* Lister pill */}
              <div
                style={{
                  ...pill,
                  padding: "0px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 14, opacity: 0.9 }}>👤</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as any)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    fontWeight: 950,
                    cursor: "pointer",
                    outline: "none",
                    padding: "10px 0",
                  }}
                  aria-label="Filter by lister"
                >
                  <option value="all">All</option>
                  <option value="student">Student</option>
                  <option value="faculty">Faculty</option>
                </select>
              </div>

              {/* Category pills */}
              {categories.map((c) => {
                const active = categoryFilter === c;
                const label = c === "all" ? "All" : c[0].toUpperCase() + c.slice(1);

                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryFilter(c)}
                    style={{
                      ...pill,
                      border: active
                        ? "1px solid rgba(52,211,153,0.45)"
                        : "1px solid rgba(148,163,184,0.22)",
                      background: active ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.04)",
                      color: active ? "rgba(209,250,229,0.95)" : "rgba(255,255,255,0.82)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.9 }}>Public Feed</div>
              <div style={{ fontSize: 13, opacity: 0.65, fontWeight: 900 }}>
                Showing <b style={{ opacity: 0.95 }}>{filteredItems.length}</b>
              </div>
            </div>

            {err && <p style={{ color: "#f87171", marginTop: 10 }}>{err}</p>}
            {loading && <p style={{ marginTop: 10, opacity: 0.7 }}>Loading…</p>}
          </div>
        </div>
      </div>

      {/* CARDS */}
      <div style={{ ...pagePad, paddingTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 18 }}>
          {filteredItems.map((item) => {
            const mineRequested = myInterested[item.id] === true;
            const expiryText = formatExpiry(item.expires_at);
            const isMineListing = !!userId && !!item.owner_id && item.owner_id === userId;

            return (
              <div
                key={item.id}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,0.15)",
                  overflow: "hidden",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ position: "relative", height: 220, background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.25))" }}>
                  {item.photo_url ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenImg(item.photo_url!);
                        setOpenTitle(item.title);
                      }}
                      style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", width: "100%", height: "100%" }}
                      aria-label="Open photo"
                      title="Open photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.photo_url} alt={item.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)" }}>
                      No photo
                    </div>
                  )}

                  <div style={{ position: "absolute", top: 12, left: 12 }}>
                    <span style={statusBadge(item.status)}>{(item.status ?? "available").toLowerCase()}</span>
                  </div>
                </div>

                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, opacity: 0.72 }}>
                    {item.category ? `Category: ${item.category}` : "Category: —"}
                    {item.owner_role ? ` • Lister: ${item.owner_role}` : ""}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950, letterSpacing: -0.2 }}>{item.title}</div>

                  <div style={{ marginTop: 8, opacity: 0.7, fontSize: 13 }}>
                    {item.expires_at ? `Available until: ${new Date(item.expires_at).toLocaleDateString()}` : "Contributor will de-list themselves"}{" "}
                    <span style={{ opacity: 0.75 }}>({expiryText})</span>
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      opacity: 0.75,
                      fontSize: 14,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      minHeight: 40,
                    }}
                  >
                    {item.description || "—"}
                  </div>

                  <div style={{ marginTop: 10, opacity: 0.72, fontSize: 13 }}>{item.interest_count || 0} requests</div>

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <button
                      onClick={() => router.push(`/item/${item.id}`)}
                      style={{
                        width: "100%",
                        border: "1px solid rgba(148,163,184,0.25)",
                        background: "rgba(255,255,255,0.03)",
                        color: "rgba(255,255,255,0.85)",
                        padding: "10px 12px",
                        borderRadius: 14,
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      View item
                    </button>

                    <button
                      onClick={() => toggleRequest(item)}
                      disabled={savingId === item.id || isMineListing}
                      style={{
                        width: "100%",
                        border: "1px solid rgba(52,211,153,0.25)",
                        background: isMineListing
                          ? "rgba(255,255,255,0.03)"
                          : isLoggedIn
                          ? mineRequested
                            ? "rgba(16,185,129,0.16)"
                            : "rgba(16,185,129,0.24)"
                          : "rgba(255,255,255,0.03)",
                        color: "rgba(255,255,255,0.9)",
                        padding: "10px 12px",
                        borderRadius: 14,
                        cursor: savingId === item.id || isMineListing ? "not-allowed" : "pointer",
                        fontWeight: 950,
                        opacity: savingId === item.id || isMineListing ? 0.75 : 1,
                      }}
                    >
                      {isMineListing
                        ? "Your listing"
                        : savingId === item.id
                        ? "Saving…"
                        : isLoggedIn
                        ? mineRequested
                          ? "Requested"
                          : "Request item"
                        : "Request (login)"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(148,163,184,0.18)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
              <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{openTitle || "Photo"}</div>
              <button
                type="button"
                onClick={() => setOpenImg(null)}
                style={{
                  background: "transparent",
                  color: "white",
                  border: "1px solid rgba(148,163,184,0.25)",
                  padding: "6px 10px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 950,
                }}
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