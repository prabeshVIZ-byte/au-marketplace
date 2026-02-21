"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  pickup_location: string | null;
  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null; // IMPORTANT: change if your schema uses different name
};

type SellerProfile = {
  full_name: string | null;
  user_role: string | null;
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

  return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [seller, setSeller] = useState<SellerProfile | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [interestCount, setInterestCount] = useState(0);
  const [mineInterested, setMineInterested] = useState(false);
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
    if (!itemId) return;
    setLoading(true);
    setErr(null);

    try {
      // 1) fetch item
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select("id,title,description,category,pickup_location,is_anonymous,expires_at,photo_url,status,owner_id")
        .eq("id", itemId)
        .single();

      if (itErr) throw new Error(itErr.message);
      setItem(it as ItemRow);

      // 2) fetch interest count
      const { count, error: cntErr } = await supabase
        .from("interests")
        .select("*", { count: "exact", head: true })
        .eq("item_id", itemId);

      if (!cntErr) setInterestCount(count ?? 0);

      // 3) if logged in, check if I am interested
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;

      if (uid) {
        const { data: mine, error: mineErr } = await supabase
          .from("interests")
          .select("item_id")
          .eq("item_id", itemId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!mineErr) setMineInterested(!!mine);
      } else {
        setMineInterested(false);
      }

      // 4) fetch seller profile (only if NOT anonymous and owner_id exists)
      const ownerId = (it as any)?.owner_id ?? null;
      const anon = !!(it as any)?.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof, error: pErr } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", ownerId)
          .single();

        if (!pErr) setSeller(prof as SellerProfile);
        else setSeller(null);
      } else {
        setSeller(null);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load item.");
      setItem(null);
      setSeller(null);
    } finally {
      setLoading(false);
    }
  }

  async function toggleInterest() {
    if (!item) return;

    if (!isLoggedIn || !userId) {
      router.push("/me");
      return;
    }

    setSaving(true);

    try {
      if (mineInterested) {
        const { error } = await supabase
          .from("interests")
          .delete()
          .eq("item_id", item.id)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);

        setMineInterested(false);
        setInterestCount((c) => Math.max(0, c - 1));
      } else {
        const { error } = await supabase
          .from("interests")
          .insert([{ item_id: item.id, user_id: userId }]);

        if (error) {
          // ignore duplicates
          if (!error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);
        }

        setMineInterested(true);
        setInterestCount((c) => c + 1);
      }
    } catch (e: any) {
      alert(e?.message || "Could not update interest.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    syncAuth();
    loadItem();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadItem();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showSellerName = item && !item.is_anonymous && seller?.full_name;

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <button
        onClick={() => router.push("/feed")}
        style={{
          marginBottom: 16,
          background: "transparent",
          color: "white",
          border: "1px solid #333",
          padding: "8px 12px",
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        ← Back to feed
      </button>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.85 }}>Loading…</p>}

      {!loading && item && (
        <div style={{ maxWidth: 820 }}>
          <h1 style={{ fontSize: 34, fontWeight: 900, margin: 0 }}>{item.title}</h1>

          {/* Meta */}
          <div style={{ marginTop: 10, opacity: 0.9 }}>
            {item.category && (
              <div style={{ marginTop: 6 }}>
                Category: <b>{item.category}</b>
              </div>
            )}

            {item.pickup_location && (
              <div style={{ marginTop: 6 }}>
                Pickup location: <b>{item.pickup_location}</b>
              </div>
            )}

           <div style={{ opacity: 0.85, marginTop: 10 }}>
  {item.expires_at
    ? `Available until: ${new Date(item.expires_at).toLocaleString()}`
    : "Contributor will de-list themselves"}
</div>

            <div style={{ marginTop: 6 }}>
              Seller:{" "}
              <b>
                {item.is_anonymous ? "Anonymous" : showSellerName ? seller!.full_name : "Ashland user"}
              </b>
              {!item.is_anonymous && seller?.user_role ? (
                <span style={{ opacity: 0.8 }}> ({seller.user_role})</span>
              ) : null}
            </div>

            <div style={{ marginTop: 6 }}>
              Interested: <b>{interestCount}</b>
            </div>
          </div>

          {/* Photo */}
          {item.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.photo_url}
              alt={item.title}
              style={{
                marginTop: 14,
                width: "100%",
                maxWidth: 820,
                height: 420,
                objectFit: "cover",
                borderRadius: 14,
                border: "1px solid #0f223f",
              }}
            />
          ) : (
            <div
              style={{
                marginTop: 14,
                width: "100%",
                maxWidth: 820,
                height: 240,
                borderRadius: 14,
                border: "1px dashed #334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
              }}
            >
              No photo
            </div>
          )}

          {/* Description */}
          <div style={{ marginTop: 14, background: "#0b1730", border: "1px solid #0f223f", borderRadius: 14, padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Description</div>
            <div style={{ opacity: 0.9, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
  {item.description && item.description.trim().toLowerCase() !== "until i cancel"
    ? item.description
    : "—"}
</div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={toggleInterest}
              disabled={saving}
              style={{
                background: isLoggedIn ? (mineInterested ? "#1f2937" : "#052e16") : "transparent",
                border: "1px solid #334155",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                cursor: saving ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: saving ? 0.75 : 1,
              }}
            >
              {saving
                ? "Saving…"
                : isLoggedIn
                ? mineInterested
                  ? "Uninterested"
                  : "Interested"
                : "Interested (login required)"}
            </button>

            <button
              onClick={() => router.push("/me")}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "white",
                padding: "10px 14px",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}