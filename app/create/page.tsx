"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Category =
  | "clothing"
  | "sports_equipment"
  | "stationary"
  | "ride"
  | "books"
  | "notes"
  | "art"
  | "other";

type PickupLocation = "College Quad" | "Safety Service Office" | "Dining Hall";

type ExpireChoice = "7" | "14" | "30" | "never";

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function isImage(file: File) {
  return file.type?.startsWith("image/");
}

export default function CreatePage() {
  const router = useRouter();

  // auth + profile gating
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [category, setCategory] = useState<Category>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // photo
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  // 1) Sync auth
  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) console.log("getSession error:", error.message);

      const session = data.session;
      setEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
      setAuthLoading(false);
    }

    syncAuth();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      // profile check will run after auth changes too (below effect)
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) Check profile completion (full_name + user_role) for logged-in users
  useEffect(() => {
    let mounted = true;

    async function checkProfile() {
      setProfileLoading(true);
      setProfileComplete(false);

      if (!userId) {
        setProfileLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("full_name,user_role")
        .eq("id", userId)
        .single();

      if (!mounted) return;

      if (error) {
        // If profile row doesn't exist or blocked by RLS, treat as incomplete
        console.log("profile check error:", error.message);
        setProfileComplete(false);
        setProfileLoading(false);
        return;
      }

      const fullNameOk = (data?.full_name ?? "").trim().length > 0;
      const roleOk = data?.user_role === "student" || data?.user_role === "faculty";

      setProfileComplete(fullNameOk && roleOk);
      setProfileLoading(false);
    }

    checkProfile();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // 3) Image preview
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // re-check session at submit time
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setMsg(error.message);
      return;
    }

    const session = data.session;
    const userEmail = session?.user?.email ?? null;
    const uid = session?.user?.id ?? null;

    if (!session || !userEmail || !uid || !userEmail.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    // Require profile completion
    if (!profileComplete) {
      router.push("/me");
      return;
    }

    // validate
    const cleanTitle = title.trim();
    const cleanDesc = description.trim() || null;

    if (cleanTitle.length < 3) {
      setMsg("Title must be at least 3 characters.");
      return;
    }

    if (file && !isImage(file)) {
      setMsg("Please upload an image file (jpg/png/webp).");
      return;
    }

    // compute expires_at
    const expiresAt =
      expireChoice === "never"
        ? null
        : new Date(Date.now() + Number(expireChoice) * 24 * 60 * 60 * 1000).toISOString();

    setSaving(true);

    try {
      // A) Create item row (NO photo yet)
      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([
          {
            title: cleanTitle,
            description: cleanDesc,
            status: "available",
            photo_url: null,

            // ✅ new fields
            category,
            pickup_location: pickupLocation,
            is_anonymous: isAnonymous,
            expires_at: expiresAt,
          },
        ])
        .select("id")
        .single();

      if (createErr || !created?.id) {
        throw new Error(createErr?.message || "Failed to create item.");
      }

      const itemId = created.id as string;

      // B) If no photo, go to item page
      if (!file) {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // C) Upload photo to Storage
      const ext = getExt(file.name);
      const path = `items/${uid}/${itemId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("item-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

      if (uploadErr) {
        setMsg(`Item posted, but photo upload failed: ${uploadErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // D) Get public URL (bucket must be public)
      const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // E) Save URL to items.photo_url
      const { error: updateErr } = await supabase.from("items").update({ photo_url: publicUrl }).eq("id", itemId);

      if (updateErr) {
        setMsg(`Photo uploaded, but items.photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // F) Optional: item_photos table insert (only if your columns exist)
      // If your item_photos schema differs, delete this block.
      const { error: photoErr } = await supabase.from("item_photos").insert([
        {
          item_id: itemId,
          photo_url: publicUrl,
          storage_path: path,
        },
      ]);

      if (photoErr) console.log("item_photos insert failed:", photoErr.message);

      // done
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // ===== UI =====

  if (authLoading || profileLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Loading…
      </div>
    );
  }

  // Not logged in / not allowed
  if (!isAllowed || !userId) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>List New Item</h1>
        <p style={{ opacity: 0.85, marginTop: 0 }}>
          You must log in with your <b>@ashland.edu</b> email to post.
        </p>
        <button
          onClick={() => router.push("/me")}
          style={{
            marginTop: 16,
            background: "#0b0b0b",
            color: "white",
            border: "1px solid #333",
            padding: "10px 14px",
            borderRadius: 10,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Go to Account
        </button>
      </div>
    );
  }

  // Profile incomplete gate
  if (!profileComplete) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 34, fontWeight: 900, marginBottom: 10 }}>Complete Profile</h1>
        <p style={{ opacity: 0.85, marginTop: 0 }}>
          Before posting, please set your <b>full name</b> and choose <b>Student/Faculty</b>.
        </p>

        <button
          onClick={() => router.push("/me")}
          style={{
            marginTop: 16,
            background: "#16a34a",
            color: "white",
            border: "none",
            padding: "12px 16px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
            width: "fit-content",
          }}
        >
          Go to Profile Setup
        </button>
      </div>
    );
  }

  // Main form
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

      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>List New Item</h1>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
        <input
          type="text"
          placeholder="Item title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #333",
            background: "#111",
            color: "white",
          }}
        />

        <textarea
          placeholder="Description (optional)"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #333",
            background: "#111",
            color: "white",
          }}
        />

        {/* Category */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          >
            <option value="clothing">Clothing</option>
            <option value="sports_equipment">Sports equipment</option>
            <option value="stationary">Stationary item</option>
            <option value="ride">Ride</option>
            <option value="books">Books</option>
            <option value="notes">Notes</option>
            <option value="art">Art pieces</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Pickup location */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Pickup location (safe spot)</div>
          <select
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value as PickupLocation)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          >
            <option value="College Quad">College Quad</option>
            <option value="Safety Service Office">Safety Service Office</option>
            <option value="Dining Hall">Dining Hall</option>
          </select>
        </div>

        {/* Anonymous toggle */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Post anonymously</div>

          <button
            type="button"
            onClick={() => setIsAnonymous((v) => !v)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: isAnonymous ? "#052e16" : "transparent",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {isAnonymous ? "Anonymous: ON" : "Anonymous: OFF"}
          </button>

          <div style={{ opacity: 0.75, marginTop: 8 }}>
            {isAnonymous ? "Your name will be hidden from the public feed." : "Your name can be shown later (when we add it)."}
          </div>
        </div>

        {/* Expires */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>How long should this post stay up?</div>

          <select
            value={expireChoice}
            onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="never">Until I cancel</option>
          </select>

          <div style={{ opacity: 0.75, marginTop: 8 }}>
            {expireChoice === "never"
              ? "This post will stay up until you cancel it."
              : `This post will expire in ${expireChoice} days.`}
          </div>
        </div>

        {/* Photo */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Photo (optional)</div>

          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Preview"
              style={{
                width: "100%",
                height: 240,
                objectFit: "cover",
                borderRadius: 12,
                border: "1px solid #0f223f",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: 240,
                borderRadius: 12,
                border: "1px dashed #334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
              }}
            >
              No photo selected
            </div>
          )}

          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ marginTop: 12 }}
          />

          {file && (
            <button
              type="button"
              onClick={() => setFile(null)}
              style={{
                marginTop: 10,
                background: "transparent",
                color: "white",
                border: "1px solid #334155",
                padding: "8px 12px",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Remove photo
            </button>
          )}
        </div>

        {msg && <p style={{ color: "#f87171", margin: 0 }}>{msg}</p>}

        <button
          type="submit"
          disabled={saving}
          style={{
            background: saving ? "#14532d" : "#16a34a",
            padding: "10px 14px",
            borderRadius: 10,
            border: "none",
            color: "white",
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
            fontWeight: 900,
          }}
        >
          {saving ? "Posting…" : "Post Item"}
        </button>
      </form>
    </div>
  );
}