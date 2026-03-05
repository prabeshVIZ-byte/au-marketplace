"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * ✅ What this version fixes (based on your rules):
 *
 * GIVE (items.post_type = "give") REQUIRED:
 *  - Title
 *  - Description
 *  - Photo
 *  - Category
 *  - Pickup spot
 *
 * REQUEST (items.post_type = "request") REQUIRED:
 *  - Title
 *  - Description
 *  - Request type (request_group)
 *  - Timeframe (request_timeframe)
 *
 * EVENT (events table) REQUIRED:
 *  - Title
 *  - Description
 *  - Location
 *  - Host Club/Organisation
 *  - Start time
 *  - Category
 * Optional:
 *  - End time
 *  - Link
 *  - Flyer upload
 *  - Hide creator name (public)
 *
 * ✅ Routing behavior:
 *  - If not logged in / not Ashland / profile incomplete -> send to /me
 *  - After posting Give/Request -> /item/[id]
 *  - After posting Event -> /feed   (change EVENT_SUCCESS_ROUTE if you have /events)
 *
 * ⚠️ IMPORTANT:
 *  - ITEMS bucket assumed: "item-photos" (your current code)
 *  - EVENTS bucket assumed: "event-flyers"  (create it in Supabase Storage or change below)
 *  - EVENTS table columns must match the insert keys. If your column names differ, edit EVENT_INSERT below.
 */

type Mode = "give" | "request" | "event";
type PostType = "give" | "request";

// ---------- Items enums (keep your existing) ----------
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

// ---------- Events enums (simple) ----------
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

const NAV_APPROX_HEIGHT = 86;
const STICKY_BAR_HEIGHT = 74;

// Give photo max
const MAX_ITEM_PHOTO_MB = 6;
// Event flyer max
const MAX_EVENT_FLYER_MB = 8;

const ITEM_PHOTOS_BUCKET = "item-photos";
const EVENT_FLYERS_BUCKET = "event-flyers"; // change if your bucket name differs

const EVENT_TABLE = "events";
const ITEMS_TABLE = "items";
const ITEM_PHOTOS_TABLE = "item_photos";

// change if you have a dedicated events page
const EVENT_SUCCESS_ROUTE = "/feed";

function getExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? (parts.pop() || "jpg").toLowerCase() : "jpg";
}

function isAllowedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function uuidSafe() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
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

function isValidHttpUrlMaybeEmpty(raw: string) {
  const v = raw.trim();
  if (!v) return true; // optional => empty ok
  return /^https?:\/\//i.test(v);
}

