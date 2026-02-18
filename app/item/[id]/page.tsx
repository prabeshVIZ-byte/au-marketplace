"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
  interest_count: number;
};

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [item, setItem] = useState<ItemRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // auth + user interest state
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mine, setMine] = useState(false);

  const [saving, setSaving] = useState(false);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadItem() {
    setLoading(true);
    setErr(null);

    // Pull from the SAME view as /feed so you get interest_count
    const { data, error } = await supabase
      .from("v_feed_items")
      .select("id,title,description,status,created_at,photo_url,interest_count")
      .eq("id", id)
      .single();

    if (error) {
      setErr(error.message);
      setItem(null);
      setLoading(false);
      return;
    }

    setItem((data as ItemRow) || null);
    setLoading(false);
  }

  async function loadMine() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;

    if (!uid) {
      setMine(false);
      return;
    }

    // RLS should only allow the user to see their own interests.
    const { data: rows, error } = await supabase
      .from("interests")
      .select("item_id")
      .eq("item_id", id)
      .limit(1);

    if (error) {
      setMine(false);
      return;
    }

    setMine((rows?.length ?? 0) > 0);
  }

  useEffect(() => {
    if (!id) return;

    (async () => {
      await syncAuth();
      await loadItem();
      await loadMine();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      await syncAuth();
      await loadMine();
    });

    return () => sub.subscription.unsubscribe();
  }, [id]);

  async function toggleInterest() {
    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }
    if (!item) return;

    setSaving(true);

    // If already interested → delete. Else → insert.
    if (mine) {
      const { error } = await supabase
        .from("interests")
        .delete()
        .eq("item_id", item.id)
        .eq("user_id", userId);

      setSaving(false);

      if (error) {
        alert(error.message);
        return;
      }

      setMine(false);
      setItem((prev) =>
        prev ? { ...prev, interest_count: Math.max(0, (prev.interest_count || 0) - 1) } : prev
      );
      return;
    }

    const { error } = await supabase.from("interests").insert([{ item_id: item.id, user_id: userId }]);

    setSaving(false);

    if (error) {
      // If user double-clicks, unique constraint triggers
      if (error.message.toLowerCase().includes("duplicate key")) {
        setMine(true);
        return;
      }
      alert(error.message);
      return;
    }

    setMine(true);
    setItem((prev) => (prev ? { ...prev, interest_count: (prev.interest_count || 0) + 1 } : prev));
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Link
          href="/feed"
          style={{
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          ← Back to feed
        </Link>

        <button
          onClick={() => router.push("/me")}
          style={{
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
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

      {err && <p style={{ color: "#f87171", marginTop: 14 }}>{err}</p>}
      {loading && <p style={{ marginTop: 14, opacity: 0.8 }}>Loading…</p>}

      {item && (
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr", gap: 16, maxWidth: 900 }}>
          <div
            style={{
              height: 320,
              borderRadius: 14,
              overflow: "hidden",
              background: "#020617",
              border: "1px solid #0f223f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {item.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photo_url}
                alt={item.title}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ opacity: 0.6, fontWeight: 900 }}>No photo</span>
            )}
          </div>

          <div style={{ background: "#0b1730", borderRadius: 14, padding: 16, border: "1px solid #0f223f" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>{item.title}</h1>

            <div style={{ marginTop: 10, opacity: 0.75 }}>{item.description || "—"}</div>

            <div style={{ marginTop: 14, opacity: 0.8, fontWeight: 800 }}>
              {item.interest_count || 0} interested
            </div>

            <div style={{ marginTop: 10, opacity: 0.7 }}>
              Posted: {new Date(item.created_at).toLocaleString()}
            </div>

            <button
              onClick={toggleInterest}
              disabled={saving}
              style={{
                marginTop: 14,
                width: "100%",
                border: "1px solid #334155",
                background: isLoggedIn ? (mine ? "#1f2937" : "#052e16") : "transparent",
                color: "white",
                padding: "12px 14px",
                borderRadius: 12,
                cursor: saving ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : isLoggedIn ? (mine ? "Uninterested" : "Interested") : "Interested (login required)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}