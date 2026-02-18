"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type FeedRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  interest_count: number;
};

export default function FeedPage() {
  const router = useRouter();

  const [items, setItems] = useState<FeedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // auth-aware UI
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // whether current user is interested in each item
  const [myInterested, setMyInterested] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  const isLoggedIn =
    !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  async function loadFeed() {
    setLoading(true);
    setErr(null);

    try {
      // --- HARD TIMEOUT so it can never hang forever ---
      const feedPromise = supabase
        .from("v_feed_items")
        .select("id,title,description,status,created_at,photo_url,interest_count")
        .order("created_at", { ascending: false });

      const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) =>
        setTimeout(
          () => resolve({ data: null, error: { message: "Feed request timed out." } }),
          6000
        )
      );

      const { data, error } = await Promise.race([feedPromise, timeoutPromise]);

      if (error) {
        setItems([]);
        setMyInterested({});
        setErr(error.message || "Unknown error loading feed.");
        return;
      }

      const rows = (data as FeedRow[]) || [];
      setItems(rows);

      // If logged in, load which items YOU are interested in
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;

      if (uid && rows.length > 0) {
        const ids = rows.map((r) => r.id);

        const { data: mine, error: mineErr } = await supabase
          .from("interests")
          .select("item_id")
          .in("item_id", ids);

        if (!mineErr) {
          const map: Record<string, boolean> = {};
          for (const r of mine || []) map[(r as any).item_id] = true;
          setMyInterested(map);
        } else {
          setMyInterested({});
        }
      } else {
        setMyInterested({});
      }
    } catch (e: any) {
      setErr(e?.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleInterest(itemId: string) {
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    const already = myInterested[itemId] === true;
    setSavingId(itemId);

    if (already) {
      const { error } = await supabase
        .from("interests")
        .delete()
        .eq("item_id", itemId)
        .eq("user_id", userId);

      setSavingId(null);

      if (error) {
        alert(error.message);
        return;
      }

      setMyInterested((p) => ({ ...p, [itemId]: false }));
      setItems((prev) =>
        prev.map((x) =>
          x.id === itemId
            ? { ...x, interest_count: Math.max(0, (x.interest_count || 0) - 1) }
            : x
        )
      );
      return;
    }

    const { error } = await supabase
      .from("interests")
      .insert([{ item_id: itemId, user_id: userId }]);

    setSavingId(null);

    if (error) {
      if (error.message.toLowerCase().includes("duplicate key")) {
        setMyInterested((p) => ({ ...p, [itemId]: true }));
        return;
      }
      alert(error.message);
      return;
    }

    setMyInterested((p) => ({ ...p, [itemId]: true }));
    setItems((prev) =>
      prev.map((x) =>
        x.id === itemId ? { ...x, interest_count: (x.interest_count || 0) + 1 } : x
      )
    );
  }

  useEffect(() => {
    syncAuth();
    loadFeed();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadFeed();
    });

    return () => sub.subscription.unsubscribe();
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
          onClick={() => router.push("/me")}
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
          {isLoggedIn ? "Account" : "Request Access"}
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
          const mine = myInterested[item.id] === true;

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
              {/* PHOTO (top of card) */}
              {item.photo_url ? (
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
                    marginBottom: 12,
                  }}
                />
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

              <div
                style={{
                  opacity: 0.75,
                  marginTop: 6,
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
                {savingId === item.id
                  ? "Saving…"
                  : isLoggedIn
                  ? mine
                    ? "Uninterested"
                    : "Interested"
                  : "Interested (login required)"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}