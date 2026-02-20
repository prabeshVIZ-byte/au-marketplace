"use client";
export const dynamic = "force-dynamic";

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

export default function CreatePage() {
  const router = useRouter();

  // auth state
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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

  // 1) Sync auth state
  useEffect(() => {
    let mounted = true;

    async function sync() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) console.log("getSession error:", error.message);

      const session = data.session;
      setEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
      setAuthLoading(false);
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
      // A) Create item
      // If your DB trigger fills owner_id, we can omit it.
      // If not, you can safely include owner_id: uid (won’t hurt if trigger exists unless it blocks).
      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([
          {
            title: cleanTitle,
            description: cleanDesc,
            status: "available",
            photo_url: null,
            // owner_id: uid, // uncomment ONLY if your schema requires it and no trigger fills it
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
      // NOTE: this requires storage policy allowing authenticated upload.
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
        // item exists but photo failed
        setMsg(`Item posted, but photo upload failed: ${uploadErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // D) Get public URL (bucket must be PUBLIC)
      const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // E) Save to items.photo_url
      const { error: updateErr } = await supabase
        .from("items")
        .update({ photo_url: publicUrl })
        .eq("id", itemId);

      if (updateErr) {
        setMsg(`Photo uploaded, but items.photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // F) Optional: insert into item_photos (ONLY if your table has these columns)
      // If your item_photos columns differ, comment this block out.
      const { error: photoErr } = await supabase.from("item_photos").insert([
        {
          item_id: itemId,
          photo_url: publicUrl,
          storage_path: path,
          // owner_id: uid, // include if your schema has it
        },
      ]);

      if (photoErr) {
        // Not fatal. Feed still works via items.photo_url
        console.log("item_photos insert failed:", photoErr.message);
      }

      // G) Done
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // UI states
  if (authLoading) {
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