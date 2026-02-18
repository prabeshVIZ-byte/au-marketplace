"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  owner_id: string;
};

export default function ManageItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function loadOne() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,owner_id")
      .eq("id", id)
      .single();

    if (error) {
      setErr(error.message);
      setItem(null);
      setLoading(false);
      return;
    }

    setItem((data as Item) || null);
    setLoading(false);
  }

  useEffect(() => {
    if (id) loadOne();
  }, [id]);

  function disabledAction(msg: string) {
    alert(msg);
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
          onClick={() => router.push(`/item/${id}`)}
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
          View item
        </button>
      </div>

      {err && <p style={{ color: "#f87171", marginTop: 14 }}>{err}</p>}
      {loading && <p style={{ marginTop: 14, opacity: 0.8 }}>Loading…</p>}

      {item && (
        <div style={{ marginTop: 16, maxWidth: 900 }}>
          <div style={{ background: "#0b1730", borderRadius: 14, padding: 16, border: "1px solid #0f223f" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>{item.title}</h1>

            <div style={{ marginTop: 10, opacity: 0.8 }}>{item.description || "—"}</div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill label={`Status: ${item.status ?? "available"}`} />
              <Pill label={`Posted: ${new Date(item.created_at).toLocaleString()}`} />
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => disabledAction("Manage actions come after login + ownership checks.")}
                style={outlineBtn}
              >
                Edit (disabled)
              </button>

              <button
                onClick={() => disabledAction("Deleting comes after login + ownership checks.")}
                style={outlineBtn}
              >
                Delete (disabled)
              </button>
            </div>

            <div style={{ marginTop: 10, opacity: 0.65, fontSize: 12 }}>
              This page is here so routing works. Real manage controls come after auth is fully wired.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 900,
        padding: "6px 10px",
        borderRadius: 999,
        background: "#071022",
        border: "1px solid #0f223f",
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
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