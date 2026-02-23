"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* =======================
   TYPES
======================= */
type Category =
  | "clothing"
  | "sport equipment"
  | "stationary item"
  | "ride"
  | "books"
  | "notes"
  | "art pieces"
  | "others"
  | "electronics"
  | "furniture"
  | "health & beauty"
  | "home & kitchen"
  | "jeweleries"
  | "musical instruments";

type PickupLocation = "College Quad" | "Safety Service Office" | "Dining Hall";
type ExpireChoice = "7" | "14" | "30" | "never";

/* =======================
   HELPERS
======================= */
function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function isImage(file: File) {
  return file.type?.startsWith("image/");
}

/* =======================
   PAGE
======================= */
export default function CreatePage() {
  const router = useRouter();

  /* AUTH STATE */
  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  /* PROFILE STATE */
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  /* FORM STATE */
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [category, setCategory] = useState<Category>("books");
  const [pickupLocation, setPickupLocation] =
    useState<PickupLocation>("College Quad");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  /* =======================
     AUTH SYNC
  ======================= */
  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      setUserId(data.session?.user?.id ?? null);
      setEmail(data.session?.user?.email ?? null);
      setAuthLoading(false);
    }

    syncAuth();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* =======================
     PROFILE CHECK (quiet)
  ======================= */
  useEffect(() => {
    let mounted = true;

    async function checkProfile() {
      if (!userId) {
        setProfileLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("full_name,user_role")
        .eq("id", userId)
        .maybeSingle();

      if (!mounted) return;

      const fullNameOk = (data?.full_name ?? "").trim().length > 0;
      const roleOk =
        data?.user_role === "student" || data?.user_role === "faculty";

      setProfileComplete(fullNameOk && roleOk);
      setProfileLoading(false);
    }

    checkProfile();
    return () => {
      mounted = false;
    };
  }, [userId]);

  /* =======================
     IMAGE PREVIEW
  ======================= */
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* =======================
     SUBMIT
  ======================= */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const { data } = await supabase.auth.getSession();
    const session = data.session;

    if (!session || !session.user.email?.endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    // 🚨 ONLY BLOCK HERE
    if (!profileComplete) {
      router.push("/me");
      return;
    }

    if (title.trim().length < 3) {
      setMsg("Title must be at least 3 characters.");
      return;
    }

    if (file && !isImage(file)) {
      setMsg("Please upload a valid image.");
      return;
    }

    setSaving(true);

    try {
      const expiresAt =
        expireChoice === "never"
          ? null
          : new Date(
              Date.now() + Number(expireChoice) * 24 * 60 * 60 * 1000
            ).toISOString();

      const { data: created, error } = await supabase
        .from("items")
        .insert([
          {
            title: title.trim(),
            description: description.trim() || null,
            status: "available",
            category,
            pickup_location: pickupLocation,
            is_anonymous: isAnonymous,
            expires_at: expiresAt,
          },
        ])
        .select("id")
        .single();

      if (error || !created?.id) throw error;

      const itemId = created.id;

      /* PHOTO UPLOAD */
      if (file) {
        const ext = getExt(file.name);
        const path = `items/${userId}/${itemId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("item-photos")
          .upload(path, file);

        if (!uploadErr) {
          const { data: pub } = supabase.storage
            .from("item-photos")
            .getPublicUrl(path);

          await supabase
            .from("items")
            .update({ photo_url: pub.publicUrl })
            .eq("id", itemId);
        }
      }

      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  /* =======================
     UI
  ======================= */

  if (authLoading || profileLoading) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  if (!isAllowed || !userId) {
    return (
      <div style={{ padding: 24 }}>
        <h1>List New Item</h1>
        <p>You must log in with @ashland.edu</p>
        <button onClick={() => router.push("/me")}>
          Go to Account
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>
        List New Item
      </h1>

      {!profileComplete && (
        <div style={{ marginBottom: 16, color: "#facc15" }}>
          ⚠️ Complete your profile before posting.
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          placeholder="Item title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <textarea
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <button type="submit" disabled={saving}>
          {saving ? "Posting…" : "Post Item"}
        </button>

        {msg && <p style={{ color: "red" }}>{msg}</p>}
      </form>
    </div>
  );
}