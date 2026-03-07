"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Mode = "give" | "request" | "event";
type PostType = "give" | "request";

type GiveCategory =
  | "books"
  | "notes"
  | "electronics"
  | "furniture"
  | "clothing"
  | "sport equipment"
  | "stationary item"
  | "ride"
  | "art pieces"
  | "health & beauty"
  | "home & kitchen"
  | "jeweleries"
  | "musical instruments"
  | "lost & found"
  | "others";

type PickupLocation =
  | "College Quad"
  | "Safety Service Office"
  | "Dining Hall"
  | "Library"
  | "Student Center";

type RequestGroup =
  | "logistics"
  | "services"
  | "urgent"
  | "collaboration"
  | "lost & found";

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

type DraftState = {
  mode: Mode | null;

  title: string;
  description: string;

  giveCategory: GiveCategory;
  pickupLocation: PickupLocation;

  requestGroup: RequestGroup;
  requestTimeframe: RequestTimeframe;
  requestLocation: string;

  eventCategory: EventCategory;
  eventLocation: string;
  hostOrg: string;
  eventLink: string;

  eventDate: string;
  eventStartTime: string;
  eventEndTime: string;

  hideName: boolean;
  expireChoice: ExpireChoice;

  itemFileName: string | null;
  eventFileName: string | null;
};

type ErrorSection = "media" | "title" | "details" | "options" | "account" | null;

const ITEMS_TABLE = "items";
const ITEM_PHOTOS_TABLE = "item_photos";
const EVENTS_TABLE = "events";

const ITEM_PHOTOS_BUCKET = "item-photos";
const EVENT_FLYERS_BUCKET = "event-flyers";

const MAX_ITEM_PHOTO_MB = 6;
const MAX_EVENT_FLYER_MB = 8;

const DRAFT_KEY = "scholarswap_create_responsive_v2";
const SUCCESS_ROUTE = "/feed";

/* ---------------- utilities ---------------- */

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
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
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