function toIsoFromLocalInput(localValue: string) {
  // input type="datetime-local" gives "YYYY-MM-DDTHH:mm"
  // Convert to Date in local tz then ISO.
  const dt = new Date(localValue);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export default function CreatePage() {
  const router = useRouter();

  const formRef = useRef<HTMLFormElement | null>(null);

  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- Auth ----------
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // ---------- Profile ----------
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // ---------- Mode ----------
  const [mode, setMode] = useState<Mode>("give");

  // ---------- Shared fields ----------
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // ---------- Give (items) ----------
  const [giveCategory, setGiveCategory] = useState<GiveCategory>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreviewUrl, setItemPreviewUrl] = useState<string | null>(null);

  // ---------- Request (items) ----------
  const [requestGroup, setRequestGroup] = useState<RequestGroup>("logistics");
  const [requestTimeframe, setRequestTimeframe] = useState<RequestTimeframe>("today");
  const [requestLocation, setRequestLocation] = useState("");

  // ---------- Event (events) ----------
  const [eventCategory, setEventCategory] = useState<EventCategory>("club");
  const [eventLocation, setEventLocation] = useState("");
  const [hostOrg, setHostOrg] = useState("");
  const [eventLink, setEventLink] = useState("");
  const [startLocal, setStartLocal] = useState(""); // datetime-local string
  const [endLocal, setEndLocal] = useState(""); // optional
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [eventPreviewUrl, setEventPreviewUrl] = useState<string | null>(null);

  // ---------- Options ----------
  const [showOptions, setShowOptions] = useState(false);
  const [hideName, setHideName] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // ---------- Submit state ----------
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ---------- Helpers ----------
  const isAllowed = useMemo(() => !!email && email.toLowerCase().endsWith("@ashland.edu"), [email]);

  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanDesc = useMemo(() => description.trim(), [description]);

  const startIso = useMemo(() => (startLocal ? toIsoFromLocalInput(startLocal) : null), [startLocal]);
  const endIso = useMemo(() => (endLocal ? toIsoFromLocalInput(endLocal) : null), [endLocal]);

  // When switching modes, clear mode-specific messages + enforce expiry rules
  useEffect(() => {
    setMsg(null);

    // if you switch away from give, keep the item photo but it's fine either way.
    // if you switch to request, "never" expiry is allowed but you wanted old behavior; keep your previous rule:
    if (mode === "request" && expireChoice === "never") setExpireChoice("7");
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview URLs (item photo)
  useEffect(() => {
    if (!itemFile) {
      setItemPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(itemFile);
    setItemPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [itemFile]);

  // Preview URLs (event flyer)
  useEffect(() => {
    if (!eventFile) {
      setEventPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(eventFile);
    setEventPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [eventFile]);

  // ---------- AUTH ----------
  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      try {
        const timeoutMs = 6500;

        const sessionPromise = supabase.auth.getSession();
        const raced = await Promise.race([
          sessionPromise,
          new Promise<{ data: any; error: any }>((resolve) =>
            setTimeout(() => resolve({ data: { session: null }, error: new Error("Auth timeout") }), timeoutMs)
          ),
        ]);

        if (!mounted) return;

        const { data, error } = raced as any;
        if (error) {
          console.log("getSession error:", error?.message ?? error);
          setMsg((prev) => prev ?? "Auth is taking too long. Refresh, or check Supabase env vars on Vercel.");
        }

        const session = data?.session ?? null;
        setEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      } catch (err: any) {
        console.log("syncAuth unexpected error:", err?.message ?? err);
        if (!mounted) return;
        setEmail(null);
        setUserId(null);
        setMsg("Auth failed to load. Refresh or sign in again.");
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

  // ---------- PROFILE CHECK ----------
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

  // ---------- File handlers ----------
  function handleItemFilePicked(f: File | null) {
    setMsg(null);
    if (!f) {
      setItemFile(null);
      return;
    }
    if (!isAllowedImage(f)) {
      setItemFile(null);
      setMsg("Upload JPG, PNG, or WEBP (HEIC not supported yet).");
      return;
    }
    if (f.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) {
      setItemFile(null);
      setMsg(`Photo too large (max ${MAX_ITEM_PHOTO_MB}MB).`);
      return;
    }
    setItemFile(f);
  }

  function handleEventFilePicked(f: File | null) {
    setMsg(null);
    if (!f) {
      setEventFile(null);
      return;
    }
    if (!isAllowedImage(f)) {
      setEventFile(null);
      setMsg("Flyer must be JPG, PNG, or WEBP.");
      return;
    }
    if (f.size > MAX_EVENT_FLYER_MB * 1024 * 1024) {
      setEventFile(null);
      setMsg(`Flyer too large (max ${MAX_EVENT_FLYER_MB}MB).`);
      return;
    }
    setEventFile(f);
  }

  // ---------- VALIDATION (the key fix) ----------
  function validate(): string | null {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";

    // title always required for all 3
    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";

    // description required for all 3 (per your instruction)
    if (cleanDesc.length < 3) return "Description is required (add at least a short sentence).";

    if (mode === "give") {
      // required: photo + category + pickup
      if (!itemFile) return "Photo is required for Give posts.";
      if (!giveCategory) return "Category is required.";
      if (!pickupLocation) return "Pickup spot is required.";
      return null;
    }

    if (mode === "request") {
      // required: request type + timeframe
      if (!requestGroup) return "Request type is required.";
      if (!requestTimeframe) return "Timeframe is required.";
      return null;
    }

    // mode === "event"
    if (!eventCategory) return "Event category is required.";
    if (!hostOrg.trim()) return "Host Club/Organisation is required.";
    if (!eventLocation.trim()) return "Location is required.";
    if (!startIso) return "Start time is required.";
    if (!isValidHttpUrlMaybeEmpty(eventLink)) return "Link must start with http:// or https:// (or leave it empty).";

    if (endIso && startIso) {
      if (new Date(endIso).getTime() < new Date(startIso).getTime()) return "End time cannot be before start time.";
    }

    // flyer is optional -> no requirement here
    return null;
  }

  const canSubmit = useMemo(() => {
    if (!isAllowed || !userId) return false;
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
    if (endIso && startIso) {
      if (new Date(endIso).getTime() < new Date(startIso).getTime()) return false;
    }
    return true;
  }, [
    isAllowed,
    userId,
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

  // ---------- SUBMIT ----------
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const err = validate();
    if (err) {
      setMsg(err);
      // send to /me if auth/profile issue
      if (!isAllowed || !userId || !profileComplete) router.push("/me");
      return;
    }

    setSaving(true);

    try {
      if (mode === "event") {
        // 1) Insert base event row
        // NOTE: If your events table column names differ, change keys below.
        const EVENT_INSERT: any = {
          owner_id: userId,
          title: cleanTitle,
          description: cleanDesc,
          category: eventCategory,
          location: eventLocation.trim(),
          host_org: hostOrg.trim(),
          link: eventLink.trim() ? eventLink.trim() : null,
          starts_at: startIso,
          ends_at: endIso ?? null,
          is_anonymous: hideName,
          flyer_url: null,
        };

        const { data: created, error: createErr } = await supabase
          .from(EVENT_TABLE)
          .insert([EVENT_INSERT])
          .select("id")
          .single();

        if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create event.");
        const eventId = String(created.id);

        // 2) Optional flyer upload
        if (eventFile) {
          const ext = getExt(eventFile.name);
          const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

          const { error: upErr } = await supabase.storage.from(EVENT_FLYERS_BUCKET).upload(path, eventFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: eventFile.type || undefined,
          });

          if (upErr) {
            // event exists, flyer failed
            setMsg(`Event posted, but flyer upload failed: ${upErr.message}`);
            router.push(EVENT_SUCCESS_ROUTE);
            router.refresh();
            return;
          }

          const { data: pub } = supabase.storage.from(EVENT_FLYERS_BUCKET).getPublicUrl(path);
          const flyerUrl = pub.publicUrl;

          const { error: updErr } = await supabase.from(EVENT_TABLE).update({ flyer_url: flyerUrl }).eq("id", eventId);
          if (updErr) {
            setMsg(`Flyer uploaded, but flyer_url update failed: ${updErr.message}`);
          }
        }

        router.push(EVENT_SUCCESS_ROUTE);
        router.refresh();
        return;
      }

      // mode === give/request -> items
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

      if (createItemErr || !createdItem?.id) throw new Error(createItemErr?.message || "Failed to create post.");
      const itemId = String(createdItem.id);

      // request: no photo upload
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

      // Optional: keep your item_photos history table
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

  // ---------- UI ----------
  const ui = {
    page: {
      minHeight: "100vh",
      background: "#f7f7f8",
      color: "#0f172a",
      padding: 18,
      paddingBottom: NAV_APPROX_HEIGHT + STICKY_BAR_HEIGHT + 24,
    } as React.CSSProperties,
    shell: { maxWidth: 760, margin: "0 auto" } as React.CSSProperties,
    topRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 12,
    } as React.CSSProperties,
    backBtn: {
      background: "white",
      border: "1px solid #e5e7eb",
      color: "#111827",
      padding: "10px 12px",
      borderRadius: 999,
      cursor: "pointer",
      fontWeight: 800,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
    } as React.CSSProperties,
    pill: {
      background: "white",
      border: "1px solid #e5e7eb",
      padding: "8px 10px",
      borderRadius: 999,
      fontSize: 12,
      color: "#374151",
      boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      maxWidth: 260,
    } as React.CSSProperties,
    hero: {
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: 20,
      padding: 16,
      boxShadow: "0 10px 30px rgba(0,0,0,0.05)",
      position: "relative",
      overflow: "hidden",
    } as React.CSSProperties,
    glow: {
      position: "absolute",
      inset: -120,
      background:
        "radial-gradient(closest-side at 20% 25%, rgba(16,185,129,0.16), transparent 60%), radial-gradient(closest-side at 85% 40%, rgba(59,130,246,0.10), transparent 60%)",
      pointerEvents: "none",
    } as React.CSSProperties,
    h1: { fontSize: 22, fontWeight: 950, margin: 0, position: "relative" } as React.CSSProperties,
    sub: { margin: "6px 0 0", color: "#4b5563", lineHeight: 1.35, position: "relative" } as React.CSSProperties,

    segmentWrap: {
      display: "flex",
      gap: 8,
      marginTop: 12,
      background: "#f3f4f6",
      border: "1px solid #e5e7eb",
      borderRadius: 999,
      padding: 6,
      width: "fit-content",
      position: "relative",
      flexWrap: "wrap",
    } as React.CSSProperties,
    segBtn: (active: boolean) =>
      ({
        padding: "10px 12px",
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        fontWeight: 900,
        background: active ? "white" : "transparent",
        color: "#111827",
        boxShadow: active ? "0 6px 16px rgba(0,0,0,0.08)" : "none",
      }) as React.CSSProperties,

    convo: { marginTop: 14, display: "flex", flexDirection: "column", gap: 12 } as React.CSSProperties,
    row: (side: "left" | "right") =>
      ({ display: "flex", justifyContent: side === "left" ? "flex-start" : "flex-end" }) as React.CSSProperties,
    bubble: (side: "left" | "right") =>
      ({
        width: "100%",
        maxWidth: 640,
        background: side === "left" ? "white" : "#111827",
        color: side === "left" ? "#111827" : "white",
        border: side === "left" ? "1px solid #e5e7eb" : "1px solid #111827",
        borderRadius: 18,
        padding: 14,
        boxShadow: side === "left" ? "0 10px 24px rgba(0,0,0,0.06)" : "0 10px 24px rgba(0,0,0,0.12)",
      }) as React.CSSProperties,
    mini: { fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 8 } as React.CSSProperties,
    input: {
      width: "100%",
      padding: "12px 12px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fbfbfc",
      outline: "none",
      fontSize: 14,
      color: "#111827",
    } as React.CSSProperties,
    textarea: {
      width: "100%",
      padding: "12px 12px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fbfbfc",
      outline: "none",
      fontSize: 14,
      color: "#111827",
      resize: "vertical",
      lineHeight: 1.35,
    } as React.CSSProperties,
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } as React.CSSProperties,
    grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 } as React.CSSProperties,
    select: {
      width: "100%",
      padding: "12px 12px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "white",
      outline: "none",
      fontSize: 14,
      color: "#111827",
      cursor: "pointer",
    } as React.CSSProperties,

    drop: (has: boolean) =>
      ({
        borderRadius: 18,
        border: `1.5px dashed ${has ? "rgba(16,185,129,0.55)" : "#d1d5db"}`,
        background: has ? "white" : "#fbfbfc",
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
      }) as React.CSSProperties,
    ghostBtn: {
      background: "white",
      border: "1px solid #e5e7eb",
      color: "#111827",
      padding: "10px 12px",
      borderRadius: 14,
      cursor: "pointer",
      fontWeight: 900,
      boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
    } as React.CSSProperties,
    dangerBtn: {
      background: "white",
      border: "1px solid #fecaca",
      color: "#b91c1c",
      padding: "10px 12px",
      borderRadius: 14,
      cursor: "pointer",
      fontWeight: 950,
    } as React.CSSProperties,

    drawerBtn: {
      width: "100%",
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: 18,
      padding: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      cursor: "pointer",
      fontWeight: 950,
      color: "#111827",
      boxShadow: "0 10px 24px rgba(0,0,0,0.05)",
    } as React.CSSProperties,
    drawer: {
      marginTop: 10,
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: 18,
      padding: 14,
      boxShadow: "0 10px 24px rgba(0,0,0,0.05)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    } as React.CSSProperties,

    msg: {
      background: "#fff1f2",
      border: "1px solid #fecdd3",
      color: "#9f1239",
      padding: "10px 12px",
      borderRadius: 14,
      fontWeight: 850,
    } as React.CSSProperties,

    sticky: {
      position: "fixed",
      left: 0,
      right: 0,
      bottom: NAV_APPROX_HEIGHT,
      height: STICKY_BAR_HEIGHT,
      background: "rgba(247,247,248,0.86)",
      borderTop: "1px solid #e5e7eb",
      backdropFilter: "blur(10px)",
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "10px 16px",
    } as React.CSSProperties,
    stickyInner: {
      width: "100%",
      maxWidth: 760,
      display: "flex",
      alignItems: "center",
      gap: 12,
    } as React.CSSProperties,
    hint: { flex: 1, fontSize: 12, color: "#6b7280" } as React.CSSProperties,
    primary: (disabled: boolean) =>
      ({
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
        transition: "transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
      }) as React.CSSProperties,
  };

  const helperText =
    mode === "give"
      ? "Give: title + description + photo + category + pickup spot."
      : mode === "request"
      ? "Request: title + description + request type + timeframe."
      : "Event: title + description + location + host + start time + category.";

  const primaryButton = mode === "give" ? "Post item" : mode === "request" ? "Post request" : "Post event";

  const stickyHint = useMemo(() => {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Finish profile setup in Account.";
    if (cleanTitle.length < 3) return "Add a clear title (3+ characters).";
    if (cleanDesc.length < 3) return "Description is required (short sentence).";

    if (mode === "give") {
      if (!itemFile) return "Give posts require a photo.";
      return "Give post ready.";
    }
    if (mode === "request") {
      return "Request ready.";
    }
    // event
    if (!hostOrg.trim()) return "Add Host Club/Organisation.";
    if (!eventLocation.trim()) return "Add event location.";
    if (!startIso) return "Pick a start time.";
    if (!isValidHttpUrlMaybeEmpty(eventLink)) return "Fix link (http/https) or clear it.";
    return "Event ready.";
  }, [
    isAllowed,
    userId,
    profileComplete,
    cleanTitle,
    cleanDesc,
    mode,
    itemFile,
    hostOrg,
    eventLocation,
    startIso,
    eventLink,
  ]);

  // ---------- RENDER states ----------
  if (authLoading || profileLoading) {
    return (
      <div style={ui.page}>
        <div style={ui.shell}>
          <div style={ui.hero}>
            <div style={ui.glow} />
            <div style={{ position: "relative" }}>
              <div style={{ fontWeight: 950 }}>Loading your account…</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                If this takes too long, check Supabase env vars on Vercel.
              </div>
              {msg && <div style={{ marginTop: 12, ...ui.msg }}>{msg}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAllowed || !userId) {
    return (
      <div style={ui.page}>
        <div style={ui.shell}>
          <div style={ui.hero}>
            <div style={ui.glow} />
            <div style={{ position: "relative" }}>
              <h1 style={{ fontSize: 24, fontWeight: 950, margin: 0 }}>Post on ScholarSwap</h1>
              <p style={{ color: "#4b5563", marginTop: 8, marginBottom: 0 }}>
                You must log in with your <b>@ashland.edu</b> email.
              </p>
              {msg && <div style={{ marginTop: 12, ...ui.msg }}>{msg}</div>}
              <button onClick={() => router.push("/me")} style={{ ...ui.ghostBtn, marginTop: 14 }}>
                Go to Account
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profileComplete) {
    return (
      <div style={ui.page}>
        <div style={ui.shell}>
          <div style={ui.hero}>
            <div style={ui.glow} />
            <div style={{ position: "relative" }}>
              <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Complete Profile</h1>
              <p style={{ color: "#4b5563", marginTop: 8, marginBottom: 0 }}>
                Before posting, add your <b>full name</b> and choose <b>Student/Faculty</b>.
              </p>
              {msg && <div style={{ marginTop: 12, ...ui.msg }}>{msg}</div>}
              <button
                onClick={() => router.push("/me")}
                style={{
                  marginTop: 14,
                  border: "none",
                  background: "#10b981",
                  color: "white",
                  padding: "12px 14px",
                  borderRadius: 14,
                  cursor: "pointer",
                  fontWeight: 950,
                  boxShadow: "0 14px 30px rgba(16,185,129,0.25)",
                }}
              >
                Go to Profile Setup
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- MAIN ----------
  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.topRow}>
          <button onClick={() => router.push("/feed")} style={ui.backBtn}>
            <span aria-hidden>←</span> Back
          </button>
          <div style={ui.pill}>
            Posting as <b>{email}</b>
          </div>
        </div>

        <div style={ui.hero}>
          <div style={ui.glow} />
          <div style={{ position: "relative" }}>
            <h1 style={ui.h1}>Create</h1>
            <p style={ui.sub}>{helperText}</p>

            <div style={ui.segmentWrap}>
              <button type="button" onClick={() => setMode("give")} style={ui.segBtn(mode === "give")}>
                Give
              </button>
              <button type="button" onClick={() => setMode("request")} style={ui.segBtn(mode === "request")}>
                Request
              </button>
              <button type="button" onClick={() => setMode("event")} style={ui.segBtn(mode === "event")}>
                Event
              </button>
            </div>
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} style={ui.convo}>
          {/* TITLE */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>ScholarSwap</div>
              <div style={{ fontWeight: 950 }}>
                {mode === "give" ? "What are you giving away? (required)" : mode === "request" ? "What do you need? (required)" : "Event title (required)"}
              </div>
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  placeholder={
                    mode === "give"
                      ? 'Example: "Bedford Handbook (good condition)"'
                      : mode === "request"
                      ? 'Example: "Need a ride Friday 6am"'
                      : 'Example: "Finance Club Guest Speaker Night"'
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={ui.input}
                />
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                Tip: short + specific beats long + vague.
              </div>
            </div>
          </div>

          {/* DESCRIPTION (required for all 3) */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>ScholarSwap</div>
              <div style={{ fontWeight: 950 }}>
                {mode === "give"
                  ? "Any details someone should know? (required)"
                  : mode === "request"
                  ? "Add context so people can help fast. (required)"
                  : "Short description (required)"}
              </div>
              <div style={{ marginTop: 10 }}>
                <textarea
                  placeholder={
                    mode === "give"
                      ? "Condition, what's included, any flaws."
                      : mode === "request"
                      ? "Where/when/how urgent? Keep it simple."
                      : "What is it? Who is it for? Any key details."
                  }
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={ui.textarea}
                />
              </div>
            </div>
          </div>

          {/* GIVE REQUIRED: photo + category + pickup */}
          {mode === "give" && (
            <>
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap</div>
                  <div style={{ fontWeight: 950 }}>Add a photo (required)</div>

                  <div style={{ marginTop: 10 }}>
                    <div style={ui.drop(!!itemPreviewUrl)}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 14,
                            background: "rgba(16,185,129,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 950,
                            color: "#065f46",
                          }}
                        >
                          ⬆
                        </div>
                        <div>
                          <div style={{ fontWeight: 950 }}>{itemPreviewUrl ? "Photo attached" : "Choose a photo"}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            JPG / PNG / WEBP • max {MAX_ITEM_PHOTO_MB}MB
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          ref={itemFileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => handleItemFilePicked(e.target.files?.[0] ?? null)}
                          style={{ display: "none" }}
                        />
                        <button type="button" style={ui.ghostBtn} onClick={() => itemFileInputRef.current?.click()}>
                          {itemPreviewUrl ? "Change" : "Choose"}
                        </button>
                        {itemFile && (
                          <button type="button" style={ui.dangerBtn} onClick={() => setItemFile(null)}>
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
                          alt="Preview"
                          style={{
                            width: "100%",
                            height: 260,
                            objectFit: "cover",
                            borderRadius: 18,
                            border: "1px solid #e5e7eb",
                            boxShadow: "0 16px 40px rgba(0,0,0,0.08)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap</div>
                  <div style={{ fontWeight: 950 }}>Category & pickup spot (required)</div>

                  <div style={{ marginTop: 10, ...ui.grid2 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Category</div>
                      <select value={giveCategory} onChange={(e) => setGiveCategory(e.target.value as GiveCategory)} style={ui.select}>
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
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Pickup spot</div>
                      <select
                        value={pickupLocation}
                        onChange={(e) => setPickupLocation(e.target.value as PickupLocation)}
                        style={ui.select}
                      >
                        <option value="College Quad">College Quad</option>
                        <option value="Safety Service Office">Safety Service Office</option>
                        <option value="Dining Hall">Dining Hall</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* REQUEST REQUIRED: request type + timeframe */}
          {mode === "request" && (
            <div style={ui.row("left")}>
              <div style={ui.bubble("left")}>
                <div style={ui.mini}>ScholarSwap</div>
                <div style={{ fontWeight: 950 }}>Request type & timeframe (required)</div>

                <div style={{ marginTop: 10, ...ui.grid2 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Request type</div>
                    <select value={requestGroup} onChange={(e) => setRequestGroup(e.target.value as RequestGroup)} style={ui.select}>
                      <option value="logistics">Logistics (ride / moving / borrow)</option>
                      <option value="services">Services (tutoring / tech help / haircut)</option>
                      <option value="urgent">Urgent (charger / calculator / meds)</option>
                      <option value="collaboration">Collaboration (club / hackathon / project)</option>
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Timeframe</div>
                    <select
                      value={requestTimeframe}
                      onChange={(e) => setRequestTimeframe(e.target.value as RequestTimeframe)}
                      style={ui.select}
                    >
                      <option value="today">Today</option>
                      <option value="this_week">This week</option>
                      <option value="flexible">Flexible</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Location (optional)</div>
                  <input
                    type="text"
                    placeholder='Example: "Dorm A" or "Near dining hall"'
                    value={requestLocation}
                    onChange={(e) => setRequestLocation(e.target.value)}
                    style={ui.input}
                  />
                </div>
              </div>
            </div>
          )}

          {/* EVENT REQUIRED: category + start time + location + host; optional: end, link, flyer */}
          {mode === "event" && (
            <>
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Event details (required)</div>

                  <div style={{ marginTop: 10, ...ui.grid2 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Category</div>
                      <select value={eventCategory} onChange={(e) => setEventCategory(e.target.value as EventCategory)} style={ui.select}>
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
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Host Club/Organisation</div>
                      <input
                        type="text"
                        placeholder='Example: "Finance Club"'
                        value={hostOrg}
                        onChange={(e) => setHostOrg(e.target.value)}
                        style={ui.input}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Location</div>
                    <input
                      type="text"
                      placeholder='Example: "Dauch 125"'
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                      style={ui.input}
                    />
                  </div>

                  <div style={{ marginTop: 10, ...ui.grid2 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Start time</div>
                      <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} style={ui.input} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>End time (optional)</div>
                      <input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} style={ui.input} />
                    </div>
                  </div>
                </div>
              </div>

              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Optional link</div>
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="text"
                      placeholder='Example: "https://instagram.com/p/..."'
                      value={eventLink}
                      onChange={(e) => setEventLink(e.target.value)}
                      style={ui.input}
                    />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>Link must start with http:// or https:// (or leave empty).</div>
                </div>
              </div>

              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Flyer / poster (optional)</div>

                  <div style={{ marginTop: 10 }}>
                    <div style={ui.drop(!!eventPreviewUrl)}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 14,
                            background: "rgba(16,185,129,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 950,
                            color: "#065f46",
                          }}
                        >
                          ⬆
                        </div>
                        <div>
                          <div style={{ fontWeight: 950 }}>{eventPreviewUrl ? "Flyer attached" : "Choose a flyer image"}</div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            JPG / PNG / WEBP • max {MAX_EVENT_FLYER_MB}MB
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          ref={eventFileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => handleEventFilePicked(e.target.files?.[0] ?? null)}
                          style={{ display: "none" }}
                        />
                        <button type="button" style={ui.ghostBtn} onClick={() => eventFileInputRef.current?.click()}>
                          {eventPreviewUrl ? "Change" : "Choose"}
                        </button>
                        {eventFile && (
                          <button type="button" style={ui.dangerBtn} onClick={() => setEventFile(null)}>
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
                            borderRadius: 18,
                            border: "1px solid #e5e7eb",
                            boxShadow: "0 16px 40px rgba(0,0,0,0.08)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* OPTIONS */}
          <div>
            <button type="button" onClick={() => setShowOptions((v) => !v)} style={ui.drawerBtn} aria-expanded={showOptions}>
              <span>More options</span>
              <span style={{ color: "#6b7280" }}>{showOptions ? "—" : "+"}</span>
            </button>

            {showOptions && (
              <div style={ui.drawer}>
                <div style={ui.grid2}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Hide my name</div>
                    <button
                      type="button"
                      onClick={() => setHideName((v) => !v)}
                      style={{
                        width: "100%",
                        padding: "12px 12px",
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        background: hideName ? "rgba(16,185,129,0.10)" : "#fbfbfc",
                        color: "#111827",
                        fontWeight: 950,
                        cursor: "pointer",
                      }}
                    >
                      {hideName ? "Hidden: ON" : "Hidden: OFF"}
                    </button>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                      When ON, your name won’t show on the feed.
                    </div>
                  </div>

                  {/* expiry only applies to items/requests */}
                  <div style={{ opacity: mode === "event" ? 0.5 : 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Automatically close after</div>
                    <select
                      value={expireChoice}
                      onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}
                      style={ui.select}
                      disabled={mode === "event"}
                    >
                      {mode === "request" && <option value="urgent24">Urgent (24 hours)</option>}
                      <option value="7">7 days</option>
                      <option value="14">14 days</option>
                      <option value="30">30 days</option>
                      <option value="never">Until I cancel</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {msg && <div style={ui.msg}>{msg}</div>}
        </form>
      </div>

      {/* Sticky submit */}
      <div style={ui.sticky}>
        <div style={ui.stickyInner}>
          <div style={ui.hint}>{stickyHint}</div>

          <button
            onClick={() => formRef.current?.requestSubmit()}
            disabled={saving || !canSubmit}
            style={ui.primary(saving || !canSubmit)}
            onMouseDown={(e) => {
              if (saving || !canSubmit) return;
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(1px)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 10px 22px rgba(16,185,129,0.20)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 14px 30px rgba(16,185,129,0.25)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                saving || !canSubmit ? "none" : "0 14px 30px rgba(16,185,129,0.25)";
            }}
          >
            {saving ? "Posting…" : primaryButton}
          </button>
        </div>
      </div>
    </div>
  );
}