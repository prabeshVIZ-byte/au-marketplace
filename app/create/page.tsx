"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * ✅ Create page now supports:
 * - Give (items + required photo)
 * - Request (items, no photo)
 * - Event (events table, optional flyer upload)
 *
 * Assumptions (match your earlier DB plan):
 * public.events columns:
 * - id uuid
 * - created_by uuid
 * - title text
 * - host_org text
 * - category text
 * - location text
 * - description text
 * - starts_at timestamptz
 * - ends_at timestamptz null
 * - link_url text null
 * - photo_url text null
 * - is_anonymous boolean
 *
 * Storage bucket:
 * - item-photos (already)
 * - event-photos (NEW, public bucket recommended)
 */

type PostType = "give" | "request" | "event";

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

type EventCategory =
  | "club"
  | "sports"
  | "party"
  | "career"
  | "volunteering"
  | "workshop"
  | "campus"
  | "other";

const NAV_APPROX_HEIGHT = 86;
const STICKY_BAR_HEIGHT = 74;

const MAX_PHOTO_MB = 6; // items
const MAX_FLYER_MB = 8; // events

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

function uuidSafe() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function toLocalInputValue(d: Date) {
  // "YYYY-MM-DDTHH:mm" in local time for <input type="datetime-local" />
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseLocalDatetimeToISO(v: string) {
  // v like "2026-03-04T16:30" interpreted as local time
  // new Date(v) is parsed as local by most browsers for this format.
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export default function CreatePage() {
  const router = useRouter();

  const formRef = useRef<HTMLFormElement | null>(null);

  // item photo refs
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // event flyer refs
  const flyerInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- ALL HOOKS UP TOP ----------
  // auth
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // profile
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // post type
  const [postType, setPostType] = useState<PostType>("give");

  // shared (for items)
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

  // event-only
  const [eventTitle, setEventTitle] = useState("");
  const [eventHostOrg, setEventHostOrg] = useState("");
  const [eventCategory, setEventCategory] = useState<EventCategory>("club");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventLinkUrl, setEventLinkUrl] = useState("");
  const [eventStartLocal, setEventStartLocal] = useState<string>(() => {
    // default: next full hour
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toLocalInputValue(d);
  });
  const [eventHasEnd, setEventHasEnd] = useState(false);
  const [eventEndLocal, setEventEndLocal] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return toLocalInputValue(d);
  });

  const [flyerFile, setFlyerFile] = useState<File | null>(null);
  const [flyerPreviewUrl, setFlyerPreviewUrl] = useState<string | null>(null);

  // options
  const [showOptions, setShowOptions] = useState(false);
  const [hideName, setHideName] = useState(false); // applies to items and events
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // UI-only
  const [dragOver, setDragOver] = useState(false);
  const [flyerDragOver, setFlyerDragOver] = useState(false);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  // clean item fields
  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanDesc = useMemo(() => {
    const d = description.trim();
    return d.length ? d : null;
  }, [description]);

  // clean event fields
  const cleanEventTitle = useMemo(() => eventTitle.trim(), [eventTitle]);
  const cleanEventHost = useMemo(() => eventHostOrg.trim(), [eventHostOrg]);
  const cleanEventLoc = useMemo(() => eventLocation.trim(), [eventLocation]);
  const cleanEventDesc = useMemo(() => eventDescription.trim(), [eventDescription]);
  const cleanEventLink = useMemo(() => {
    const v = eventLinkUrl.trim();
    return v.length ? v : null;
  }, [eventLinkUrl]);

  // switching tabs: reset error + tab-specific safety resets
  useEffect(() => {
    setMsg(null);

    // if leaving give, clear item photo states
    if (postType !== "give") {
      setFile(null);
      setPreviewUrl(null);
      setDragOver(false);
    }

    // request can't be never expiry
    if (postType === "request" && expireChoice === "never") setExpireChoice("7");

    // leaving event: keep inputs (user-friendly) but reset flyer drag state
    if (postType !== "event") {
      setFlyerDragOver(false);
      setFlyerFile(null);
      setFlyerPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postType]);

  // item preview URL
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // flyer preview URL
  useEffect(() => {
    if (!flyerFile) {
      setFlyerPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(flyerFile);
    setFlyerPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [flyerFile]);

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

  function handleItemFilePicked(f: File | null) {
    setMsg(null);

    if (!f) {
      setFile(null);
      return;
    }
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
  }

  function handleFlyerPicked(f: File | null) {
    setMsg(null);

    if (!f) {
      setFlyerFile(null);
      return;
    }
    if (f.size > MAX_FLYER_MB * 1024 * 1024) {
      setFlyerFile(null);
      setMsg(`Flyer too large (max ${MAX_FLYER_MB}MB).`);
      return;
    }
    if (!isAllowedImage(f)) {
      setFlyerFile(null);
      setMsg("Flyer must be JPG, PNG, or WEBP.");
      return;
    }
    setFlyerFile(f);
  }

  function validate(): string | null {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";

    if (postType === "event") {
      if (cleanEventTitle.length < 3) return "Event title must be at least 3 characters.";
      if (cleanEventHost.length < 2) return "Host Club/Organisation is required.";
      if (cleanEventLoc.length < 2) return "Location is required.";
      if (cleanEventDesc.length < 5) return "Description is required (at least a few words).";

      const startISO = parseLocalDatetimeToISO(eventStartLocal);
      if (!startISO) return "Start time is required.";

      if (eventHasEnd) {
        const endISO = parseLocalDatetimeToISO(eventEndLocal);
        if (!endISO) return "End time is invalid.";
        if (new Date(endISO).getTime() <= new Date(startISO).getTime()) return "End time must be after start time.";
      }

      if (flyerFile) {
        if (flyerFile.size > MAX_FLYER_MB * 1024 * 1024) return `Flyer too large (max ${MAX_FLYER_MB}MB).`;
        if (!isAllowedImage(flyerFile)) return "Flyer must be JPG, PNG, or WEBP.";
      }

      // optional link validation (light)
      if (cleanEventLink) {
        const ok = /^https?:\/\//i.test(cleanEventLink);
        if (!ok) return 'Link must start with "http://" or "https://".';
      }

      return null;
    }

    // items (give/request)
    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";

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

    if (postType === "event") {
      if (cleanEventTitle.length < 3) return false;
      if (cleanEventHost.length < 2) return false;
      if (cleanEventLoc.length < 2) return false;
      if (cleanEventDesc.length < 5) return false;

      const startISO = parseLocalDatetimeToISO(eventStartLocal);
      if (!startISO) return false;

      if (eventHasEnd) {
        const endISO = parseLocalDatetimeToISO(eventEndLocal);
        if (!endISO) return false;
        if (new Date(endISO).getTime() <= new Date(startISO).getTime()) return false;
      }

      if (flyerFile) {
        if (flyerFile.size > MAX_FLYER_MB * 1024 * 1024) return false;
        if (!isAllowedImage(flyerFile)) return false;
      }

      if (cleanEventLink) {
        const ok = /^https?:\/\//i.test(cleanEventLink);
        if (!ok) return false;
      }

      return true;
    }

    // items
    if (cleanTitle.length < 3) return false;

    if (postType === "give" && !file) return false;
    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return false;
      if (!isAllowedImage(file)) return false;
    }
    return true;
  }, [
    isAllowed,
    userId,
    profileComplete,
    postType,
    cleanTitle,
    file,
    cleanEventTitle,
    cleanEventHost,
    cleanEventLoc,
    cleanEventDesc,
    cleanEventLink,
    eventStartLocal,
    eventHasEnd,
    eventEndLocal,
    flyerFile,
  ]);

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
      // ==========================
      // EVENT SUBMIT
      // ==========================
      if (postType === "event") {
        const starts_at = parseLocalDatetimeToISO(eventStartLocal);
        const ends_at = eventHasEnd ? parseLocalDatetimeToISO(eventEndLocal) : null;

        if (!starts_at) throw new Error("Invalid start time.");

        const baseEvent: any = {
          created_by: userId,
          title: cleanEventTitle,
          host_org: cleanEventHost,
          category: eventCategory,
          location: cleanEventLoc,
          description: cleanEventDesc,
          starts_at,
          ends_at,
          link_url: cleanEventLink,
          photo_url: null,
          is_anonymous: hideName,
        };

        const { data: created, error: createErr } = await supabase
          .from("events")
          .insert([baseEvent])
          .select("id")
          .single();

        if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create event.");

        const eventId = String(created.id);

        // Flyer optional
        if (!flyerFile) {
          router.push(`/events`); // build later; change to /feed if you want
          router.refresh();
          return;
        }

        const ext = getExt(flyerFile.name);
        const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

        const { error: uploadErr } = await supabase.storage.from("event-photos").upload(path, flyerFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: flyerFile.type || undefined,
        });

        if (uploadErr) {
          setMsg(`Event posted, but flyer upload failed: ${uploadErr.message}`);
          router.push(`/events`);
          router.refresh();
          return;
        }

        const { data: pub } = supabase.storage.from("event-photos").getPublicUrl(path);
        const publicUrl = pub.publicUrl;

        const { error: updateErr } = await supabase.from("events").update({ photo_url: publicUrl }).eq("id", eventId);

        if (updateErr) {
          setMsg(`Flyer uploaded, but photo_url update failed: ${updateErr.message}`);
          router.push(`/events`);
          router.refresh();
          return;
        }

        router.push(`/events`);
        router.refresh();
        return;
      }

      // ==========================
      // ITEMS SUBMIT (Give/Request)
      // ==========================
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

      const { data: created, error: createErr } = await supabase.from("items").insert([baseInsert]).select("id").single();

      if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create post.");

      const itemId = created.id as string;

      // Requests: no photo step
      if (postType === "request") {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // Give: photo REQUIRED
      const ext = getExt(file!.name);
      const path = `items/${userId}/${itemId}/${uuidSafe()}.${ext}`;

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

  // ---------- UI styles ----------
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

    drop: (active: boolean, has: boolean) =>
      ({
        borderRadius: 18,
        border: `1.5px dashed ${active ? "#10b981" : "#d1d5db"}`,
        background: has ? "white" : active ? "rgba(16,185,129,0.07)" : "#fbfbfc",
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
        transition: "all 150ms ease",
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

  // ---------- Derived UI text ----------
  const helperText =
    postType === "give"
      ? "Start with a clear title + a photo. Everything else is quick choices."
      : postType === "request"
      ? "Ask clearly. The right person will message you."
      : "Post a campus event so students don’t miss it.";

  const stickyHint = useMemo(() => {
    if (postType === "event") {
      if (cleanEventTitle.length < 3) return "Add an event title (3+ characters).";
      if (cleanEventHost.length < 2) return "Host Club/Organisation is required.";
      if (cleanEventLoc.length < 2) return "Location is required.";
      if (cleanEventDesc.length < 5) return "Add a short description.";
      return "Looks good — ready to post.";
    }

    return cleanTitle.length < 3
      ? "Add a clear title (3+ characters)."
      : postType === "give"
      ? file
        ? "Looks good — ready to post."
        : "Photo is required for Give posts."
      : "Ready to post.";
  }, [postType, cleanTitle, file, cleanEventTitle, cleanEventHost, cleanEventLoc, cleanEventDesc]);

  const primaryButton = postType === "give" ? "Post item" : postType === "request" ? "Post request" : "Post event";

  // ---------- RENDER STATES ----------
  if (authLoading || profileLoading) {
    return (
      <div style={ui.page}>
        <div style={ui.shell}>
          <div style={ui.hero}>
            <div style={ui.glow} />
            <div style={{ position: "relative" }}>
              <div style={{ fontWeight: 950 }}>Loading your account…</div>
              <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
                If this takes more than a few seconds, your Supabase env vars on Vercel may be missing.
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
                You must log in with your <b>@ashland.edu</b> email to post.
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

  // ---------- MAIN PAGE ----------
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
              <button type="button" onClick={() => setPostType("give")} style={ui.segBtn(postType === "give")}>
                Give
              </button>
              <button type="button" onClick={() => setPostType("request")} style={ui.segBtn(postType === "request")}>
                Request
              </button>
              <button type="button" onClick={() => setPostType("event")} style={ui.segBtn(postType === "event")}>
                Event
              </button>
            </div>
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} style={ui.convo}>
          {/* ===================== EVENT FORM ===================== */}
          {postType === "event" && (
            <>
              {/* Event title bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>What’s the event called?</div>
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="text"
                      placeholder='Example: "Finance Club: Everence Panel"'
                      value={eventTitle}
                      onChange={(e) => setEventTitle(e.target.value)}
                      style={ui.input}
                    />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>Tip: short + clear + specific.</div>
                </div>
              </div>

              {/* Host/Location bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Host + location</div>

                  <div style={{ marginTop: 10, ...ui.grid2 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Host Club/Organisation <span style={{ color: "#b91c1c" }}>*</span>
                      </div>
                      <input
                        type="text"
                        placeholder='Example: "Finance Club"'
                        value={eventHostOrg}
                        onChange={(e) => setEventHostOrg(e.target.value)}
                        style={ui.input}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Location <span style={{ color: "#b91c1c" }}>*</span>
                      </div>
                      <input
                        type="text"
                        placeholder='Example: "Dauch 209"'
                        value={eventLocation}
                        onChange={(e) => setEventLocation(e.target.value)}
                        style={ui.input}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Category + time bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Category + time</div>

                  <div style={{ marginTop: 10, ...ui.grid2 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Category</div>
                      <select
                        value={eventCategory}
                        onChange={(e) => setEventCategory(e.target.value as EventCategory)}
                        style={ui.select}
                      >
                        <option value="club">Club</option>
                        <option value="sports">Sports</option>
                        <option value="party">Party</option>
                        <option value="career">Career</option>
                        <option value="volunteering">Volunteering</option>
                        <option value="workshop">Workshop</option>
                        <option value="campus">Campus</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Start time <span style={{ color: "#b91c1c" }}>*</span>
                      </div>
                      <input
                        type="datetime-local"
                        value={eventStartLocal}
                        onChange={(e) => setEventStartLocal(e.target.value)}
                        style={ui.input}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      style={{
                        ...ui.ghostBtn,
                        width: "100%",
                        borderRadius: 14,
                        background: eventHasEnd ? "rgba(16,185,129,0.10)" : "white",
                        borderColor: eventHasEnd ? "rgba(16,185,129,0.35)" : "#e5e7eb",
                        color: eventHasEnd ? "#065f46" : "#111827",
                        fontWeight: 950,
                      }}
                      onClick={() => setEventHasEnd((v) => !v)}
                    >
                      {eventHasEnd ? "End time: ON" : "Add optional end time"}
                    </button>
                  </div>

                  {eventHasEnd && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>End time</div>
                      <input
                        type="datetime-local"
                        value={eventEndLocal}
                        onChange={(e) => setEventEndLocal(e.target.value)}
                        style={ui.input}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Description bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>
                    Description <span style={{ color: "#b91c1c" }}>*</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      placeholder='Example: "Interactive Q&A with Everence team. Giveaways + networking."'
                      rows={4}
                      value={eventDescription}
                      onChange={(e) => setEventDescription(e.target.value)}
                      style={ui.textarea}
                    />
                  </div>
                </div>
              </div>

              {/* Link bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Optional link</div>
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="text"
                      placeholder='Example: "https://instagram.com/p/..."'
                      value={eventLinkUrl}
                      onChange={(e) => setEventLinkUrl(e.target.value)}
                      style={ui.input}
                    />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                    Link must start with http:// or https://
                  </div>
                </div>
              </div>

              {/* Flyer upload bubble (optional) */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap • Events</div>
                  <div style={{ fontWeight: 950 }}>Flyer / poster (optional)</div>

                  <div
                    style={{ marginTop: 10 }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFlyerDragOver(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFlyerDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFlyerDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFlyerDragOver(false);
                      const dropped = e.dataTransfer.files?.[0] ?? null;
                      if (dropped) handleFlyerPicked(dropped);
                    }}
                  >
                    <div style={ui.drop(flyerDragOver, !!flyerPreviewUrl)}>
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
                          <div style={{ fontWeight: 950 }}>
                            {flyerPreviewUrl ? "Flyer attached" : flyerDragOver ? "Drop it here" : "Drag & drop a flyer"}
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            JPG / PNG / WEBP • max {MAX_FLYER_MB}MB
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          ref={flyerInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => handleFlyerPicked(e.target.files?.[0] ?? null)}
                          style={{ display: "none" }}
                        />
                        <button type="button" style={ui.ghostBtn} onClick={() => flyerInputRef.current?.click()}>
                          {flyerPreviewUrl ? "Change" : "Choose"}
                        </button>
                        {flyerFile && (
                          <button type="button" style={ui.dangerBtn} onClick={() => setFlyerFile(null)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {flyerPreviewUrl && (
                      <div style={{ marginTop: 12 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={flyerPreviewUrl}
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

          {/* ===================== ITEM FORM (Give/Request) ===================== */}
          {postType !== "event" && (
            <>
              {/* Title bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap</div>
                  <div style={{ fontWeight: 950 }}>
                    {postType === "give" ? "What are you giving away?" : "What do you need?"}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <input
                      type="text"
                      placeholder={
                        postType === "give"
                          ? 'Example: "Bedford Handbook (good condition)"'
                          : 'Example: "Need a ride Friday 6am"'
                      }
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      style={ui.input}
                    />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                    Tip: lead with the noun + condition + key detail.
                  </div>
                </div>
              </div>

              {/* Details bubble */}
              <div style={ui.row("left")}>
                <div style={ui.bubble("left")}>
                  <div style={ui.mini}>ScholarSwap</div>
                  <div style={{ fontWeight: 950 }}>
                    {postType === "give" ? "Any details someone should know?" : "Add context so people can help fast."}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      placeholder={postType === "give" ? "What’s included? any flaws?" : "Where/when/how urgent? Keep it simple."}
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      style={ui.textarea}
                    />
                  </div>
                </div>
              </div>

              {/* Give: photo bubble */}
              {postType === "give" && (
                <div style={ui.row("left")}>
                  <div style={ui.bubble("left")}>
                    <div style={ui.mini}>ScholarSwap</div>
                    <div style={{ fontWeight: 950 }}>Add a photo (required)</div>

                    <div
                      style={{ marginTop: 10 }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOver(false);
                        const dropped = e.dataTransfer.files?.[0] ?? null;
                        if (dropped) handleItemFilePicked(dropped);
                      }}
                    >
                      <div style={ui.drop(dragOver, !!previewUrl)}>
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
                            <div style={{ fontWeight: 950 }}>
                              {previewUrl ? "Photo attached" : dragOver ? "Drop it here" : "Drag & drop a photo"}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                              JPG / PNG / WEBP • max {MAX_PHOTO_MB}MB
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => handleItemFilePicked(e.target.files?.[0] ?? null)}
                            style={{ display: "none" }}
                          />
                          <button type="button" style={ui.ghostBtn} onClick={() => fileInputRef.current?.click()}>
                            {previewUrl ? "Change" : "Choose"}
                          </button>
                          {file && (
                            <button type="button" style={ui.dangerBtn} onClick={() => setFile(null)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {previewUrl && (
                        <div style={{ marginTop: 12 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
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
              )}

              {/* Essentials bubble */}
              {postType === "give" && (
                <div style={ui.row("left")}>
                  <div style={ui.bubble("left")}>
                    <div style={ui.mini}>ScholarSwap</div>
                    <div style={{ fontWeight: 950 }}>Quick choices (helps discovery)</div>

                    <div style={{ marginTop: 10, ...ui.grid2 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Category</div>
                        <select
                          value={giveCategory}
                          onChange={(e) => setGiveCategory(e.target.value as GiveCategory)}
                          style={ui.select}
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
              )}

              {postType === "request" && (
                <div style={ui.row("left")}>
                  <div style={ui.bubble("left")}>
                    <div style={ui.mini}>ScholarSwap</div>
                    <div style={{ fontWeight: 950 }}>Pick a type + timeframe</div>

                    <div style={{ marginTop: 10, ...ui.grid2 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                          Request type
                        </div>
                        <select
                          value={requestGroup}
                          onChange={(e) => setRequestGroup(e.target.value as RequestGroup)}
                          style={ui.select}
                        >
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
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Location (optional)
                      </div>
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
            </>
          )}

          {/* Options drawer (shared) */}
          <div>
            <button type="button" onClick={() => setShowOptions((v) => !v)} style={ui.drawerBtn} aria-expanded={showOptions}>
              <span>More options</span>
              <span style={{ color: "#6b7280" }}>{showOptions ? "—" : "+"}</span>
            </button>

            {showOptions && (
              <div style={ui.drawer}>
                <div style={ui.grid2}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                      Hide my name
                    </div>
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
                      When ON, your name won’t show publicly.
                    </div>
                  </div>

                  {/* Expiry only applies to item requests/gives */}
                  {postType !== "event" ? (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Automatically close after
                      </div>
                      <select
                        value={expireChoice}
                        onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}
                        style={ui.select}
                      >
                        {postType === "request" && <option value="urgent24">Urgent (24 hours)</option>}
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                        <option value="never">Until I cancel</option>
                      </select>
                      {postType === "request" && expireChoice === "urgent24" && (
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                          Urgent requests expire in 24 hours unless you repost.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                        Posting policy
                      </div>
                      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.35 }}>
                        Events stay visible until the start time (you’ll hide expired events on the Events feed later).
                      </div>
                    </div>
                  )}
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