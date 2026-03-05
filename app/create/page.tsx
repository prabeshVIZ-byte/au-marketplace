"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * CREATE PAGE (Give / Request / Event) — rewritten to fix:
 * ✅ Post button not clickable (bottom nav overlay) via:
 *   - Real form submit button: <button type="submit" form="create-form" />
 *   - Sticky bar z-index 9999
 *   - Uses CSS var --bottom-nav-height (fallback 86px) so we DON'T guess
 * ✅ Cleaner auth + profile gating
 * ✅ Strict validation matching your rules
 * ✅ Safe datetime-local parsing (Safari-safe)
 * ✅ Storage upload + public URL update
 *
 * IMPORTANT:
 * - Set your bottom nav container id="bottom-nav" AND update CSS variable:
 *   document.documentElement.style.setProperty("--bottom-nav-height", `${el.offsetHeight}px`)
 *   (code snippet included below in comments)
 */

type Mode = "give" | "request" | "event";
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

type PickupLocation = "College Quad" | "Safety Service Office" | "Dining Hall";

type RequestGroup = "logistics" | "services" | "urgent" | "collaboration";
type RequestTimeframe = "today" | "this_week" | "flexible";

type EventCategory =
  | "career"
  | "club"
  | "sports"
  | "music"
  | "arts"
  | "volunteering"
  | "academic"
  | "social"
  | "other";

type ExpireChoice = "7" | "14" | "30" | "never" | "urgent24";

const ITEMS_TABLE = "items";
const ITEM_PHOTOS_TABLE = "item_photos";
const EVENTS_TABLE = "events";

const ITEM_PHOTOS_BUCKET = "item-photos";
const EVENT_FLYERS_BUCKET = "event-flyers";

const MAX_ITEM_PHOTO_MB = 6;
const MAX_EVENT_FLYER_MB = 8;

// sticky bar height
const STICKY_BAR_HEIGHT = 74;

// route
const EVENT_SUCCESS_ROUTE = "/feed";

