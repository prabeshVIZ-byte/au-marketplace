"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function isImage(file: File) {
  return file.type?.startsWith("image/");
}

type ProfileRow = { full_name: string | null; user_role: string | null };

export default function CreatePage() {
  const router = useRouter();

  // auth state
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // profile gate
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileChecking, setProfileChecking] = useState(true);

  // form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  async function checkProfile(uid: string) {
    setProfileChecking(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,user_role")
      .eq("id", uid)
      .single();

    setProfileChecking(false);

    if (error) {
      console.log("profile check error:", error.message);
      setProfileComplete(false);
      return;
    }

    const p = data as ProfileRow;
    const full = (p?.full_name ?? "").trim().length > 0;
    const roleOk = p?.user_role === "student" || p?.user_role === "faculty";
    setProfileComplete(full && roleOk);
  }

  // 1) Sync auth state
  useEffect(() => {
    let mounted = true;

    async function sync() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) console.log("getSession error:", error.message);

      const session = data.session;
      const e = session?.user?.email ?? null;
      const uid = session?.user?.id ?? null;

      setEmail(e);
      setUserId(uid);
      setAuthLoading(false);

      if (uid) {
        await checkProfile(uid);
      } else {
        setProfileComplete(false);
        setProfileChecking(false);
      }
    }

    sync();
    const { data: sub } = supabase.auth.onAuthStateChange(() => sync());

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) Image preview
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 3) Submit handler
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Always re-check session at submit time
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setMsg(error.message);
      return;
    }

    const session = data.session;
    const userEmail = session?.user?.email ?? null;
    const uid = session?.user?.id ?? null;

    // Must be logged in + ashland email
    if (!session || !userEmail || !uid || !userEmail.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    // Must have completed profile
    await checkProfile(uid);
    if (!profileComplete) {
      setMsg("Please complete your profile (full name + Student/Faculty) before posting.");
      router.push("/me");
      return;
    }

    // Validate fields
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

    setSaving(true);

    try {
      // A) Create item (IMPORTANT: owner_id included)
      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([
          {
            title: cleanTitle,
            description: cleanDesc,
            status: "available",
            photo_url: null,
            owner_id: uid, // <-- required for RLS/ownership
          },
        ])
        .select("id")
        .single();

      if (createErr || !created?.id) {
        throw new Error(createErr?.message || "Failed to create item.");
      }

      const itemId = created.id as string;

      // B) If no photo -> go to item page
      if (!file) {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // C) Upload to Storage
      const ext = getExt(file.name);
      const path = `items/${uid}/${itemId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("item-photos")
        .upload(path, file, {
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

      // D) Public URL
      const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // E) Save to items.photo_url
      const { error: updateErr } = await supabase.from("items").update({ photo_url: publicUrl }).eq("id", itemId);

      if (updateErr) {
        setMsg(`Photo uploaded, but items.photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // Done
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // UI states
  if (authLoading || profileChecking) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
  }

  if (!isAllowed) {
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
          Go to Login
        </button>
      </div>
    );
  }

  if (!profileComplete) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>Complete Profile</h1>
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
            padding: "10px 14px",
            borderRadius: 10,
            cursor: "pointer",
            fontWeight: 900,
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

          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ marginTop: 12 }} />

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