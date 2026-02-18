"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MyItem = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
};

export default function MyItemsPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadMyItems() {
    setLoading(true);
    setErr(null);

    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id ?? null;
    const email = s.session?.user?.email ?? null;

    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    const { data, error } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setItems([]);
      setLoading(false);
      return;
    }

    setItems((data as MyItem[]) || []);
    setLoading(false);
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this listing? This cannot be undone.")) return;

    setDeletingId(id);

    const { error } = await supabase.from("items").delete().eq("id", id);

    setDeletingId(null);

    if (error) {
      alert(error.message);
      return;
    }

    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  useEffect(() => {
    syncAuth();
    loadMyItems();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadMyItems();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
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

        <Link
          href="/create"
          style={{
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          + List new item
        </Link>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        Logged in as <b>{userEmail}</b>
      </div>

      <h1 style={{ marginTop: 18, fontSize: 28, fontWeight: 900 }}>My Listings</h1>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.8 }}>Loading…</p>}

      {!loading && items.length === 0 && (
        <p style={{ opacity: 0.8, marginTop: 10 }}>You haven’t listed anything yet.</p>
      )}

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#0b1730",
              padding: 16,
              borderRadius: 14,
              border: "1px solid #0f223f",
            }}
          >
            {item.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photo_url}
                alt={item.title}
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
            <div style={{ opacity: 0.75, marginTop: 6 }}>
              {item.description || "—"}
            </div>

            <div style={{ opacity: 0.75, marginTop: 10 }}>
              Status: <b>{item.status || "—"}</b>
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
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Edit
              </button>

              <button
                onClick={() => deleteItem(item.id)}
                disabled={deletingId === item.id}
                style={{
                  flex: 1,
                  border: "1px solid #7f1d1d",
                  background: deletingId === item.id ? "#7f1d1d" : "transparent",
                  color: "white",
                  padding: "10px 12px",
                  borderRadius: 10,
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
    </div>
  );
}