function errToMsg(e: any) {
  if (!e) return "Something went wrong.";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function combineLocalDateAndTimeToISO(dateStr: string, timeStr: string) {
  if (!dateStr || !timeStr) return null;
  const mDate = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mTime = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!mDate || !mTime) return null;

  const y = Number(mDate[1]);
  const mo = Number(mDate[2]);
  const d = Number(mDate[3]);
  const hh = Number(mTime[1]);
  const mm = Number(mTime[2]);

  const dt = new Date(y, mo - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function formatLongDateTime(iso: string | null) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function requestGroupLabel(g: RequestGroup) {
  if (g === "logistics") return "Logistics";
  if (g === "services") return "Services";
  if (g === "urgent") return "Urgent";
  if (g === "collaboration") return "Collaboration";
  if (g === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(t: RequestTimeframe) {
  if (t === "today") return "Today";
  if (t === "this_week") return "This week";
  if (t === "flexible") return "Flexible";
  return "";
}

function giveCategoryLabel(v: GiveCategory) {
  return v
    .split(" ")
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function eventCategoryLabel(v: EventCategory) {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function expireChoiceLabel(v: ExpireChoice) {
  if (v === "urgent24") return "24h";
  if (v === "7") return "7d";
  if (v === "14") return "14d";
  if (v === "30") return "30d";
  return "Until canceled";
}

function getDefaultDraft(): DraftState {
  return {
    mode: null,

    title: "",
    description: "",

    giveCategory: "books",
    pickupLocation: "College Quad",

    requestGroup: "logistics",
    requestTimeframe: "today",
    requestLocation: "",

    eventCategory: "club",
    eventLocation: "",
    hostOrg: "",
    eventLink: "",

    eventDate: "",
    eventStartTime: "",
    eventEndTime: "",

    hideName: false,
    expireChoice: "7",

    itemFileName: null,
    eventFileName: null,
  };
}

/* ---------------- component ---------------- */

export default function CreatePage() {
  const router = useRouter();

  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  const topRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);

  const [draft, setDraft] = useState<DraftState>(getDefaultDraft());
  const [hydratedDraft, setHydratedDraft] = useState(false);

  const [itemFile, setItemFile] = useState<File | null>(null);
  const [eventFile, setEventFile] = useState<File | null>(null);

  const [itemPreviewUrl, setItemPreviewUrl] = useState<string | null>(null);
  const [eventPreviewUrl, setEventPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<ErrorSection>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  const cleanTitle = useMemo(() => draft.title.trim(), [draft.title]);
  const cleanDesc = useMemo(() => draft.description.trim(), [draft.description]);

  const eventStartIso = useMemo(
    () => combineLocalDateAndTimeToISO(draft.eventDate, draft.eventStartTime),
    [draft.eventDate, draft.eventStartTime]
  );

  const eventEndIso = useMemo(
    () => combineLocalDateAndTimeToISO(draft.eventDate, draft.eventEndTime),
    [draft.eventDate, draft.eventEndTime]
  );

  const isAshland = useMemo(() => !!email && email.toLowerCase().endsWith("@ashland.edu"), [email]);
  const isLoggedIn = !!userId && !!email && isAshland;

  useEffect(() => {
    const updateDevice = () => {
      setIsDesktop(window.innerWidth >= 980);
    };
    updateDevice();
    window.addEventListener("resize", updateDevice);
    return () => window.removeEventListener("resize", updateDevice);
  }, []);

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

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        setHydratedDraft(true);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DraftState>;
      setDraft({ ...getDefaultDraft(), ...parsed });
    } catch {
      // ignore broken storage
    } finally {
      setHydratedDraft(true);
    }
  }, []);

  useEffect(() => {
    if (!hydratedDraft) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore storage failure
    }
  }, [draft, hydratedDraft]);

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

  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      setAuthLoading(true);
      try {
        const raced = await Promise.race([
          supabase.auth.getSession(),
          new Promise<any>((resolve) =>
            setTimeout(() => resolve({ data: { session: null }, error: { message: "Auth timeout" } }), 6500)
          ),
        ]);

        if (!mounted) return;

        const { data } = raced;
        const session = data?.session ?? null;
        setEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      } catch {
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

  function patchDraft<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMsg(null);
    setFieldError(null);
  }

  function resetComposer(keepMode = false) {
    const nextMode = keepMode ? draft.mode : null;
    setDraft({ ...getDefaultDraft(), mode: nextMode });
    setItemFile(null);
    setEventFile(null);
    setMsg(null);
    setFieldError(null);

    if (!keepMode) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
    }
  }

  function goBackToModes() {
    resetComposer(false);
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectMode(mode: Mode) {
    setMsg(null);
    setFieldError(null);
    setItemFile(null);
    setEventFile(null);
    setDraft({ ...getDefaultDraft(), mode });

    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function pickItemFile(file: File | null) {
    setMsg(null);
    setFieldError(null);

    if (!file) {
      setItemFile(null);
      patchDraft("itemFileName", null);
      return;
    }

    if (!isAllowedImage(file)) {
      setMsg("Upload JPG, PNG, or WEBP.");
      setFieldError("media");
      mediaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (file.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_ITEM_PHOTO_MB}MB.`);
      setFieldError("media");
      mediaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setItemFile(file);
    patchDraft("itemFileName", file.name);
  }

  function pickEventFile(file: File | null) {
    setMsg(null);
    setFieldError(null);

    if (!file) {
      setEventFile(null);
      patchDraft("eventFileName", null);
      return;
    }

    if (!isAllowedImage(file)) {
      setMsg("Upload JPG, PNG, or WEBP.");
      setFieldError("media");
      mediaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (file.size > MAX_EVENT_FLYER_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_EVENT_FLYER_MB}MB.`);
      setFieldError("media");
      mediaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setEventFile(file);
    patchDraft("eventFileName", file.name);
  }

  const hasRequiredMedia =
    draft.mode === "request" ? true : draft.mode === "give" ? !!itemFile : draft.mode === "event" ? !!eventFile : false;

  const hasTitle = cleanTitle.length >= 3;
  const hasDesc = cleanDesc.length >= 3;

  const progressValue = useMemo(() => {
    if (!draft.mode) return 0;
    let score = 0;
    if (hasRequiredMedia) score += 1;
    if (hasTitle && hasDesc) score += 1;

    if (draft.mode === "give" && draft.giveCategory && draft.pickupLocation) score += 1;
    if (draft.mode === "request" && draft.requestGroup && draft.requestTimeframe) score += 1;
    if (
      draft.mode === "event" &&
      draft.hostOrg.trim() &&
      draft.eventCategory &&
      draft.eventLocation.trim() &&
      draft.eventDate &&
      draft.eventStartTime &&
      eventStartIso &&
      isValidHttpUrlMaybeEmpty(draft.eventLink) &&
      !(draft.eventEndTime && eventEndIso && new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime())
    ) {
      score += 1;
    }

    return score / 3;
  }, [
    draft.mode,
    hasRequiredMedia,
    hasTitle,
    hasDesc,
    draft.giveCategory,
    draft.pickupLocation,
    draft.requestGroup,
    draft.requestTimeframe,
    draft.hostOrg,
    draft.eventCategory,
    draft.eventLocation,
    draft.eventDate,
    draft.eventStartTime,
    draft.eventLink,
    draft.eventEndTime,
    eventStartIso,
    eventEndIso,
  ]);

  const eventTimeSummary = eventStartIso
    ? `${formatLongDateTime(eventStartIso)}${eventEndIso ? ` → ${formatLongDateTime(eventEndIso)}` : ""}`
    : "—";

  function validateBeforeSubmit(): { message: string; section: ErrorSection } | null {
    if (!draft.mode) return { message: "Choose Give, Request, or Event first.", section: "account" };
    if (!isLoggedIn) return { message: "Log in with your @ashland.edu email to post.", section: "account" };
    if (!profileComplete) return { message: "Complete your profile first.", section: "account" };

    if (draft.mode === "give") {
      if (!itemFile) return { message: "Add a photo to continue.", section: "media" };
      if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
      if (cleanDesc.length < 3) return { message: "Description is required.", section: "title" };
      if (!draft.giveCategory) return { message: "Choose a category.", section: "details" };
      if (!draft.pickupLocation) return { message: "Choose a pickup location.", section: "details" };
      return null;
    }

    if (draft.mode === "request") {
      if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
      if (cleanDesc.length < 3) return { message: "Description is required.", section: "title" };
      if (!draft.requestGroup) return { message: "Choose a request type.", section: "details" };
      if (!draft.requestTimeframe) return { message: "Choose a timeframe.", section: "details" };
      return null;
    }

    if (!eventFile) return { message: "Add a flyer image to continue.", section: "media" };
    if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
    if (!draft.hostOrg.trim()) return { message: "Host is required.", section: "details" };
    if (cleanDesc.length < 3) return { message: "Description is required.", section: "title" };
    if (!draft.eventCategory) return { message: "Choose a category.", section: "details" };
    if (!draft.eventLocation.trim()) return { message: "Location is required.", section: "details" };
    if (!draft.eventDate) return { message: "Choose a date.", section: "details" };
    if (!draft.eventStartTime) return { message: "Choose a start time.", section: "details" };
    if (!eventStartIso) return { message: "Start time is invalid.", section: "details" };
    if (!isValidHttpUrlMaybeEmpty(draft.eventLink)) {
      return { message: "Link must start with http:// or https://", section: "details" };
    }
    if (
      draft.eventEndTime &&
      eventEndIso &&
      new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime()
    ) {
      return { message: "End time cannot be before start time.", section: "details" };
    }

    return null;
  }

  function scrollToSection(section: ErrorSection) {
    if (section === "media") mediaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "title") titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "details") detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "options") optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "account") topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit() {
    setMsg(null);
    setFieldError(null);

    const validation = validateBeforeSubmit();
    if (validation) {
      setMsg(validation.message);
      setFieldError(validation.section);
      scrollToSection(validation.section);

      if (validation.section === "account" && (!isLoggedIn || !profileComplete)) {
        setTimeout(() => router.push("/me"), 250);
      }
      return;
    }

    if (!userId || !draft.mode) {
      setMsg("You must be logged in.");
      return;
    }

    setSaving(true);

    try {
      if (draft.mode === "event") {
        const eventInsert: any = {
          created_by: userId,
          title: cleanTitle,
          description: cleanDesc,
          host_org: draft.hostOrg.trim(),
          category: draft.eventCategory,
          location: draft.eventLocation.trim(),
          starts_at: eventStartIso,
          ends_at: eventEndIso || null,
          link_url: draft.eventLink.trim() ? draft.eventLink.trim() : null,
          photo_url: null,
          is_anonymous: draft.hideName,
          action: "create",
          entity_type: "campus_event",
        };

        const { data: created, error: createErr } = await supabase
          .from(EVENTS_TABLE)
          .insert([eventInsert])
          .select("id")
          .single();

        if (createErr || !created?.id) {
          throw new Error(createErr?.message || "Failed to create event.");
        }

        const eventId = String(created.id);

        if (!eventFile) {
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error("Image is required.");
        }

        const ext = getExt(eventFile.name);
        const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

        const { error: uploadErr } = await supabase.storage.from(EVENT_FLYERS_BUCKET).upload(path, eventFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: eventFile.type || undefined,
        });

        if (uploadErr) {
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error(`Image upload failed: ${uploadErr.message}`);
        }

        const { data: pub } = supabase.storage.from(EVENT_FLYERS_BUCKET).getPublicUrl(path);
        const photoUrl = `${pub.publicUrl}?v=${Date.now()}`;

        const { error: updErr } = await supabase
          .from(EVENTS_TABLE)
          .update({ photo_url: photoUrl })
          .eq("id", eventId);

        if (updErr) {
          await supabase.storage.from(EVENT_FLYERS_BUCKET).remove([path]);
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error(`Event created but image save failed: ${updErr.message}`);
        }

        resetComposer(false);
        router.push(SUCCESS_ROUTE);
        router.refresh();
        return;
      }

      const postType: PostType = draft.mode === "give" ? "give" : "request";
      const { untilCancel, expiresAt } = computeExpiry(draft.expireChoice);

      const itemInsert: any = {
        owner_id: userId,
        title: cleanTitle,
        description: cleanDesc,
        status: "available",
        is_anonymous: draft.hideName,
        until_cancel: untilCancel,
        expires_at: expiresAt,
        photo_url: null,
        post_type: postType,
      };

      if (postType === "give") {
        itemInsert.category = draft.giveCategory;
        itemInsert.pickup_location = draft.pickupLocation;
        itemInsert.request_group = null;
        itemInsert.request_timeframe = null;
        itemInsert.request_location = null;
      } else {
        itemInsert.category = draft.requestGroup === "lost & found" ? "lost & found" : "others";
        itemInsert.pickup_location = null;
        itemInsert.request_group = draft.requestGroup;
        itemInsert.request_timeframe = draft.requestTimeframe;
        itemInsert.request_location = draft.requestLocation.trim() || null;
      }

      const { data: createdItem, error: createItemErr } = await supabase
        .from(ITEMS_TABLE)
        .insert([itemInsert])
        .select("id")
        .single();

      if (createItemErr || !createdItem?.id) {
        throw new Error(createItemErr?.message || "Failed to create post.");
      }

      const itemId = String(createdItem.id);

      if (postType === "request") {
        resetComposer(false);
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      if (!itemFile) {
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error("Image is required.");
      }

      const ext = getExt(itemFile.name);
      const storagePath = `items/${userId}/${itemId}/${uuidSafe()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from(ITEM_PHOTOS_BUCKET).upload(storagePath, itemFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: itemFile.type || undefined,
      });

      if (uploadErr) {
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Image upload failed: ${uploadErr.message}`);
      }

      const { data: pub } = supabase.storage.from(ITEM_PHOTOS_BUCKET).getPublicUrl(storagePath);
      const photoUrl = `${pub.publicUrl}?v=${Date.now()}`;

      const { error: updateErr } = await supabase
        .from(ITEMS_TABLE)
        .update({ photo_url: photoUrl })
        .eq("id", itemId);

      if (updateErr) {
        await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([storagePath]);
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Post created but image save failed: ${updateErr.message}`);
      }

      const { error: photoErr } = await supabase
        .from(ITEM_PHOTOS_TABLE)
        .insert([{ item_id: itemId, owner_id: userId, path: storagePath }]);

      if (photoErr) {
        await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([storagePath]);
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Image metadata save failed: ${photoErr.message}`);
      }

      resetComposer(false);
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(errToMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function renderModePicker() {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <button type="button" onClick={() => selectMode("give")} style={modeCard("warm")}>
          <div style={modeIconBox}>🎁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Give</div>
            <div style={modeDesc}>Share something useful</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("request")} style={modeCard("blue")}>
          <div style={modeIconBox}>🤝</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Request</div>
            <div style={modeDesc}>Ask the campus community</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("event")} style={modeCard("purple")}>
          <div style={modeIconBox}>📅</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Event</div>
            <div style={modeDesc}>Promote something happening</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>
      </div>
    );
  }

  function renderPreview() {
    if (!draft.mode) return null;

    if (draft.mode === "give") {
      return (
        <div style={previewCard}>
          <div style={previewMediaWrap}>
            {itemPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={itemPreviewUrl} alt="Item preview" style={previewImage} />
            ) : (
              <div style={previewPlaceholder}>
                <div style={{ fontSize: 36 }}>📸</div>
                <div style={{ marginTop: 8 }}>Add a photo for your item</div>
              </div>
            )}
            <div style={previewBadge("#fff7ed", "#9a3412", "#fdba74")}>GIVE</div>
          </div>

          <div style={previewBody}>
            <div style={previewMeta}>
              {giveCategoryLabel(draft.giveCategory)} • {draft.pickupLocation}
            </div>
            <div style={previewHeadline}>{cleanTitle || "What are you sharing?"}</div>
            <div style={previewText}>
              {cleanDesc || "Mention condition, quantity, and pickup info so people understand the item immediately."}
            </div>
            <div style={previewFooter}>
              {draft.hideName ? "Anonymous" : "Visible name"} • {expireChoiceLabel(draft.expireChoice)}
            </div>
          </div>
        </div>
      );
    }

    if (draft.mode === "request") {
      return (
        <div style={previewCard}>
          <div style={{ ...previewMediaWrap, height: 156, background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)" }}>
            <div style={{ padding: 18, width: "100%" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={miniPill("#dbeafe", "#1d4ed8", "#93c5fd")}>{requestGroupLabel(draft.requestGroup)}</span>
                <span style={miniPill("#dbeafe", "#1d4ed8", "#93c5fd")}>{requestTimeframeLabel(draft.requestTimeframe)}</span>
              </div>
              <div style={{ marginTop: 14, fontWeight: 1000, fontSize: 24, lineHeight: 1.15 }}>
                {cleanTitle || "What do you need?"}
              </div>
            </div>
            <div style={previewBadge("#eff6ff", "#1d4ed8", "#93c5fd")}>REQUEST</div>
          </div>

          <div style={previewBody}>
            <div style={previewText}>
              {cleanDesc || "Tell the campus community exactly what you need and when you need it."}
            </div>
            <div style={previewFooter}>
              {draft.requestLocation.trim() || "No location added"} • {draft.hideName ? "Anonymous" : "Visible name"}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={previewCard}>
        <div style={previewMediaWrap}>
          {eventPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={eventPreviewUrl} alt="Event preview" style={previewImage} />
          ) : (
            <div style={previewPlaceholder}>
              <div style={{ fontSize: 36 }}>🎫</div>
              <div style={{ marginTop: 8 }}>Add a flyer for your event</div>
            </div>
          )}
          <div style={previewBadge("#f5f3ff", "#6d28d9", "#c4b5fd")}>EVENT</div>
        </div>

        <div style={previewBody}>
          <div style={previewMeta}>
            {eventCategoryLabel(draft.eventCategory)} • {draft.hostOrg.trim() || "Host"}
          </div>
          <div style={previewHeadline}>{cleanTitle || "What’s your event called?"}</div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 900, color: "#6d28d9" }}>
            📍 {draft.eventLocation.trim() || "Location"} • {eventTimeSummary}
          </div>
          <div style={previewText}>
            {cleanDesc || "What should students know before joining? Make the value of the event obvious."}
          </div>
        </div>
      </div>
    );
  }

  function renderMediaSection() {
    if (!draft.mode || draft.mode === "request") return null;

    const isGive = draft.mode === "give";
    const file = isGive ? itemFile : eventFile;
    const preview = isGive ? itemPreviewUrl : eventPreviewUrl;
    const savedName = isGive ? draft.itemFileName : draft.eventFileName;

    return (
      <section ref={mediaRef} style={sectionStyle(fieldError === "media")}>
        <div style={sectionEyebrow}>Media</div>
        <div style={sectionTitle}>
          {isGive ? "Start with a photo" : "Start with a flyer"}
        </div>
        <div style={sectionSub}>
          {isGive
            ? "Show the item first so the post feels real immediately."
            : "A flyer makes the event feel alive before anyone reads the text."}
        </div>

        <input
          ref={isGive ? itemFileInputRef : eventFileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => (isGive ? pickItemFile(e.target.files?.[0] ?? null) : pickEventFile(e.target.files?.[0] ?? null))}
          style={{ display: "none" }}
        />

        <button
          type="button"
          onClick={() => (isGive ? itemFileInputRef.current?.click() : eventFileInputRef.current?.click())}
          style={uploadCard}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Upload preview" style={previewImage} />
          ) : (
            <div style={uploadCardInner}>
              <div style={{ fontSize: 42 }}>{isGive ? "📷" : "🪄"}</div>
              <div style={{ marginTop: 10, fontWeight: 1000, fontSize: 18 }}>
                {isGive ? "Upload item photo" : "Upload event flyer"}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", fontSize: 14 }}>JPG, PNG, or WEBP</div>
            </div>
          )}

          <div style={uploadOverlay}>{file ? "Change image" : "Tap to upload"}</div>
        </button>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>
            {file ? file.name : savedName ? `Saved draft file: ${savedName}` : "No image selected"}
          </div>

          {file && (
            <button
              type="button"
              onClick={() => (isGive ? pickItemFile(null) : pickEventFile(null))}
              style={smallDangerBtn}
            >
              Remove
            </button>
          )}
        </div>
      </section>
    );
  }

  function renderTitleSection() {
    if (!draft.mode) return null;

    return (
      <section ref={titleRef} style={sectionStyle(fieldError === "title")}>
        <div style={sectionEyebrow}>Message</div>
        <div style={sectionTitle}>
          {draft.mode === "request" ? "Write the ask" : "Write the post"}
        </div>

        <input
          value={draft.title}
          onChange={(e) => patchDraft("title", e.target.value)}
          style={headlineInput}
          placeholder={
            draft.mode === "give"
              ? "What are you sharing?"
              : draft.mode === "request"
              ? "What do you need?"
              : "What’s your event called?"
          }
          autoFocus
        />

        <textarea
          value={draft.description}
          onChange={(e) => patchDraft("description", e.target.value)}
          style={editorTextArea}
          rows={5}
          placeholder={
            draft.mode === "give"
              ? "Mention condition, quantity, and pickup info."
              : draft.mode === "request"
              ? "What exactly do you need, and by when?"
              : "What should students know before joining?"
          }
        />

        <div style={helperText}>
          {draft.mode === "give" && "Tip: the simpler and clearer the item description, the faster it gets picked up."}
          {draft.mode === "request" && "Tip: specific asks get better responses than vague ones."}
          {draft.mode === "event" && "Tip: focus on why someone should care enough to attend."}
        </div>
      </section>
    );
  }

  function renderDetailsSection() {
    if (!draft.mode) return null;

    if (draft.mode === "give") {
      return (
        <section ref={detailsRef} style={sectionStyle(fieldError === "details")}>
          <div style={sectionEyebrow}>Details</div>
          <div style={sectionTitle}>Make the item easy to understand</div>

          <div style={{ marginTop: 16 }}>
            <div style={fieldLabel}>Category</div>
            <div style={chipWrap}>
              {(["books", "notes", "electronics", "furniture", "clothing", "others"] as GiveCategory[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("giveCategory", v)}
                  style={chipButton(draft.giveCategory === v, "warm")}
                >
                  {giveCategoryLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={fieldLabel}>Pickup</div>
            <div style={chipWrap}>
              {(
                [
                  "College Quad",
                  "Safety Service Office",
                  "Dining Hall",
                  "Library",
                  "Student Center",
                ] as PickupLocation[]
              ).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("pickupLocation", v)}
                  style={chipButton(draft.pickupLocation === v, "neutral")}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    }

    if (draft.mode === "request") {
      return (
        <section ref={detailsRef} style={sectionStyle(fieldError === "details")}>
          <div style={sectionEyebrow}>Details</div>
          <div style={sectionTitle}>Make your request easy to respond to</div>

          <div style={{ marginTop: 16 }}>
            <div style={fieldLabel}>Request type</div>
            <div style={chipWrap}>
              {(["logistics", "services", "urgent", "collaboration", "lost & found"] as RequestGroup[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("requestGroup", v)}
                  style={chipButton(draft.requestGroup === v, v === "urgent" ? "danger" : "blue")}
                >
                  {requestGroupLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={fieldLabel}>Timeframe</div>
            <div style={chipWrap}>
              {(["today", "this_week", "flexible"] as RequestTimeframe[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("requestTimeframe", v)}
                  style={chipButton(draft.requestTimeframe === v, v === "today" ? "danger" : "blue")}
                >
                  {requestTimeframeLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={fieldLabel}>Location</div>
            <input
              value={draft.requestLocation}
              onChange={(e) => patchDraft("requestLocation", e.target.value)}
              style={softInput}
              placeholder="Optional location"
            />
          </div>
        </section>
      );
    }

    return (
      <section ref={detailsRef} style={sectionStyle(fieldError === "details")}>
        <div style={sectionEyebrow}>Details</div>
        <div style={sectionTitle}>Build the event like a real flyer</div>

        <div style={{ marginTop: 16 }}>
          <div style={fieldLabel}>Category</div>
          <div style={chipWrap}>
            {(["career", "club", "sports", "music", "arts", "volunteering", "academic", "social", "other"] as EventCategory[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patchDraft("eventCategory", v)}
                style={chipButton(draft.eventCategory === v, "purple")}
              >
                {eventCategoryLabel(v)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          <div>
            <div style={fieldLabel}>Host</div>
            <input
              value={draft.hostOrg}
              onChange={(e) => patchDraft("hostOrg", e.target.value)}
              style={softInput}
              placeholder="Host club / organisation"
            />
          </div>

          <div>
            <div style={fieldLabel}>Location</div>
            <input
              value={draft.eventLocation}
              onChange={(e) => patchDraft("eventLocation", e.target.value)}
              style={softInput}
              placeholder="Where is it happening?"
            />
          </div>

          <div style={twoCol}>
            <div>
              <div style={fieldLabel}>Date</div>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patchDraft("eventDate", e.target.value)}
                style={softInput}
              />
            </div>
            <div>
              <div style={fieldLabel}>Start time</div>
              <input
                type="time"
                value={draft.eventStartTime}
                onChange={(e) => patchDraft("eventStartTime", e.target.value)}
                style={softInput}
              />
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <div style={fieldLabel}>End time</div>
              <input
                type="time"
                value={draft.eventEndTime}
                onChange={(e) => patchDraft("eventEndTime", e.target.value)}
                style={softInput}
              />
            </div>
            <div>
              <div style={fieldLabel}>Link</div>
              <input
                value={draft.eventLink}
                onChange={(e) => patchDraft("eventLink", e.target.value)}
                style={softInput}
                placeholder="Optional event link"
              />
            </div>
          </div>

          {!!draft.eventEndTime &&
            !!eventEndIso &&
            !!eventStartIso &&
            new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime() && (
              <div style={inlineWarning}>End time cannot be before start time.</div>
            )}

          {!isValidHttpUrlMaybeEmpty(draft.eventLink) && (
            <div style={inlineWarning}>Link must start with http:// or https://</div>
          )}
        </div>
      </section>
    );
  }

  function renderOptionsSection() {
    if (!draft.mode) return null;

    return (
      <section ref={optionsRef} style={sectionStyle(fieldError === "options")}>
        <div style={sectionEyebrow}>Options</div>
        <div style={sectionTitle}>Final settings</div>

        <div style={{ marginTop: 16 }}>
          <div style={fieldLabel}>Visibility</div>
          <div style={chipWrap}>
            <button
              type="button"
              onClick={() => patchDraft("hideName", false)}
              style={chipButton(!draft.hideName, "neutral")}
            >
              Show my name
            </button>
            <button
              type="button"
              onClick={() => patchDraft("hideName", true)}
              style={chipButton(draft.hideName, "neutral")}
            >
              Post anonymously
            </button>
          </div>
        </div>

        {draft.mode !== "event" && (
          <div style={{ marginTop: 18 }}>
            <div style={fieldLabel}>Auto-close</div>
            <div style={chipWrap}>
              {(["urgent24", "7", "14", "30", "never"] as ExpireChoice[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("expireChoice", v)}
                  style={chipButton(draft.expireChoice === v, v === "urgent24" ? "danger" : "neutral")}
                >
                  {expireChoiceLabel(v)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  function stickyHint() {
    if (!draft.mode) return "Choose a post type to begin.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email.";
    if (!profileComplete) return "Finish your profile first.";

    const validation = validateBeforeSubmit();
    if (validation) return validation.message;

    return "Ready to publish.";
  }

  function primaryLabel() {
    if (saving) return "Posting…";
    if (draft.mode === "give") return "Share item";
    if (draft.mode === "request") return "Post request";
    if (draft.mode === "event") return "Publish event";
    return "Continue";
  }

  if (!hydratedDraft || authLoading || profileLoading) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={statusCard}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Loading…</div>
            <div style={{ marginTop: 6, color: "#64748b" }}>
              Restoring your draft and checking account status.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={statusCard}>
            <div style={{ fontWeight: 1000, fontSize: 24 }}>You need your Ashland email</div>
            <div style={{ marginTop: 8, color: "#64748b" }}>
              Log in with your <b>@ashland.edu</b> account before posting.
            </div>
            <button onClick={() => router.push("/me")} style={{ ...primaryBtn(false), marginTop: 16 }}>
              Go to account
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
          <div style={statusCard}>
            <div style={{ fontWeight: 1000, fontSize: 24 }}>Complete your profile</div>
            <div style={{ marginTop: 8, color: "#64748b" }}>
              Add your full name and choose Student or Faculty first.
            </div>
            <button onClick={() => router.push("/me")} style={{ ...primaryBtn(false), marginTop: 16 }}>
              Finish profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div ref={topRef} style={shell}>
        <div style={headerWrap}>
          <div>
            <div style={pageTitle}>{draft.mode ? "Create post" : "Create"}</div>
            <div style={pageSub}>
              {draft.mode ? "Build one post at a time." : "What do you want to share today?"}
            </div>
          </div>

          <button onClick={() => router.push("/feed")} style={headerPillBtn}>
            ← Feed
          </button>
        </div>

        <div style={accountCard}>
          <div style={{ fontSize: 13, color: "#475569", fontWeight: 800 }}>
            Posting as <b>{email}</b>
          </div>
        </div>

        {!draft.mode ? (
          <div style={{ marginTop: 10 }}>{renderModePicker()}</div>
        ) : (
          <div style={isDesktop ? desktopComposerGrid : mobileComposerStack}>
            <div style={composerShell}>
              <div style={composerTopBar}>
                <button type="button" onClick={goBackToModes} style={lightPillBtn} disabled={saving}>
                  ← Back to types
                </button>

                <button type="button" onClick={() => resetComposer(true)} style={lightPillBtn} disabled={saving}>
                  Reset
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 1000, fontSize: 22 }}>
                  {draft.mode === "give" && "Share with campus"}
                  {draft.mode === "request" && "Ask the campus community"}
                  {draft.mode === "event" && "Promote your event"}
                </div>
                <div style={{ marginTop: 6, color: "#64748b", fontSize: 14 }}>
                  One focused composer. No clutter from the other post types.
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={progressTrack}>
                    <div style={{ ...progressFill, width: `${Math.round(progressValue * 100)}%` }} />
                  </div>
                  <div style={progressLabels}>
                    <span>Start</span>
                    <span>Details</span>
                    <span>Ready</span>
                  </div>
                </div>
              </div>

              {renderMediaSection()}
              {renderTitleSection()}
              {renderDetailsSection()}
              {renderOptionsSection()}

              {!isDesktop && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Live preview</div>
                  {renderPreview()}
                </div>
              )}

              {msg && <div style={errorBanner}>{msg}</div>}
            </div>

            {isDesktop && (
              <div style={previewColumn}>
                <div style={previewSticky}>
                  <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Live preview</div>
                  {renderPreview()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {draft.mode && (
        <div style={stickyBar}>
          <div style={stickyInner}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Composer status</div>
              <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                {stickyHint()}
              </div>
            </div>

            <button type="button" onClick={goBackToModes} style={ghostBtn} disabled={saving}>
              Back
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              style={primaryBtn(saving)}
            >
              {primaryLabel()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- styles ---------------- */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f8fafc 0%, #f6f7fb 45%, #f8fafc 100%)",
  color: "#0f172a",
  padding: 16,
  paddingBottom:
    "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + 120px)",
};

const shell: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
};

const headerWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const pageTitle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 1000,
  letterSpacing: "-0.04em",
};

const pageSub: React.CSSProperties = {
  marginTop: 4,
  color: "#64748b",
  fontSize: 14,
  fontWeight: 600,
};

const headerPillBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "rgba(255,255,255,0.86)",
  color: "#0f172a",
  padding: "10px 14px",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 900,
};

const accountCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.88)",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: "12px 14px",
  boxShadow: "0 10px 25px rgba(15,23,42,0.04)",
};

const statusCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #e5e7eb",
  borderRadius: 24,
  padding: 22,
  boxShadow: "0 24px 60px rgba(15,23,42,0.06)",
};

const desktopComposerGrid: React.CSSProperties = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.95fr)",
  gap: 18,
  alignItems: "start",
};

const mobileComposerStack: React.CSSProperties = {
  marginTop: 16,
  display: "block",
};

const composerShell: React.CSSProperties = {
  background: "rgba(255,255,255,0.9)",
  border: "1px solid #e5e7eb",
  borderRadius: 28,
  padding: 18,
  boxShadow: "0 24px 70px rgba(15,23,42,0.08)",
};

const composerTopBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const lightPillBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#0f172a",
  padding: "10px 14px",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 900,
};

const previewColumn: React.CSSProperties = {
  minWidth: 0,
};

const previewSticky: React.CSSProperties = {
  position: "sticky",
  top: 16,
};

function modeCard(tone: "warm" | "blue" | "purple"): React.CSSProperties {
  const palette =
    tone === "warm"
      ? {
          bg: "linear-gradient(135deg, #fff7ed 0%, #ffffff 100%)",
          border: "#fed7aa",
        }
      : tone === "blue"
      ? {
          bg: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)",
          border: "#bfdbfe",
        }
      : {
          bg: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)",
          border: "#c4b5fd",
        };

  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 16,
    textAlign: "left",
    padding: 18,
    borderRadius: 24,
    border: `1.5px solid ${palette.border}`,
    background: palette.bg,
    boxShadow: "0 10px 26px rgba(15,23,42,0.05)",
    cursor: "pointer",
  };
}

const modeIconBox: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 20,
  display: "grid",
  placeItems: "center",
  fontSize: 28,
  background: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(255,255,255,0.95)",
  flexShrink: 0,
};

const modeTitle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 1000,
  lineHeight: 1.1,
};

const modeDesc: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  color: "#475569",
  fontWeight: 700,
};

const modeArrow: React.CSSProperties = {
  fontSize: 26,
  color: "#64748b",
  flexShrink: 0,
};

function sectionStyle(highlight: boolean): React.CSSProperties {
  return {
    marginTop: 18,
    paddingTop: 18,
    borderTop: "1px solid #eef2f7",
    scrollMarginTop: 90,
    outline: highlight ? "2px solid #fecdd3" : "none",
    outlineOffset: 6,
    borderRadius: 16,
  };
}

const sectionEyebrow: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 1000,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const sectionTitle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 24,
  fontWeight: 1000,
  letterSpacing: "-0.03em",
};

const sectionSub: React.CSSProperties = {
  marginTop: 6,
  fontSize: 14,
  color: "#64748b",
  lineHeight: 1.5,
};

const uploadCard: React.CSSProperties = {
  width: "100%",
  height: 260,
  marginTop: 16,
  borderRadius: 24,
  overflow: "hidden",
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  cursor: "pointer",
  position: "relative",
  padding: 0,
};

const uploadCardInner: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: 20,
};

const uploadOverlay: React.CSSProperties = {
  position: "absolute",
  right: 14,
  bottom: 14,
  padding: "9px 12px",
  borderRadius: 999,
  background: "rgba(15,23,42,0.78)",
  color: "white",
  fontSize: 12,
  fontWeight: 1000,
};

const headlineInput: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  padding: "14px 0",
  fontSize: 30,
  fontWeight: 1000,
  letterSpacing: "-0.04em",
  border: "none",
  borderBottom: "1px solid #e5e7eb",
  outline: "none",
  background: "transparent",
  color: "#0f172a",
};

const editorTextArea: React.CSSProperties = {
  width: "100%",
  marginTop: 14,
  padding: "0 0 10px 0",
  border: "none",
  borderBottom: "1px solid #e5e7eb",
  outline: "none",
  resize: "vertical",
  fontSize: 16,
  lineHeight: 1.65,
  background: "transparent",
  color: "#0f172a",
};

const helperText: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  color: "#64748b",
  fontWeight: 700,
};

const fieldLabel: React.CSSProperties = {
  marginBottom: 10,
  fontSize: 13,
  color: "#475569",
  fontWeight: 900,
};

const chipWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};

function chipButton(active: boolean, tone: "warm" | "blue" | "purple" | "neutral" | "danger"): React.CSSProperties {
  const palette =
    tone === "warm"
      ? {
          bg: active ? "#ffedd5" : "#ffffff",
          border: active ? "#fb923c" : "#e5e7eb",
          color: active ? "#9a3412" : "#0f172a",
        }
      : tone === "blue"
      ? {
          bg: active ? "#dbeafe" : "#ffffff",
          border: active ? "#60a5fa" : "#e5e7eb",
          color: active ? "#1d4ed8" : "#0f172a",
        }
      : tone === "purple"
      ? {
          bg: active ? "#ede9fe" : "#ffffff",
          border: active ? "#8b5cf6" : "#e5e7eb",
          color: active ? "#6d28d9" : "#0f172a",
        }
      : tone === "danger"
      ? {
          bg: active ? "#ffe4e6" : "#ffffff",
          border: active ? "#fb7185" : "#e5e7eb",
          color: active ? "#be123c" : "#0f172a",
        }
      : {
          bg: active ? "#f1f5f9" : "#ffffff",
          border: active ? "#94a3b8" : "#e5e7eb",
          color: "#0f172a",
        };

  return {
    padding: "10px 14px",
    borderRadius: 999,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.color,
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
  };
}

const softInput: React.CSSProperties = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
};

const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const inlineWarning: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 14,
  background: "#fff1f2",
  color: "#9f1239",
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid #fecdd3",
};

const progressTrack: React.CSSProperties = {
  width: "100%",
  height: 6,
  borderRadius: 999,
  background: "#e2e8f0",
  overflow: "hidden",
};

const progressFill: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #0f172a 0%, #6366f1 100%)",
  transition: "width 220ms ease",
};

