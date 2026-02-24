"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  status: string | null; // available | reserved | claimed (your system)
  owner_id: string | null;
  reserved_interest_id?: string | null;
};

function toInputDateTime(expiresAt: string | null) {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local expects "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputDateTime(v: string) {
  if (!v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function EditItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);

  // form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expiresAtLocal, setExpiresAtLocal] = useState(""); // datetime-local
  const [status, setStatus] = useState<"available" | "reserved" | "claimed">("available");

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const editingLocked = useMemo(() => {
    // OPTIONAL safety rule (recommended):
    // lock editing if reserved or claimed, or if reserved_interest_id exists
    if (!item) return false;
    const st = (item.status ?? "").toLowerCase();
    return st === "reserved" || st === "claimed" || !!(item as any).reserved_interest_id;
  }, [item]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
  }

  async function loadItem() {
    if (!id) return;
    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const { data: it, error } = await supabase
        .from("items")
        // include reserved_interest_id if you have it (your manage page uses it)
        .select(
          "id,title,description,category,pickup_location,is_anonymous,expires_at,photo_url,status,owner_id,reserved_interest_id"
        )
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);

      const row = it as ItemRow;
      setItem(row);

      // hydrate form
      setTitle(row.title ?? "");
      setDescription(row.description ?? "");
      setCategory(row.category ?? "");
      setPickupLocation(row.pickup_location ?? "");
      setPhotoUrl(row.photo_url ?? "");
      setIsAnonymous(!!row.is_anonymous);
      setExpiresAtLocal(toInputDateTime(row.expires_at ?? null));

      const st = (row.status ?? "available").toLowerCase();
      setStatus(st === "reserved" ? "reserved" : st === "claimed" ? "claimed" : "available");
    } catch (e: any) {
      setErr(e?.message || "Failed to load item.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!item) return;
    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      // hard validation
      if (!title.trim()) throw new Error("Title is required.");

      // owner check (client-side)
      if (!isOwner) throw new Error("You are not allowed to edit this item.");

      // lock check (optional)
      if (editingLocked) {
        throw new Error("Editing is locked because someone has been selected/confirmed. Finish or reset the pickup flow first.");
      }

      const payload = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        category: category.trim() ? category.trim() : null,
        pickup_location: pickupLocation.trim() ? pickupLocation.trim() : null,
        photo_url: photoUrl.trim() ? photoUrl.trim() : null,
        is_anonymous: isAnonymous,
        expires_at: fromInputDateTime(expiresAtLocal),
        status: status, // only if you really want sellers to change status manually
      };

      const { error } = await supabase.from("items").update(payload).eq("id", item.id);

      if (error) throw new Error(error.message);

      setOk("✅ Saved.");
      await loadItem();
    } catch (e: any) {
      setErr(e?.message || "Failed to save.");
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
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => router.push("/me")}
          style={{
            background: "transparent",
            color: "white",
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          ← Back to my items
        </button>

        <button
          onClick={() => router.push(`/item/${id}`)}
          style={{
            background: "transparent",
            color: "white",
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          View item
        </button>

        <button
          onClick={() => router.push(`/manage/${id}`)}
          style={{
            background: "transparent",
            color: "white",
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Manage requests
        </button>
      </div>

      <h1 style={{ marginTop: 16, fontSize: 28, fontWeight: 900 }}>Edit item</h1>

      {loading && <p style={{ opacity: 0.8 }}>Loading…</p>}
      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {ok && <p style={{ color: "#86efac" }}>{ok}</p>}

      {!loading && item && (
        <div style={{ maxWidth: 760, marginTop: 14 }}>
          {!isOwner && (
            <div style={{ border: "1px solid #7f1d1d", background: "#1f0a0a", padding: 12, borderRadius: 12 }}>
              You are not the owner of this item. Editing is disabled.
            </div>
          )}

          {editingLocked && (
            <div style={{ marginTop: 12, border: "1px solid #334155", background: "#020617", padding: 12, borderRadius: 12 }}>
              Editing is locked because this item is in an active pickup flow (accepted/reserved/claimed).
              <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
                If you want editing during selection, remove this lock logic in the edit page.
              </div>
            </div>
          )}

          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!isOwner || saving || editingLocked}
              style={inputStyle}
              placeholder="Item title"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isOwner || saving || editingLocked}
              style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
              placeholder="Describe the item"
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Category">
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!isOwner || saving || editingLocked}
                style={inputStyle}
                placeholder="e.g. Electronics"
              />
            </Field>

            <Field label="Pickup location">
              <input
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                disabled={!isOwner || saving || editingLocked}
                style={inputStyle}
                placeholder="e.g. Library"
              />
            </Field>
          </div>

          <Field label="Photo URL">
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              disabled={!isOwner || saving || editingLocked}
              style={inputStyle}
              placeholder="https://..."
            />
          </Field>

          <Field label="Expires at">
            <input
              type="datetime-local"
              value={expiresAtLocal}
              onChange={(e) => setExpiresAtLocal(e.target.value)}
              disabled={!isOwner || saving || editingLocked}
              style={inputStyle}
            />
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
              Leave blank for “Until I cancel”.
            </div>
          </Field>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: isOwner ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
                disabled={!isOwner || saving || editingLocked}
              />
              <span style={{ fontWeight: 900 }}>Anonymous listing</span>
            </label>
          </div>

          <Field label="Status (optional)">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              disabled={!isOwner || saving || editingLocked}
              style={inputStyle}
            >
              <option value="available">available</option>
              <option value="reserved">reserved</option>
              <option value="claimed">claimed</option>
            </select>
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
              If you don’t want sellers manually changing status, remove this field.
            </div>
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={save}
              disabled={!isOwner || saving || editingLocked}
              style={{
                border: "1px solid #16a34a",
                background: !isOwner || editingLocked ? "transparent" : "#16a34a",
                color: "white",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: !isOwner || editingLocked ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: saving ? 0.75 : 1,
              }}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>

            <button
              onClick={() => router.push("/me")}
              style={{
                border: "1px solid #334155",
                background: "transparent",
                color: "white",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "black",
  color: "white",
  border: "1px solid #334155",
  padding: "10px 12px",
  borderRadius: 12,
  outline: "none",
};