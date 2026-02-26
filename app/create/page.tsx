"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function computeExpiry(choice: ExpireChoice) {
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

export default function CreatePage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);

  // auth
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // profile
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // post type
  const [postType, setPostType] = useState<PostType>("give");

  // shared
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

  // lightweight options (collapsed by default)
  const [showOptions, setShowOptions] = useState(false);
  const [hideName, setHideName] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

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

  // UX: if switching to request, reset photo state + tighten expiry choice
  useEffect(() => {
    if (postType === "request") {
      setFile(null);
      setPreviewUrl(null);
      if (expireChoice === "never") setExpireChoice("7");
    }
    setMsg(null);
  }, [postType]); // eslint-disable-line react-hooks/exhaustive-deps

  // preview
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 1) auth
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

  // 2) profile check
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

  function validate(): string | null {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";
    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";

    // ✅ MAKE PHOTO COMPULSORY FOR GIVE
    if (postType === "give" && !file) return "Photo is required for items. Please add a photo.";
    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `Photo too large (max ${MAX_PHOTO_MB}MB).`;
      if (!isAllowedImage(file)) return "Upload JPG, PNG, or WEBP (HEIC not supported yet).";
    }

    return null;
  }

  const canSubmit = useMemo(() => {
    if (!isAllowed || !userId) return false;
    if (!profileComplete) return false;
    if (cleanTitle.length < 3) return false;

    // ✅ required photo for give
    if (postType === "give" && !file) return false;

    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return false;
      if (!isAllowedImage(file)) return false;
    }

    return true;
  }, [isAllowed, userId, profileComplete, cleanTitle, postType, file]);

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

      const baseInsert: any = {
        owner_id: userId,
        title: cleanTitle,
        description: cleanDesc,
        status: "available",
        is_anonymous: hideName,
        until_cancel: untilCancel,
        expires_at: expiresAt,
        photo_url: null,
        post_type: postType,
      };

      if (postType === "give") {
        baseInsert.category = giveCategory;
        baseInsert.pickup_location = pickupLocation;
        baseInsert.request_group = null;
        baseInsert.request_timeframe = null;
        baseInsert.request_location = null;
      } else {
        baseInsert.category = "others";
        baseInsert.pickup_location = null;
        baseInsert.request_group = requestGroup;
        baseInsert.request_timeframe = requestTimeframe;
        baseInsert.request_location = requestLocation.trim().length ? requestLocation.trim() : null;
      }

      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([baseInsert])
        .select("id")
        .single();

      if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create post.");

      const itemId = created.id as string;

      // Requests: no photo step
      if (postType === "request") {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // Give: photo REQUIRED (validated already)
      const ext = getExt(file!.name);
      const path = `items/${userId}/${itemId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("item-photos").upload(path, file!, {
        cacheControl: "3600",
        upsert: false,
        contentType: file!.type || undefined,
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

  // Loading
  if (authLoading || profileLoading) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Loading…</div>;
  }

  // Not allowed
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

  // Profile incomplete
  if (!profileComplete) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ fontSize: 34, fontWeight: 900, marginBottom: 10 }}>Complete Profile</h1>
        <p style={{ opacity: 0.85, marginTop: 0 }}>
          Before posting, add your <b>full name</b> and choose <b>Student/Faculty</b>.
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

  const pageTitle = postType === "give" ? "List an item" : "Post a request";
  const helperText =
    postType === "give"
      ? "Add a clear title + photo. People respond faster when they see it."
      : "Ask for what you need. Keep it specific — you’ll connect in Messages.";

  const primaryButton = postType === "give" ? "Post item" : "Post request";

  const stickyHint =
    cleanTitle.length < 3
      ? "Write a clearer title to post."
      : postType === "give"
        ? file
          ? "Photo added — ready to post."
          : "Add a photo to post."
        : "Ready to post.";

  // styles: flatter, less boxed
  const card: React.CSSProperties = {
    border: "1px solid #1f2937",
    borderRadius: 14,
    background: "#0b0b0b",
    padding: 14,
  };

  const input: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #2b2b2b",
    background: "#111",
    color: "white",
    outline: "none",
  };

  const label: React.CSSProperties = { fontWeight: 900, marginBottom: 8 };

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

      <h1 style={{ fontSize: 30, fontWeight: 950, marginBottom: 6 }}>{pageTitle}</h1>
      <p style={{ marginTop: 0, marginBottom: 14, opacity: 0.8, maxWidth: 520 }}>{helperText}</p>

      {/* Toggle */}
      <div style={{ maxWidth: 520, marginBottom: 12, display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => setPostType("give")}
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid #1f2937",
            background: postType === "give" ? "#052e16" : "#0b0b0b",
            color: "white",
            fontWeight: 950,
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
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid #1f2937",
            background: postType === "request" ? "#052e16" : "#0b0b0b",
            color: "white",
            fontWeight: 950,
            cursor: "pointer",
          }}
        >
          Request
        </button>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}
      >
        {/* Core fields */}
        <div style={card}>
          <div style={label}>Title</div>
          <input
            type="text"
            placeholder={postType === "give" ? 'Example: "Bedford Handbook (good condition)"' : 'Example: "Need a ride Friday 6am"'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ ...input, width: "100%" }}
          />

          <div style={{ ...label, marginTop: 12 }}>Details (optional)</div>
          <textarea
            placeholder={postType === "give" ? "What’s included? any flaws?" : "Where/when/how urgent? Keep it simple."}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...input, width: "100%", resize: "vertical" }}
          />
        </div>

        {/* Give: photo REQUIRED */}
        {postType === "give" && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <div style={label}>Photo <span style={{ color: "#22c55e" }}>(required)</span></div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>JPG / PNG / WEBP • max {MAX_PHOTO_MB}MB</div>
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
                  border: "1px solid #1f2937",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: 240,
                  borderRadius: 12,
                  border: "1px dashed #374151",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#9ca3af",
                }}
              >
                Add a photo to post
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
                  border: "1px solid #374151",
                  padding: "8px 12px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Remove photo
              </button>
            )}
          </div>
        )}

        {/* Give: essentials */}
        {postType === "give" && (
          <div style={card}>
            <div style={label}>Category</div>
            <select
              value={giveCategory}
              onChange={(e) => setGiveCategory(e.target.value as GiveCategory)}
              style={{ ...input, width: "100%", background: "#0b0b0b" }}
            >
              <option value="books">Books</option>
              <option value="notes">Notes</option>
              <option value="electronics">Electronics</option>
              <option value="furniture">Furniture</option>
              <option value="clothing">Clothing</option>
              <option value="sport equipment">Sport equipment</option>
              <option value="stationary item">Stationary item</option>
              <option value="health & beauty">Health & Beauty</option>
              <option value="home & kitchen">Home & Kitchen</option>
              <option value="musical instruments">Musical Instruments</option>
              <option value="jeweleries">Jeweleries</option>
              <option value="art pieces">Art pieces</option>
              <option value="ride">Ride</option>
              <option value="others">Others</option>
            </select>

            <div style={{ ...label, marginTop: 12 }}>Pickup spot</div>
            <select
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value as PickupLocation)}
              style={{ ...input, width: "100%", background: "#0b0b0b" }}
            >
              <option value="College Quad">College Quad</option>
              <option value="Safety Service Office">Safety Service Office</option>
              <option value="Dining Hall">Dining Hall</option>
            </select>
          </div>
        )}

        {/* Request: essentials */}
        {postType === "request" && (
          <div style={card}>
            <div style={label}>Request type</div>
            <select
              value={requestGroup}
              onChange={(e) => setRequestGroup(e.target.value as RequestGroup)}
              style={{ ...input, width: "100%", background: "#0b0b0b" }}
            >
              <option value="logistics">Logistics (ride / moving / borrow)</option>
              <option value="services">Services (tutoring / tech help / haircut)</option>
              <option value="urgent">Urgent (charger / calculator / meds)</option>
              <option value="collaboration">Collaboration (club / hackathon / project)</option>
            </select>

            <div style={{ ...label, marginTop: 12 }}>Timeframe</div>
            <select
              value={requestTimeframe}
              onChange={(e) => setRequestTimeframe(e.target.value as RequestTimeframe)}
              style={{ ...input, width: "100%", background: "#0b0b0b" }}
            >
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="flexible">Flexible</option>
            </select>

            <div style={{ ...label, marginTop: 12 }}>Location (optional)</div>
            <input
              type="text"
              placeholder='Example: "Dorm A" or "Near dining hall"'
              value={requestLocation}
              onChange={(e) => setRequestLocation(e.target.value)}
              style={{ ...input, width: "100%" }}
            />
          </div>
        )}

        {/* Collapsible options: reduces perceived work */}
        <div style={card}>
          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            style={{
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              color: "white",
              cursor: "pointer",
              fontWeight: 950,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>More options</span>
            <span style={{ opacity: 0.7 }}>{showOptions ? "−" : "+"}</span>
          </button>

          {showOptions && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={label}>Hide my name</div>
                <button
                  type="button"
                  onClick={() => setHideName((v) => !v)}
                  style={{
                    width: "100%",
                    padding: "12px 12px",
                    borderRadius: 12,
                    border: "1px solid #374151",
                    background: hideName ? "#052e16" : "transparent",
                    color: "white",
                    fontWeight: 950,
                    cursor: "pointer",
                  }}
                >
                  {hideName ? "Hidden: ON" : "Hidden: OFF"}
                </button>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                  When ON, your name won’t show on the feed.
                </div>
              </div>

              <div>
                <div style={label}>Automatically close after</div>
                <select
                  value={expireChoice}
                  onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}
                  style={{ ...input, width: "100%", background: "#0b0b0b" }}
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
            </div>
          )}
        </div>

        {msg && <p style={{ color: "#f87171", margin: 0 }}>{msg}</p>}
      </form>

      {/* Sticky submit */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: NAV_APPROX_HEIGHT,
          height: STICKY_BAR_HEIGHT,
          background: "rgba(0,0,0,0.92)",
          borderTop: "1px solid #1f2937",
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
            onClick={() => formRef.current?.requestSubmit()}
            disabled={saving || !canSubmit}
            style={{
              background: saving || !canSubmit ? "#14532d" : "#16a34a",
              padding: "12px 16px",
              borderRadius: 14,
              border: "none",
              color: "white",
              cursor: saving || !canSubmit ? "not-allowed" : "pointer",
              opacity: saving || !canSubmit ? 0.6 : 1,
              fontWeight: 950,
              minWidth: 150,
            }}
          >
            {saving ? "Posting…" : primaryButton}
          </button>
        </div>
      </div>
    </div>
  );
}