const progressLabels: React.CSSProperties = {
  marginTop: 8,
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const previewCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #e5e7eb",
  borderRadius: 26,
  overflow: "hidden",
  boxShadow: "0 20px 50px rgba(15,23,42,0.08)",
};

const previewMediaWrap: React.CSSProperties = {
  position: "relative",
  height: 240,
  background: "#f8fafc",
  borderBottom: "1px solid #eef2f7",
  overflow: "hidden",
};

const previewImage: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const previewPlaceholder: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  color: "#64748b",
  fontWeight: 800,
  padding: 20,
};

function previewBadge(bg: string, color: string, border: string): React.CSSProperties {
  return {
    position: "absolute",
    top: 14,
    left: 14,
    padding: "7px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 1000,
    color,
    background: bg,
    border: `1px solid ${border}`,
  };
}

const previewBody: React.CSSProperties = {
  padding: 18,
};

const previewMeta: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 900,
};

const previewHeadline: React.CSSProperties = {
  marginTop: 8,
  fontSize: 24,
  lineHeight: 1.14,
  fontWeight: 1000,
  letterSpacing: "-0.03em",
};

const previewText: React.CSSProperties = {
  marginTop: 12,
  fontSize: 14,
  color: "#334155",
  lineHeight: 1.55,
};

