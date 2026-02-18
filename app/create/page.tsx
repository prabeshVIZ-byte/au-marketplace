"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "jpg";
}

function isImage(file: File) {
  return file.type.startsWith("image/");
}

export default function CreatePage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  // Keep auth synced + kick signed-out users
  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        setUserId(null);
        setUserEmail(null);
        router.push("/feed");
        router.refresh();
        return;
      }

      const session = data.session;
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;

      if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
        setUserId(null);
        setUserEmail(null);
        router.push("/feed");
        router.refresh();
        return;
      }

      setUserId(uid);
      setUserEmail(email);
    }

    syncAuth();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // preview for image
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

    if (!isLoggedIn || !userId) {
      router.push("/feed");
      return;
    }

    if (!title.trim() || !description.trim()) {
      setMsg("Fill both title and description.");
      return;
    }

    if (file && !isImage(file)) {
      setMsg("Please upload an image file (jpg/png/webp).");
      return;
    }

    setSaving(true);

    // 1) Create the item row
    const { data: created, error: createErr } = await supabase
      .from("items")
      .insert([
        {
          owner_id: userId,
          title: title.trim(),
          description: description.trim(),
          status: "available",
        },
      ])
      .select("id")
      .single();

    if (createErr || !created?.id) {
      setSaving(false);
      setMsg(createErr?.message || "Failed to create item.");
      return;
    }

    const itemId = created.id as string;

    // 2) If no photo, redirect to detail page
    if (!file) {
      setSaving(false);
      router.push(`/item/${itemId}`);
      return;
    }

    // 3) Upload photo to Storage
    const ext = getExt(file.name);
    const path = `${itemId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("item-photos")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

    if (uploadErr) {
      setSaving(false);
      setMsg(`Item posted, but photo upload failed: ${uploadErr.message}`);
      return;
    }

    // 4) Public URL for displaying the image
    const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    // 5) Save photo in TWO places:
    //    A) items.photo_url (so feed/detail can show it immediately)
    //    B) item_photos row (so later you can support multiple photos)
    const [{ error: updateItemErr }, { error: insertPhotoErr }] = await Promise.all([
      supabase.from("items").update({ photo_url: publicUrl }).eq("id", itemId),
      supabase.from("item_photos").insert([
        {
          item_id: itemId,
          owner_id: userId,
          photo_url: publicUrl,
          storage_path: path,
        },
      ]),
    ]);

    setSaving(false);

    if (updateItemErr) {
      setMsg(`Item posted, but could not save photo URL: ${updateItemErr.message}`);
      return;
    }

    // If your item_photos table doesn't have these columns, this will error.
    // In that case: open item_photos table and confirm column names, then rename here.
    if (insertPhotoErr) {
      setMsg(
        `Item posted + photo uploaded, but item_photos insert failed: ${insertPhotoErr.message}`
      );
      // Still redirect to detail because the image is saved on items.photo_url
      router.push(`/item/${itemId}`);
      return;
    }

    // 6) Success → go to the new item page
    router.push(`/item/${itemId}`);
  }

  if (!isLoggedIn) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Checking access…
      </div>
    );
  }

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
          placeholder="Description"
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