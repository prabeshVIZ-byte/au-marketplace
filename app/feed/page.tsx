"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

export default function FeedPage() {
  const router = useRouter();

  const [items, setItems] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // auth-aware UI
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // whether current user already expressed interest in each item
  // key: itemId -> true/false
  const [myInterested, setMyInterested] = useState<Record<string, boolean>>({});

  // photo modal
  const [openImg, setOpenImg] = useState<string | null>(null);
  const [openTitle, setOpenTitle] = useState<string>("");

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
    return session?.user?.id ?? null;
  }

  async function loadFeed() {
    const { data, error } = await supabase
      .from("v_feed_items")
      .select("id,title,description,category,status,created_at,photo_url,expires_at,interest_count")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message || "Error loading feed.");
    return ((data as FeedRow[]) || []) as FeedRow[];
  }

  async function loadMyInterests(uid: string, feedIds: string[]) {
    if (!feedIds.length) {
      setMyInterested({});
      return;
    }

    // Fetch ONLY interests for items currently in the feed (efficient + correct)
    const { data, error } = await supabase
      .from("interests")
      .select("item_id")
      .eq("user_id", uid)
      .in("item_id", feedIds);

    if (error) {
      console.log("loadMyInterests error:", error.message);
      setMyInterested({});
      return;
    }

    const map: Record<string, boolean> = {};
    for (const row of data ?? []) {
      // row is { item_id: string }
      map[(row as any).item_id] = true;
    }
    setMyInterested(map);
  }

  async function refreshAll() {
    setLoading(true);
    setErr(null);

    try {
      const uid = await syncAuth();
      const feed = await loadFeed();
      setItems(feed);

      if (uid) {
        await loadMyInterests(uid, feed.map((x) => x.id));
      } else {
        setMyInterested({});
      }
    } catch (e: any) {
      console.error("refreshAll exception:", e);
      setItems([]);
      setMyInterested({});
      setErr(e?.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  function handleInterestedClick(itemId: string) {
    // NO QUICK ACTION HERE.
    // If not logged in -> send to /me
    // If logged in -> go to item page (interest form lives there)
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    const already = myInterested[itemId] === true;

    // If already interested, still go to the item page
    // If not, go with ?interest=1 to nudge the page to open/scroll to the form (optional)
    router.push(already ? `/item/${itemId}` : `/item/${itemId}?interest=1`);
  }

  useEffect(() => {
    refreshAll();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshAll();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // ESC closes modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>AU Zero Marketplace</h1>
          <p style={{ marginTop: 8, opacity: 0.8 }}>
            Browse publicly. Login with @ashland.edu to post or express interest.
          </p>
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

      <h2 style={{ marginTop: 26 }}>Public Feed</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {items.map((item) => {
          const alreadyInterested = myInterested[item.id] === true;
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
              {/* PHOTO */}
              {item.photo_url ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenImg(item.photo_url!);
                    setOpenTitle(item.title);
                  }}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    width: "100%",
                    marginBottom: 12,
                  }}
                  aria-label="Open photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.photo_url}
                    alt={item.title}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: 160,
                      objectFit: "cover",
                      borderRadius: 12,
                      border: "1px solid #0f223f",
                      display: "block",
                    }}
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

              <div style={{ opacity: 0.75, marginTop: 6 }}>
                {item.expires_at
                  ? `Available until: ${new Date(item.expires_at).toLocaleDateString()}`
                  : "Contributor will de-list themselves"}
                {/* keeping your existing display, expiryText is computed if you want it later */}
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

              <div style={{ opacity: 0.75, marginTop: 10 }}>
                {item.interest_count || 0} interested
              </div>

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

              {/* Interested: NO quick insert/delete. Routes to item page form. */}
              <button
                onClick={() => handleInterestedClick(item.id)}
                style={{
                  marginTop: 10,
                  width: "100%",
                  border: "1px solid #334155",
                  background: !isLoggedIn
                    ? "transparent"
                    : alreadyInterested
                    ? "#1f2937"
                    : "#052e16",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                title={
                  !isLoggedIn
                    ? "Login required"
                    : alreadyInterested
                    ? "You already submitted interest (view item)"
                    : "Open the interest form"
                }
              >
                {!isLoggedIn ? "Interested (login required)" : alreadyInterested ? "Interested ✓" : "Interested"}
              </button>
            </div>
          );
        })}
      </div>

      {/* FULLSCREEN IMAGE MODAL */}
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderBottom: "1px solid #0f223f",
              }}
            >
              <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {openTitle || "Photo"}
              </div>

              <button
                type="button"
                onClick={() => setOpenImg(null)}
                style={{
                  background: "transparent",
                  color: "white",
                  border: "1px solid #334155",
                  padding: "6px 10px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={openImg}
              alt={openTitle || "Full photo"}
              style={{
                width: "100%",
                height: "auto",
                maxHeight: "80vh",
                objectFit: "contain",
                display: "block",
                background: "black",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}