const previewFooter: React.CSSProperties = {
  marginTop: 14,
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

function miniPill(bg: string, color: string, border: string): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 999,
    background: bg,
    color,
    border: `1px solid ${border}`,
    fontSize: 12,
    fontWeight: 1000,
  };
}

const errorBanner: React.CSSProperties = {
  marginTop: 18,
  padding: "14px 16px",
  borderRadius: 18,
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  color: "#9f1239",
  fontWeight: 900,
};

const smallDangerBtn: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#be123c",
  borderRadius: 999,
  padding: "7px 11px",
  fontWeight: 900,
  cursor: "pointer",
};

const stickyBar: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px))",
  padding: "10px 12px",
  zIndex: 9999,
  display: "flex",
  justifyContent: "center",
  pointerEvents: "none",
};

const stickyInner: React.CSSProperties = {
  width: "100%",
  maxWidth: 1180,
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "rgba(255,255,255,0.9)",
  border: "1px solid rgba(226,232,240,0.95)",
  borderRadius: 24,
  padding: "14px 16px",
  boxShadow: "0 18px 50px rgba(15,23,42,0.14)",
  backdropFilter: "blur(16px)",
  pointerEvents: "auto",
};

const ghostBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#0f172a",
  padding: "12px 16px",
  borderRadius: 16,
  cursor: "pointer",
  fontWeight: 900,
  whiteSpace: "nowrap",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "none",
    background: disabled ? "#94a3b8" : "#03133d",
    color: "white",
    padding: "13px 18px",
    borderRadius: 18,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 1000,
    minWidth: 148,
    opacity: disabled ? 0.58 : 1,
    boxShadow: disabled ? "none" : "0 18px 35px rgba(3,19,61,0.22)",
    whiteSpace: "nowrap",
  };
}