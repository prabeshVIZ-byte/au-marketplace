"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
type Condition = "new" | "like_new" | "good" | "fair";

const NAV_HEIGHT = 86; // adjust to your bottom nav height
const STICKY_BAR_HEIGHT = 74; // sticky Post bar height
const MAX_PHOTO_MB = 6;

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}
function isAllowedImage(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  return allowed.includes(file.type);
}
function clampText(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export default function CreatePage() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // core form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [category, setCategory] = useState<Category>("books");
  const [condition, setCondition] = useState<Condition>("good");

  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");
  const [availabilityNote, setAvailabilityNote] = useState(""); // when / meetup window

  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // optional “market price” (NOT what you charge; just reference)
  const [marketPrice, setMarketPrice] = useState(""); // store as numeric if your DB supports

  // photo
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanDesc = useMemo(() => {
    const d = description.trim();
    return d.length ? d : null;
  }, [description]);

  const cleanAvailability = useMemo(() => {
    const a = availabilityNote.trim();
    return a.length ? a : null;
  }, [availabilityNote]);

  const parsedMarketPrice = useMemo(() => {
    // empty => null
    const raw = marketPrice.trim();
    if (!raw) return null;

    // allow “20” or “20.50”
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return "INVALID";
    // avoid crazy values
    if (num > 100000) return "INVALID";
    return num;
  }, [marketPrice]);

  const canSubmit = useMemo(() => {
    if (!isAllowed || !userId) return false;
    if (!profileComplete) return false;
    if (cleanTitle.length < 3) return false;
    if (parsedMarketPrice === "INVALID") return false;
    if (file) {
      const tooBig = file.size > MAX_PHOTO_MB * 1024 * 1024;
      if (tooBig) return false;
      if (!isAllowedImage(file)) return false;
    }
    return true;
  }, [isAllowed, userId, profileComplete, cleanTitle, parsedMarketPrice, file]);

  // 1) Auth
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
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) Profile check
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
        .maybeSingle();

      if (!mounted) return;

      if (error) {
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

  // 3) preview
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function validateBeforeSubmit(): string | null {
    if (!isAllowed || !userId) return "You must be logged in with @ashland.edu.";
    if (!profileComplete) return "Please complete your profile first.";
    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
    if (parsedMarketPrice === "INVALID") return "Market price must be a valid number (e.g., 20 or 20.50).";
    if (file) {
      const tooBig = file.size > MAX_PHOTO_MB * 1024 * 1024;
      if (tooBig) return `Photo is too large. Max ${MAX_PHOTO_MB}MB.`;
      if (!isAllowedImage(file)) return "Please upload jpg/png/webp.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const errText = validateBeforeSubmit();
    if (errText) {
      setMsg(errText);
      if (!isAllowed || !userId || !profileComplete) router.push("/me");
      return;
    }

    const expiresAt =
      expireChoice === "never"
        ? null
        : new Date(Date.now() + Number(expireChoice) * 24 * 60 * 60 * 1000).toISOString();

    setSaving(true);

    try {
      /**
       * IMPORTANT DB NOTE:
       * This code assumes your "items" table has these columns:
       * - user_id (uuid)      <-- REQUIRED to enforce ownership + RLS
       * - condition (text)
       * - availability_note (text, nullable)
       * - market_price (numeric, nullable)  <-- optional reference price
       *
       * If your table does NOT have them, you must add them or remove from insert.
       */
      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([
          {
            user_id: userId, // ✅ OWNER — do not skip this
            title: cleanTitle,
            description: cleanDesc,
            status: "available",
            photo_url: null,
            category,
            condition,
            pickup_location: pickupLocation,
            availability_note: cleanAvailability,
            is_anonymous: isAnonymous,
            market_price: parsedMarketPrice === "INVALID" ? null : parsedMarketPrice, // should never be INVALID here
            expires_at: expiresAt,
          },
        ])
        .select("id")
        .single();

      if (createErr || !created?.id) {
        throw new Error(createErr?.message || "Failed to create item.");
      }

      const itemId = created.id as string;

      // No photo → go to item page
      if (!file) {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // Upload photo
      const ext = getExt(file.name);
      const path = `items/${userId}/${itemId}/${crypto.randomUUID()}.${ext}`;

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

      const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updateErr } = await supabase.from("items").update({ photo_url: publicUrl }).eq("id", itemId);
      if (updateErr) {
        setMsg(`Photo uploaded, but items.photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // Optional: save photo metadata
      const { error: photoErr } = await supabase.from("item_photos").insert([
        { item_id: itemId, photo_url: publicUrl, storage_path: path },
      ]);
      if (photoErr) console.log("item_photos insert failed:", photoErr.message);

      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // UI states
  if (authLoading || profileLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Loading…
      </div>
    );
  }

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

  // Form UI
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        padding: 24,
        // ✅ make room for BOTH sticky post bar + bottom nav
        paddingBottom: NAV_HEIGHT + STICKY_BAR_HEIGHT + 28,
      }}
    >
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

      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 6 }}>List New Item</h1>
      <p style={{ marginTop: 0, marginBottom: 14, opacity: 0.82, maxWidth: 520 }}>
        Tip: clear title + photo = more replies. This is a <b>free exchange</b>; you can optionally add a <b>market price</b> for context.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
        {/* TITLE */}
        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Title</div>
          <input
            type="text"
            placeholder='Example: "Calculus Textbook (good condition)"'
            value={title}
            onChange={(e) => setTitle(clampText(e.target.value, 80))}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #333",
              background: "#111",
              color: "white",
              outline: "none",
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{cleanTitle.length}/80</div>
        </div>

        {/* DESCRIPTION */}
        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Description (optional)</div>
          <textarea
            placeholder="What is it? Any flaws? What’s included?"
            rows={4}
            value={description}
            onChange={(e) => setDescription(clampText(e.target.value, 600))}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #333",
              background: "#111",
              color: "white",
              outline: "none",
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{description.length}/600</div>
        </div>

        {/* CATEGORY */}
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
            <option value="electronics">Electronics</option>
            <option value="furniture">Furniture</option>
            <option value="health & beauty">Health & Beauty</option>
            <option value="home & kitchen">Home & Kitchen</option>
            <option value="jeweleries">Jeweleries</option>
            <option value="musical instruments">Musical Instruments</option>
            <option value="clothing">Clothing</option>
            <option value="sport equipment">Sport equipment</option>
            <option value="stationary item">Stationary item</option>
            <option value="ride">Ride</option>
            <option value="books">Books</option>
            <option value="notes">Notes</option>
            <option value="art pieces">Art pieces</option>
            <option value="others">Others</option>
          </select>
        </div>

        {/* CONDITION */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Condition</div>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as Condition)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          >
            <option value="new">New</option>
            <option value="like_new">Like new</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
          </select>
        </div>

        {/* MARKET PRICE (OPTIONAL) */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Market price (optional)</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Not what you charge — just a reference so people know what it’s worth.
          </div>
          <input
            inputMode="decimal"
            placeholder="Example: 40"
            value={marketPrice}
            onChange={(e) => setMarketPrice(e.target.value)}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          />
          {parsedMarketPrice === "INVALID" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>
              Enter a valid number (e.g., 20 or 20.50).
            </div>
          )}
        </div>

        {/* PICKUP */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Pickup location</div>
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

        {/* AVAILABILITY */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Availability (optional)</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Reduce back-and-forth. Example: “Today after 6pm” or “Weekdays 2–5”.
          </div>
          <input
            type="text"
            placeholder='Example: "Weekdays after 4pm"'
            value={availabilityNote}
            onChange={(e) => setAvailabilityNote(clampText(e.target.value, 120))}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{availabilityNote.length}/120</div>
        </div>

        {/* ANONYMOUS */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Post anonymously</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Your name is hidden from others, but your Ashland login is still verified.
          </div>
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
        </div>

        {/* EXPIRES */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Auto-archive</div>
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
        </div>

        {/* PHOTO */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Photo (optional)</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
            Photos usually get more replies. (Max {MAX_PHOTO_MB}MB, jpg/png/webp)
          </div>

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
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setMsg(null);
              if (!f) {
                setFile(null);
                return;
              }
              const tooBig = f.size > MAX_PHOTO_MB * 1024 * 1024;
              if (tooBig) {
                setFile(null);
                setMsg(`Photo is too large. Max ${MAX_PHOTO_MB}MB.`);
                return;
              }
              if (!isAllowedImage(f)) {
                setFile(null);
                setMsg("Please upload jpg/png/webp.");
                return;
              }
              setFile(f);
            }}
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

        {/* NOTE: actual submit button is in sticky bar below to avoid bottom-nav overlap */}
      </form>

      {/* ✅ Sticky submit bar (solves overlap + boosts conversion) */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: NAV_HEIGHT, // sits ABOVE your bottom nav
          height: STICKY_BAR_HEIGHT,
          background: "rgba(0,0,0,0.92)",
          borderTop: "1px solid #0f223f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 16px",
          zIndex: 50,
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 520, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 12, opacity: 0.75 }}>
            {cleanTitle.length < 3 ? "Add a clearer title to post." : "Ready to post. You can edit later."}
          </div>

          <button
            onClick={(e) => {
              // submit the form programmatically
              const form = document.querySelector("form");
              if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }}
            disabled={saving || !canSubmit}
            style={{
              background: saving || !canSubmit ? "#14532d" : "#16a34a",
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              color: "white",
              cursor: saving || !canSubmit ? "not-allowed" : "pointer",
              opacity: saving || !canSubmit ? 0.6 : 1,
              fontWeight: 900,
              minWidth: 140,
            }}
          >
            {saving ? "Posting…" : "Post Item"}
          </button>
        </div>
      </div>
    </div>
  );
}