// ---------------- utils ----------------
function isAllowedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function getExt(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function uuidSafe() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function addDaysISO(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function computeExpiry(choice: ExpireChoice) {
  if (choice === "urgent24") return { untilCancel: false, expiresAt: addDaysISO(1) };
  if (choice === "never") return { untilCancel: true, expiresAt: null as string | null };
  return { untilCancel: false, expiresAt: addDaysISO(Number(choice)) };
}

function isValidHttpUrlMaybeEmpty(raw: string) {
  const v = raw.trim();
  if (!v) return true;
  return /^https?:\/\//i.test(v);
}

/**
 * Safari-safe datetime-local -> ISO
 */
function localDateTimeToISO(localValue: string) {
  if (!localValue) return null;
  const m = localValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);

  const dt = new Date(y, mo - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// ---------------- main ----------------
export default function CreatePage() {
  const router = useRouter();

  // form + file inputs
  const formRef = useRef<HTMLFormElement | null>(null);
  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  // auth + profile
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);

  // mode
  const [mode, setMode] = useState<Mode>("give");

  // shared fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // give
  const [giveCategory, setGiveCategory] = useState<GiveCategory>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreviewUrl, setItemPreviewUrl] = useState<string | null>(null);

  // request
  const [requestGroup, setRequestGroup] = useState<RequestGroup>("logistics");
  const [requestTimeframe, setRequestTimeframe] = useState<RequestTimeframe>("today");
  const [requestLocation, setRequestLocation] = useState("");

  // event
  const [eventCategory, setEventCategory] = useState<EventCategory>("club");
  const [eventLocation, setEventLocation] = useState("");
  const [hostOrg, setHostOrg] = useState("");
  const [eventLink, setEventLink] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [eventPreviewUrl, setEventPreviewUrl] = useState<string | null>(null);

  // options
  const [showOptions, setShowOptions] = useState(false);
  const [hideName, setHideName] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // derived
  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanDesc = useMemo(() => description.trim(), [description]);

  const startIso = useMemo(() => localDateTimeToISO(startLocal), [startLocal]);
  const endIso = useMemo(() => localDateTimeToISO(endLocal), [endLocal]);

  const isAshland = useMemo(() => !!email && email.toLowerCase().endsWith("@ashland.edu"), [email]);
  const isLoggedIn = !!userId && !!email && isAshland;

  // clear messages when switching mode
  useEffect(() => {
    setMsg(null);
  }, [mode]);

  // preview URLs
  useEffect(() => {
    if (!itemFile) {
      setItemPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(itemFile);
    setItemPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [itemFile]);

  useEffect(() => {
    if (!eventFile) {
      setEventPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(eventFile);
    setEventPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [eventFile]);

  // set bottom nav height css variable (fallback if bottom nav exists)
  useEffect(() => {
    const update = () => {
      const el = document.getElementById("bottom-nav");
      if (!el) return;
      document.documentElement.style.setProperty("--bottom-nav-height", `${el.offsetHeight}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // auth
  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      setAuthLoading(true);
      try {
        const timeoutMs = 6500;
        const raced = await Promise.race([
          supabase.auth.getSession(),
          new Promise<any>((resolve) =>
            setTimeout(() => resolve({ data: { session: null }, error: { message: "Auth timeout" } }), timeoutMs)
          ),
        ]);

        if (!mounted) return;
        const { data, error } = raced;

        if (error) console.log("getSession:", error?.message ?? error);

        const session = data?.session ?? null;
        setEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      } catch (e: any) {
        console.log("syncAuth error:", e?.message ?? e);
        if (!mounted) return;
        setEmail(null);
        setUserId(null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    syncAuth();
    const { data: sub } = supabase.auth.onAuthStateChange(() => syncAuth());

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // profile check
  useEffect(() => {
    let mounted = true;

    async function checkProfile() {
      setProfileLoading(true);
      setProfileComplete(false);

      if (!userId) {
        setProfileLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", userId)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          console.log("profile check error:", error.message);
          setProfileComplete(false);
          return;
        }

        const fullNameOk = (data?.full_name ?? "").trim().length > 0;
        const roleOk = data?.user_role === "student" || data?.user_role === "faculty";
        setProfileComplete(fullNameOk && roleOk);
      } finally {
        if (mounted) setProfileLoading(false);
      }
    }

    checkProfile();
    return () => {
      mounted = false;
    };
  }, [userId]);

  // file pickers
  function pickItemFile(f: File | null) {
    setMsg(null);
    if (!f) return setItemFile(null);
    if (!isAllowedImage(f)) return setMsg("Upload JPG, PNG, or WEBP.");
    if (f.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) return setMsg(`Photo too large (max ${MAX_ITEM_PHOTO_MB}MB).`);
    setItemFile(f);
  }

  function pickEventFile(f: File | null) {
    setMsg(null);
    if (!f) return setEventFile(null);
    if (!isAllowedImage(f)) return setMsg("Flyer must be JPG, PNG, or WEBP.");
    if (f.size > MAX_EVENT_FLYER_MB * 1024 * 1024) return setMsg(`Flyer too large (max ${MAX_EVENT_FLYER_MB}MB).`);
    setEventFile(f);
  }

  function validate(): string | null {
    if (!isLoggedIn) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";

    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
    if (cleanDesc.length < 3) return "Description is required.";

    if (mode === "give") {
      if (!itemFile) return "Photo is required for Give posts.";
      if (!giveCategory) return "Category is required.";
      if (!pickupLocation) return "Pickup spot is required.";
      return null;
    }

    if (mode === "request") {
      if (!requestGroup) return "Request type is required.";
      if (!requestTimeframe) return "Timeframe is required.";
      return null;
    }

    // event
    if (!eventCategory) return "Event category is required.";
    if (!hostOrg.trim()) return "Host Club/Organisation is required.";
    if (!eventLocation.trim()) return "Location is required.";
    if (!startIso) return "Start time is required.";
    if (!isValidHttpUrlMaybeEmpty(eventLink)) return "Link must start with http:// or https:// (or leave it empty).";
    if (endIso && startIso && new Date(endIso).getTime() < new Date(startIso).getTime())
      return "End time cannot be before start time.";
    return null;
  }

  const canSubmit = useMemo(() => {
    if (!isLoggedIn) return false;
    if (!profileComplete) return false;
    if (cleanTitle.length < 3) return false;
    if (cleanDesc.length < 3) return false;

    if (mode === "give") {
      if (!itemFile) return false;
      if (!giveCategory) return false;
      if (!pickupLocation) return false;
      if (!isAllowedImage(itemFile)) return false;
      if (itemFile.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) return false;
      return true;
    }

    if (mode === "request") {
      if (!requestGroup) return false;
      if (!requestTimeframe) return false;
      return true;
    }

    // event
    if (!eventCategory) return false;
    if (!hostOrg.trim()) return false;
    if (!eventLocation.trim()) return false;
    if (!startIso) return false;
    if (!isValidHttpUrlMaybeEmpty(eventLink)) return false;

    if (eventFile) {
      if (!isAllowedImage(eventFile)) return false;
      if (eventFile.size > MAX_EVENT_FLYER_MB * 1024 * 1024) return false;
    }

    if (endIso && startIso && new Date(endIso).getTime() < new Date(startIso).getTime()) return false;
    return true;
  }, [
    isLoggedIn,
    profileComplete,
    cleanTitle,
    cleanDesc,
    mode,
    itemFile,
    giveCategory,
    pickupLocation,
    requestGroup,
    requestTimeframe,
    eventCategory,
    hostOrg,
    eventLocation,
    startIso,
    endIso,
    eventLink,
    eventFile,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const v = validate();
    if (v) {
      setMsg(v);
      if (!isLoggedIn || !profileComplete) router.push("/me");
      return;
    }

    setSaving(true);

    try {
      // ===================== EVENT =====================
      if (mode === "event") {
        const insertRow: any = {
          created_by: userId,
          title: cleanTitle,
          description: cleanDesc,
          host_org: hostOrg.trim(),
          category: eventCategory,
          location: eventLocation.trim(),
          starts_at: startIso,
          ends_at: endIso ?? null,
          link_url: eventLink.trim() ? eventLink.trim() : null,
          photo_url: null,
          is_anonymous: hideName,
        };

        const { data: created, error: createErr } = await supabase
          .from(EVENTS_TABLE)
          .insert([insertRow])
          .select("id")
          .single();

        if (createErr || !created?.id)
          throw new Error(createErr?.message || "Failed to create event (RLS or schema mismatch).");

        const eventId = String(created.id);

        // optional flyer upload
        if (eventFile) {
          const ext = getExt(eventFile.name);
          const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

          const { error: upErr } = await supabase.storage.from(EVENT_FLYERS_BUCKET).upload(path, eventFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: eventFile.type || undefined,
          });

          if (upErr) {
            setMsg(`Event posted, but flyer upload failed: ${upErr.message}`);
            router.push(EVENT_SUCCESS_ROUTE);
            router.refresh();
            return;
          }

          const { data: pub } = supabase.storage.from(EVENT_FLYERS_BUCKET).getPublicUrl(path);
          const flyerPublicUrl = pub.publicUrl;

          const { error: updErr } = await supabase
            .from(EVENTS_TABLE)
            .update({ photo_url: flyerPublicUrl })
            .eq("id", eventId);

          if (updErr) setMsg(`Flyer uploaded, but photo_url update failed: ${updErr.message}`);
        }

        router.push(EVENT_SUCCESS_ROUTE);
        router.refresh();
        return;
      }

      // ===================== GIVE / REQUEST -> ITEMS =====================
      const postType: PostType = mode === "give" ? "give" : "request";
      const { untilCancel, expiresAt } = computeExpiry(expireChoice);

      const itemInsert: any = {
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
        itemInsert.category = giveCategory;
        itemInsert.pickup_location = pickupLocation;
        itemInsert.request_group = null;
        itemInsert.request_timeframe = null;
        itemInsert.request_location = null;
      } else {
        itemInsert.category = "others";
        itemInsert.pickup_location = null;
        itemInsert.request_group = requestGroup;
        itemInsert.request_timeframe = requestTimeframe;
        itemInsert.request_location = requestLocation.trim() ? requestLocation.trim() : null;
      }

      const { data: createdItem, error: createItemErr } = await supabase
        .from(ITEMS_TABLE)
        .insert([itemInsert])
        .select("id")
        .single();

      if (createItemErr || !createdItem?.id)
        throw new Error(createItemErr?.message || "Failed to create post (RLS or schema mismatch).");

      const itemId = String(createdItem.id);

      // request: no photo required
      if (postType === "request") {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // give: REQUIRED photo upload
      const ext = getExt(itemFile!.name);
      const path = `items/${userId}/${itemId}/${uuidSafe()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from(ITEM_PHOTOS_BUCKET).upload(path, itemFile!, {
        cacheControl: "3600",
        upsert: false,
        contentType: itemFile!.type || undefined,
      });

      if (uploadErr) {
        setMsg(`Posted, but photo upload failed: ${uploadErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      const { data: pub } = supabase.storage.from(ITEM_PHOTOS_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updateErr } = await supabase.from(ITEMS_TABLE).update({ photo_url: publicUrl }).eq("id", itemId);

      if (updateErr) {
        setMsg(`Photo uploaded, but photo_url update failed: ${updateErr.message}`);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // optional history table
      const { error: photoErr } = await supabase
        .from(ITEM_PHOTOS_TABLE)
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

  // ---------------- UI styles ----------------
  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f7f7f8",
    color: "#0f172a",
    padding: 18,
    // ✅ no guessing: uses CSS var (fallback 86px) + safe area
    paddingBottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + 74px + 24px)",
  };

  const shell: React.CSSProperties = { maxWidth: 760, margin: "0 auto" };

  const card: React.CSSProperties = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 10px 24px rgba(0,0,0,0.05)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fbfbfc",
    outline: "none",
    fontSize: 14,
  };

  const textarea: React.CSSProperties = { ...input, resize: "vertical", lineHeight: 1.35 };

  const select: React.CSSProperties = { ...input, background: "white", cursor: "pointer" };

  const row2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };

  const button: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "white",
    color: "#111827",
    padding: "10px 12px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 900,
  };

  const danger: React.CSSProperties = { ...button, borderColor: "#fecaca", color: "#b91c1c" };

  // ✅ sticky ALWAYS above nav
  const sticky: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px))",
    height: STICKY_BAR_HEIGHT,
    background: "rgba(247,247,248,0.90)",
    borderTop: "1px solid #e5e7eb",
    backdropFilter: "blur(10px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 16px",
    pointerEvents: "auto",
  };

  const stickyInner: React.CSSProperties = {
    width: "100%",
    maxWidth: 760,
    display: "flex",
    alignItems: "center",
    gap: 12,
  };

  const primary = (disabled: boolean): React.CSSProperties => ({
    border: "none",
    borderRadius: 16,
    padding: "12px 16px",
    minWidth: 160,
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    color: "white",
    background: disabled ? "#94a3b8" : "#10b981",
    boxShadow: disabled ? "none" : "0 14px 30px rgba(16,185,129,0.25)",
  });

  const helperText =
    mode === "give"
      ? "Give: title + description + photo + category + pickup spot."
      : mode === "request"
      ? "Request: title + description + request type + timeframe."
      : "Event: title + description + location + host + start time + category.";

  const primaryLabel = mode === "give" ? "Post item" : mode === "request" ? "Post request" : "Post event";

  const stickyHint = useMemo(() => {
    if (!isLoggedIn) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Finish profile setup in Account.";
    if (cleanTitle.length < 3) return "Add a clear title (3+).";
    if (cleanDesc.length < 3) return "Add a description.";

    if (mode === "give") {
      if (!itemFile) return "Give posts require a photo.";
      return "Ready to post Give.";
    }
    if (mode === "request") return "Ready to post Request.";

    if (!hostOrg.trim()) return "Add Host Club/Organisation.";
    if (!eventLocation.trim()) return "Add event location.";
    if (!startIso) return "Pick a start time.";
    if (!isValidHttpUrlMaybeEmpty(eventLink)) return "Fix link (http/https) or clear it.";
    return "Ready to post Event.";
  }, [isLoggedIn, profileComplete, cleanTitle, cleanDesc, mode, itemFile, hostOrg, eventLocation, startIso, eventLink]);

  // ---------------- gated screens ----------------
  if (authLoading || profileLoading) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Loading your account…</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
              If this hangs, check Supabase env vars and auth settings.
            </div>
            {msg && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 14,
                  border: "1px solid #fecdd3",
                  background: "#fff1f2",
                  color: "#9f1239",
                  fontWeight: 850,
                }}
              >
                {msg}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={card}>
            <div style={{ fontSize: 22, fontWeight: 950 }}>Post on ScholarSwap</div>
            <p style={{ color: "#4b5563" }}>
              You must log in with your <b>@ashland.edu</b> email.
            </p>
            {msg && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 14,
                  border: "1px solid #fecdd3",
                  background: "#fff1f2",
                  color: "#9f1239",
                  fontWeight: 850,
                }}
              >
                {msg}
              </div>
            )}
            <button onClick={() => router.push("/me")} style={{ ...button, marginTop: 12 }}>
              Go to Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profileComplete) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={card}>
            <div style={{ fontSize: 22, fontWeight: 950 }}>Complete Profile</div>
            <p style={{ color: "#4b5563" }}>Before posting, add your full name and pick Student/Faculty in Account.</p>
            <button onClick={() => router.push("/me")} style={{ ...primary(false), marginTop: 10 }}>
              Go to Profile Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- main render ----------------
  return (
    <div style={pageStyle}>
      <div style={shell}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button onClick={() => router.push("/feed")} style={{ ...button, borderRadius: 999 }}>
            ← Back
          </button>
          <div
            style={{
              fontSize: 12,
              color: "#374151",
              border: "1px solid #e5e7eb",
              background: "white",
              padding: "8px 10px",
              borderRadius: 999,
            }}
          >
            Posting as <b>{email}</b>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 22, fontWeight: 950 }}>Create</div>
          <div style={{ marginTop: 6, color: "#4b5563" }}>{helperText}</div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setMode("give")}
              style={{
                ...button,
                borderRadius: 999,
                background: mode === "give" ? "#111827" : "white",
                color: mode === "give" ? "white" : "#111827",
              }}
            >
              Give
            </button>
            <button
              type="button"
              onClick={() => setMode("request")}
              style={{
                ...button,
                borderRadius: 999,
                background: mode === "request" ? "#111827" : "white",
                color: mode === "request" ? "white" : "#111827",
              }}
            >
              Request
            </button>
            <button
              type="button"
              onClick={() => setMode("event")}
              style={{
                ...button,
                borderRadius: 999,
                background: mode === "event" ? "#111827" : "white",
                color: mode === "event" ? "white" : "#111827",
              }}
            >
              Event
            </button>
          </div>
        </div>

        {/* ✅ REAL FORM SUBMIT */}
        <form
          id="create-form"
          ref={formRef}
          onSubmit={handleSubmit}
          style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}
        >
          {/* TITLE */}
          <div style={card}>
            <div style={{ fontWeight: 950 }}>
              {mode === "give"
                ? "What are you giving away? (required)"
                : mode === "request"
                ? "What do you need? (required)"
                : "Event title (required)"}
            </div>
            <div style={{ marginTop: 10 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={input}
                placeholder={
                  mode === "give"
                    ? `Example: "Bedford Handbook (good condition)"`
                    : mode === "request"
                    ? `Example: "Need a ride Friday 6am"`
                    : `Example: "Finance Club Guest Speaker Night"`
                }
              />
            </div>
          </div>

          {/* DESCRIPTION */}
          <div style={card}>
            <div style={{ fontWeight: 950 }}>
              {mode === "give"
                ? "Any details someone should know? (required)"
                : mode === "request"
                ? "Add context so people can help fast. (required)"
                : "Short description (required)"}
            </div>
            <div style={{ marginTop: 10 }}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={textarea}
                rows={4}
                placeholder={
                  mode === "give"
                    ? "Condition, what's included, any flaws."
                    : mode === "request"
                    ? "Where/when/how urgent? Keep it simple."
                    : "What is it? Who is it for? Any key details."
                }
              />
            </div>
          </div>

          {/* GIVE */}
          {mode === "give" && (
            <>
              <div style={card}>
                <div style={{ fontWeight: 950 }}>Add a photo (required)</div>

                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    JPG / PNG / WEBP • max {MAX_ITEM_PHOTO_MB}MB
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      ref={itemFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => pickItemFile(e.target.files?.[0] ?? null)}
                      style={{ display: "none" }}
                    />
                    <button type="button" style={button} onClick={() => itemFileInputRef.current?.click()}>
                      {itemFile ? "Change" : "Choose"}
                    </button>
                    {itemFile && (
                      <button type="button" style={danger} onClick={() => setItemFile(null)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {itemPreviewUrl && (
                  <div style={{ marginTop: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={itemPreviewUrl}
                      alt="Item preview"
                      style={{
                        width: "100%",
                        height: 260,
                        objectFit: "cover",
                        borderRadius: 16,
                        border: "1px solid #e5e7eb",
                      }}
                    />
                  </div>
                )}
              </div>

              <div style={card}>
                <div style={{ fontWeight: 950 }}>Category & pickup spot (required)</div>

                <div style={{ marginTop: 10, ...row2 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Category</div>
                    <select value={giveCategory} onChange={(e) => setGiveCategory(e.target.value as GiveCategory)} style={select}>
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
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Pickup spot</div>
                    <select value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value as PickupLocation)} style={select}>
                      <option value="College Quad">College Quad</option>
                      <option value="Safety Service Office">Safety Service Office</option>
                      <option value="Dining Hall">Dining Hall</option>
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* REQUEST */}
          {mode === "request" && (
            <div style={card}>
              <div style={{ fontWeight: 950 }}>Request type & timeframe (required)</div>

              <div style={{ marginTop: 10, ...row2 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Request type</div>
                  <select value={requestGroup} onChange={(e) => setRequestGroup(e.target.value as RequestGroup)} style={select}>
                    <option value="logistics">Logistics (ride / moving / borrow)</option>
                    <option value="services">Services (tutoring / tech help / haircut)</option>
                    <option value="urgent">Urgent (charger / calculator / meds)</option>
                    <option value="collaboration">Collaboration (club / hackathon / project)</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Timeframe</div>
                  <select value={requestTimeframe} onChange={(e) => setRequestTimeframe(e.target.value as RequestTimeframe)} style={select}>
                    <option value="today">Today</option>
                    <option value="this_week">This week</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Location (optional)</div>
                <input
                  value={requestLocation}
                  onChange={(e) => setRequestLocation(e.target.value)}
                  style={input}
                  placeholder={`Example: "Dorm A" or "Near dining hall"`}
                />
              </div>
            </div>
          )}

          {/* EVENT */}
          {mode === "event" && (
            <>
              <div style={card}>
                <div style={{ fontWeight: 950 }}>Event details (required)</div>

                <div style={{ marginTop: 10, ...row2 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Category</div>
                    <select value={eventCategory} onChange={(e) => setEventCategory(e.target.value as EventCategory)} style={select}>
                      <option value="career">Career</option>
                      <option value="club">Club</option>
                      <option value="sports">Sports</option>
                      <option value="music">Music</option>
                      <option value="arts">Arts</option>
                      <option value="volunteering">Volunteering</option>
                      <option value="academic">Academic</option>
                      <option value="social">Social</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Host Club/Organisation</div>
                    <input value={hostOrg} onChange={(e) => setHostOrg(e.target.value)} style={input} placeholder={`Example: "Finance Club"`} />
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Location</div>
                  <input value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} style={input} placeholder={`Example: "Dauch 125"`} />
                </div>

                <div style={{ marginTop: 10, ...row2 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Start time</div>
                    <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} style={input} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>End time (optional)</div>
                    <input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} style={input} />
                  </div>
                </div>
              </div>

              <div style={card}>
                <div style={{ fontWeight: 950 }}>Optional link</div>
                <div style={{ marginTop: 10 }}>
                  <input value={eventLink} onChange={(e) => setEventLink(e.target.value)} style={input} placeholder={`Example: "https://instagram.com/p/..."`} />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>If provided, must start with http:// or https://</div>
              </div>

              <div style={card}>
                <div style={{ fontWeight: 950 }}>Flyer / poster (optional)</div>

                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    JPG / PNG / WEBP • max {MAX_EVENT_FLYER_MB}MB
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      ref={eventFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => pickEventFile(e.target.files?.[0] ?? null)}
                      style={{ display: "none" }}
                    />
                    <button type="button" style={button} onClick={() => eventFileInputRef.current?.click()}>
                      {eventFile ? "Change" : "Choose"}
                    </button>
                    {eventFile && (
                      <button type="button" style={danger} onClick={() => setEventFile(null)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {eventPreviewUrl && (
                  <div style={{ marginTop: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={eventPreviewUrl}
                      alt="Flyer preview"
                      style={{
                        width: "100%",
                        height: 260,
                        objectFit: "cover",
                        borderRadius: 16,
                        border: "1px solid #e5e7eb",
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* OPTIONS */}
          <div style={card}>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              style={{
                ...button,
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>More options</span>
              <span style={{ color: "#6b7280" }}>{showOptions ? "—" : "+"}</span>
            </button>

            {showOptions && (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ ...row2 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Hide my name</div>
                    <button
                      type="button"
                      onClick={() => setHideName((v) => !v)}
                      style={{
                        ...button,
                        width: "100%",
                        background: hideName ? "rgba(16,185,129,0.10)" : "white",
                      }}
                    >
                      {hideName ? "Hidden: ON" : "Hidden: OFF"}
                    </button>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>When ON, your name won’t show publicly.</div>
                  </div>

                  <div style={{ opacity: mode === "event" ? 0.5 : 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Automatically close after</div>
                    <select
                      value={expireChoice}
                      onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}
                      style={select}
                      disabled={mode === "event"}
                    >
                      <option value="urgent24">Urgent (24 hours)</option>
                      <option value="7">7 days</option>
                      <option value="14">14 days</option>
                      <option value="30">30 days</option>
                      <option value="never">Until I cancel</option>
                    </select>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>Applies to items/requests only.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {msg && (
            <div style={{ ...card, borderColor: "#fecdd3", background: "#fff1f2", color: "#9f1239", fontWeight: 850 }}>
              {msg}
            </div>
          )}
        </form>
      </div>

      {/* ✅ Sticky submit (REAL SUBMIT BUTTON) */}
      <div style={sticky}>
        <div style={stickyInner}>
          <div style={{ flex: 1, fontSize: 12, color: "#6b7280" }}>{stickyHint}</div>

          <button
            type="submit"
            form="create-form"
            disabled={saving || !canSubmit}
            style={primary(saving || !canSubmit)}
          >
            {saving ? "Posting…" : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ⚠️ REQUIRED: Add this to your BottomNav component (so the sticky bar never gets covered):
 *
 * <div id="bottom-nav" style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:1000 }}>
 *   ...
 * </div>
 *
 * useEffect(() => {
 *   const el = document.getElementById("bottom-nav");
 *   if (!el) return;
 *   const update = () => document.documentElement.style.setProperty("--bottom-nav-height", `${el.offsetHeight}px`);
 *   update();
 *   window.addEventListener("resize", update);
 *   return () => window.removeEventListener("resize", update);
 * }, []);
 */