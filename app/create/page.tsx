"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PostType = "give" | "request";

type GiveCategory =
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

type RequestGroup = "logistics" | "services" | "urgent" | "collaboration";
type RequestTimeframe = "today" | "this_week" | "flexible";

type PickupLocation = "College Quad" | "Safety Service Office" | "Dining Hall";
type ExpireChoice = "7" | "14" | "30" | "never" | "urgent24";

const NAV_APPROX_HEIGHT = 86;
const STICKY_BAR_HEIGHT = 74;
const MAX_PHOTO_MB = 6;

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function isAllowedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function addDaysISO(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default function CreatePage() {
  const router = useRouter();

  // auth
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // profile
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // post type
  const [postType, setPostType] = useState<PostType>("give");

  // shared fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // give-only
  const [giveCategory, setGiveCategory] = useState<GiveCategory>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // request-only
  const [requestGroup, setRequestGroup] = useState<RequestGroup>("logistics");
  const [requestTimeframe, setRequestTimeframe] = useState<RequestTimeframe>("today");
  const [requestLocation, setRequestLocation] = useState("");

  // shared controls
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7"); // for request, can be urgent24 too

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

  // If user switches to request, drop photo selection (keeps UX clean)
  useEffect(() => {
    if (postType === "request") {
      setFile(null);
      setPreviewUrl(null);
      // Make expiry default feel sensible for requests
      if (expireChoice === "never") setExpireChoice("7");
    }
  }, [postType]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = useMemo(() => {
    if (!isAllowed || !userId) return false;
    if (!profileComplete) return false;
    if (cleanTitle.length < 3) return false;

    // give-only photo validation
    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return false;
      if (!isAllowedImage(file)) return false;
    }

    return true;
  }, [isAllowed, userId, profileComplete, cleanTitle, postType, file]);

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
    const { data: sub } = supabase.auth.onAuthStateChange(() => syncAuth());

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

  // 3) preview (give only)
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function validate(): string | null {
    if (!isAllowed || !userId) return "You must log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Please complete your profile first.";
    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";

    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `Photo too large (max ${MAX_PHOTO_MB}MB).`;
      if (!isAllowedImage(file)) return "Please upload JPG, PNG, or WEBP (HEIC not supported yet).";
    }
    return null;
  }

  function computeExpiry(choice: ExpireChoice) {
    // until_cancel / expires_at logic (kept compatible with your current schema)
    const untilCancel = choice === "never";
    let expiresAt: string | null = null;

    if (choice === "urgent24") {
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return { untilCancel: false, expiresAt };
    }

    if (untilCancel) return { untilCancel: true, expiresAt: null };

    expiresAt = addDaysISO(Number(choice));
    return { untilCancel: false, expiresAt };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const err = validate();
    if (err) {
      setMsg(err);
      if (!isAllowed || !userId || !profileComplete) router.push("/me");
      return;
    }

    setSaving(true);

    try {
      const { untilCancel, expiresAt } = computeExpiry(expireChoice);

      // ✅ Core insert payload (same items table)
      const baseInsert: any = {
        owner_id: userId,
        title: cleanTitle,
        description: cleanDesc,
        status: "available",
        is_anonymous: isAnonymous,
        until_cancel: untilCancel,
        expires_at: expiresAt,
        photo_url: null,
        post_type: postType, // NEW COLUMN
      };

      if (postType === "give") {
        baseInsert.category = giveCategory;
        baseInsert.pickup_location = pickupLocation;
        // request-only columns left null
        baseInsert.request_group = null;
        baseInsert.request_timeframe = null;
        baseInsert.request_location = null;
      } else {
        // Requests do NOT need pickup_location; location is optional free text
        baseInsert.category = "others"; // keep schema happy if category is NOT nullable
        baseInsert.pickup_location = null;
        baseInsert.request_group = requestGroup; // NEW COLUMN
        baseInsert.request_timeframe = requestTimeframe; // NEW COLUMN
        baseInsert.request_location = requestLocation.trim().length ? requestLocation.trim() : null; // NEW COLUMN
      }

      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([baseInsert])
        .select("id")
        .single();

      if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create post.");
      const itemId = created.id as string;

      // If request, no photo step — go straight to detail page (or feed)
      if (postType === "request") {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // give: no photo
      if (!file) {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // give: upload photo
      const ext = getExt(file.name);
      const path = `items/${userId}/${itemId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("item-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

      if (uploadErr) {
        setMsg(`Posted, but photo upload failed: ${uploadErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      const { data: pub } = supabase.storage.from("item-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updateErr } = await supabase.from("items").update({ photo_url: publicUrl }).eq("id", itemId);

      if (updateErr) {
        setMsg(`Photo uploaded, but photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      const { error: photoErr } = await supabase
        .from("item_photos")
        .insert([{ item_id: itemId, photo_url: publicUrl, storage_path: path }]);
      if (photoErr) console.log("item_photos insert failed:", photoErr.message);

      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // UI loading states
  if (authLoading || profileLoading) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Loading…</div>;
  }

  if (!isAllowed || !userId) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>Post on ScholarSwap</h1>
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
          }}
        >
          Go to Profile Setup
        </button>
      </div>
    );
  }

  const pageTitle = postType === "give" ? "List New Item" : "Post a Request";
  const helperText =
    postType === "give"
      ? "This is a free exchange. Add a clear title and a photo to get faster replies."
      : "Ask for what you need. Keep it specific. You’ll connect through Messages.";

  const stickyHint =
    cleanTitle.length < 3
      ? "Add a clearer title to post."
      : postType === "give"
        ? "Ready to post — you’ll chat in Messages."
        : "Ready to post — someone can offer help in the feed.";

  const primaryButton = postType === "give" ? "Post Item" : "Post Request";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        padding: 24,
        paddingBottom: NAV_APPROX_HEIGHT + STICKY_BAR_HEIGHT + 24,
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

      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 6 }}>{pageTitle}</h1>
      <p style={{ marginTop: 0, marginBottom: 14, opacity: 0.82, maxWidth: 520 }}>{helperText}</p>

      {/* Post type toggle */}
      <div style={{ maxWidth: 520, marginBottom: 12 }}>
        <div
          style={{
            border: "1px solid #0f223f",
            borderRadius: 14,
            background: "#0b1730",
            padding: 10,
            display: "flex",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setPostType("give")}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: postType === "give" ? "#052e16" : "transparent",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Give
          </button>
          <button
            type="button"
            onClick={() => setPostType("request")}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #334155",
              background: postType === "request" ? "#052e16" : "transparent",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Request
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.72, marginTop: 8 }}>
          {postType === "give"
            ? "Post something you’re giving away."
            : "Post what you need — ride, help, services, urgent items, or collaboration."}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
        <input
          type="text"
          placeholder={
            postType === "give"
              ? 'Example: "Bedford Handbook (good condition)"'
              : 'Example: "Need a ride to the airport Friday 6am"'
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #333", background: "#111", color: "white" }}
        />

        <textarea
          placeholder={
            postType === "give"
              ? "Description (optional) — what’s included, any flaws?"
              : "Add details (where, when, how urgent). Keep it simple."
          }
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #333", background: "#111", color: "white" }}
        />

        {/* Give vs Request: category block */}
        {postType === "give" ? (
          <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Category</div>
            <select
              value={giveCategory}
              onChange={(e) => setGiveCategory(e.target.value as GiveCategory)}
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
        ) : (
          <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Request type</div>
            <select
              value={requestGroup}
              onChange={(e) => setRequestGroup(e.target.value as RequestGroup)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "black",
                color: "white",
              }}
            >
              <option value="logistics">Logistics (rides, moving, borrowing tools)</option>
              <option value="services">Services (tutoring, baking, haircut, tech help)</option>
              <option value="urgent">Urgent needs (charger, calculator, medicine)</option>
              <option value="collaboration">Community / collaboration (hackathon, cofounder, club help)</option>
            </select>

            <div style={{ marginTop: 12, fontWeight: 900, marginBottom: 8 }}>Timeframe</div>
            <select
              value={requestTimeframe}
              onChange={(e) => setRequestTimeframe(e.target.value as RequestTimeframe)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "black",
                color: "white",
              }}
            >
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="flexible">Flexible</option>
            </select>

            <div style={{ marginTop: 12, fontWeight: 900, marginBottom: 8 }}>Location (optional)</div>
            <input
              type="text"
              placeholder='Example: "Dorm A" or "Near dining hall"'
              value={requestLocation}
              onChange={(e) => setRequestLocation(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #333", background: "#111", color: "white" }}
            />
          </div>
        )}

        {/* Give-only pickup location */}
        {postType === "give" && (
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
        )}

        {/* Shared anonymous */}
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
        </div>

        {/* Auto-archive */}
        <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            Auto-archive {postType === "request" ? "(recommended)" : ""}
          </div>
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
            {postType === "request" && <option value="urgent24">Urgent (24 hours)</option>}
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="never">Until I cancel</option>
          </select>
          {postType === "request" && expireChoice === "urgent24" && (
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
              Urgent requests expire in 24 hours unless you repost.
            </div>
          )}
        </div>

        {/* Give-only photo */}
        {postType === "give" && (
          <div style={{ border: "1px solid #0f223f", borderRadius: 14, padding: 14, background: "#0b1730" }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Photo (optional)</div>

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
                setMsg(null);
                const f = e.target.files?.[0] ?? null;
                if (!f) return setFile(null);

                if (f.size > MAX_PHOTO_MB * 1024 * 1024) {
                  setFile(null);
                  setMsg(`Photo too large (max ${MAX_PHOTO_MB}MB).`);
                  return;
                }
                if (!isAllowedImage(f)) {
                  setFile(null);
                  setMsg("Upload JPG, PNG, or WEBP (HEIC not supported yet).");
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
        )}

        {msg && <p style={{ color: "#f87171", margin: 0 }}>{msg}</p>}
      </form>

      {/* Sticky submit bar above bottom nav */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: NAV_APPROX_HEIGHT,
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
          <div style={{ flex: 1, fontSize: 12, opacity: 0.75 }}>{stickyHint}</div>

          <button
            onClick={() => {
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
            {saving ? "Posting…" : primaryButton}
          </button>
        </div>
      </div>
    </div>
  );
}