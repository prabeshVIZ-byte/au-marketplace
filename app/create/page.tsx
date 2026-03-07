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

const ITEMS_TABLE = "items";
const ITEM_PHOTOS_TABLE = "item_photos";
const EVENTS_TABLE = "events";

const ITEM_PHOTOS_BUCKET = "item-photos";
const EVENT_FLYERS_BUCKET = "event-flyers";

const MAX_ITEM_PHOTO_MB = 6;
const MAX_EVENT_FLYER_MB = 8;

const DRAFT_KEY = "scholarswap_create_draft_modern_v1";
const SUCCESS_ROUTE = "/feed";
const STICKY_HEIGHT = 92;

/* ------------------------------ utils ------------------------------ */

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

/* ------------------------------ main ------------------------------ */

export default function CreatePage() {
  const router = useRouter();

  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  const topComposerRef = useRef<HTMLDivElement | null>(null);
  const mediaSectionRef = useRef<HTMLDivElement | null>(null);
  const titleSectionRef = useRef<HTMLDivElement | null>(null);
  const detailsSectionRef = useRef<HTMLDivElement | null>(null);
  const optionsSectionRef = useRef<HTMLDivElement | null>(null);

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
  const [fieldError, setFieldError] = useState<string | null>(null);

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
      const merged = { ...getDefaultDraft(), ...parsed };
      setDraft(merged as DraftState);
    } catch {
      // ignore broken draft
    } finally {
      setHydratedDraft(true);
    }
  }, []);

  useEffect(() => {
    if (!hydratedDraft) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
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

  function resetComposer() {
    setDraft(getDefaultDraft());
    setItemFile(null);
    setEventFile(null);
    setMsg(null);
    setFieldError(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function selectMode(mode: Mode) {
    setMsg(null);
    setFieldError(null);
    setItemFile(null);
    setEventFile(null);
    setDraft({
      ...getDefaultDraft(),
      mode,
    });

    requestAnimationFrame(() => {
      topComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (file.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_ITEM_PHOTO_MB}MB.`);
      setFieldError("media");
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (file.size > MAX_EVENT_FLYER_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_EVENT_FLYER_MB}MB.`);
      setFieldError("media");
      mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setEventFile(file);
    patchDraft("eventFileName", file.name);
  }

  const hasRequiredMedia =
    draft.mode === "request" ? true : draft.mode === "give" ? !!itemFile : draft.mode === "event" ? !!eventFile : false;

  const hasBasicTitle = cleanTitle.length >= 3;
  const hasBasicDescription = cleanDesc.length >= 3;

  const detailsReady =
    draft.mode === "give"
      ? hasBasicTitle && hasBasicDescription
      : draft.mode === "request"
      ? hasBasicTitle && hasBasicDescription
      : draft.mode === "event"
      ? hasBasicTitle && hasBasicDescription && draft.hostOrg.trim().length > 0
      : false;

  const secondaryReady =
    draft.mode === "give"
      ? !!draft.giveCategory && !!draft.pickupLocation
      : draft.mode === "request"
      ? !!draft.requestGroup && !!draft.requestTimeframe
      : draft.mode === "event"
      ? !!draft.eventCategory &&
        !!draft.eventLocation.trim() &&
        !!draft.eventDate &&
        !!draft.eventStartTime &&
        !!eventStartIso &&
        isValidHttpUrlMaybeEmpty(draft.eventLink) &&
        !(draft.eventEndTime && eventEndIso && new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime())
      : false;

  const composerProgress = useMemo(() => {
    if (!draft.mode) return 0;
    let done = 0;
    if (hasRequiredMedia) done += 1;
    if (detailsReady) done += 1;
    if (secondaryReady) done += 1;
    return done / 3;
  }, [draft.mode, hasRequiredMedia, detailsReady, secondaryReady]);

  const eventTimeSummary = eventStartIso
    ? `${formatLongDateTime(eventStartIso)}${eventEndIso ? ` → ${formatLongDateTime(eventEndIso)}` : ""}`
    : "—";

  function validateBeforeSubmit(): { message: string; section: "media" | "title" | "details" | "options" | "account" } | null {
    if (!draft.mode) return { message: "Choose Give, Request, or Event first.", section: "account" };
    if (!isLoggedIn) return { message: "Log in with your @ashland.edu email to post.", section: "account" };
    if (!profileComplete) return { message: "Complete your profile first.", section: "account" };

    if (draft.mode === "give") {
      if (!itemFile) return { message: "Add a photo to continue.", section: "media" };
      if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
      if (cleanDesc.length < 3) return { message: "Description is required.", section: "details" };
      if (!draft.giveCategory) return { message: "Choose a category.", section: "details" };
      if (!draft.pickupLocation) return { message: "Choose a pickup location.", section: "details" };
      return null;
    }

    if (draft.mode === "request") {
      if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
      if (cleanDesc.length < 3) return { message: "Description is required.", section: "details" };
      if (!draft.requestGroup) return { message: "Choose a request type.", section: "details" };
      if (!draft.requestTimeframe) return { message: "Choose a timeframe.", section: "details" };
      return null;
    }

    if (!eventFile) return { message: "Add a flyer image to continue.", section: "media" };
    if (cleanTitle.length < 3) return { message: "Title must be at least 3 characters.", section: "title" };
    if (!draft.hostOrg.trim()) return { message: "Host is required.", section: "details" };
    if (cleanDesc.length < 3) return { message: "Description is required.", section: "details" };
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

  function scrollToSection(section: "media" | "title" | "details" | "options" | "account") {
    if (section === "media") mediaSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "title") titleSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "details") detailsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "options") optionsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (section === "account") topComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

        resetComposer();
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
        resetComposer();
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

      resetComposer();
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(errToMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function renderPreviewCard() {
    if (!draft.mode) {
      return (
        <div style={previewCard}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Live preview</div>
          <div style={{ marginTop: 8, color: "#64748b", lineHeight: 1.5 }}>
            Choose a post type to start building your post. Your preview will update as you type.
          </div>
        </div>
      );
    }

    if (draft.mode === "give") {
      return (
        <div style={previewCard}>
          <div style={previewMedia}>
            {itemPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={itemPreviewUrl} alt="Give preview" style={previewImage} />
            ) : (
              <div style={previewPlaceholder}>
                <div style={{ fontSize: 40 }}>📸</div>
                <div style={{ marginTop: 8 }}>Add a photo for your item</div>
              </div>
            )}

            <div style={previewBadgeWarm}>GIVE</div>
          </div>

          <div style={previewBody}>
            <div style={previewMetaRow}>
              <span>{giveCategoryLabel(draft.giveCategory)}</span>
              <span>•</span>
              <span>{draft.pickupLocation}</span>
            </div>

            <div style={previewTitle}>{cleanTitle || "What are you sharing?"}</div>

            <div style={previewText}>
              {cleanDesc || "Mention condition, quantity, and pickup info so others know exactly what you’re offering."}
            </div>

            <div style={previewFooterRow}>
              <span>{draft.hideName ? "Anonymous" : "Visible name"}</span>
              <span>•</span>
              <span>{expireChoiceLabel(draft.expireChoice)}</span>
            </div>
          </div>
        </div>
      );
    }

    if (draft.mode === "request") {
      return (
        <div style={previewCard}>
          <div
            style={{
              ...previewMedia,
              height: 148,
              background: "linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)",
            }}
          >
            <div style={{ padding: 18, width: "100%", display: "flex", flexDirection: "column", justifyContent: "end" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={miniTagBlue}>{requestGroupLabel(draft.requestGroup)}</span>
                <span style={miniTagBlue}>{requestTimeframeLabel(draft.requestTimeframe)}</span>
              </div>

              <div style={{ marginTop: 12, fontWeight: 950, fontSize: 23, lineHeight: 1.15 }}>
                {cleanTitle || "What do you need?"}
              </div>
            </div>

            <div style={previewBadgeBlue}>REQUEST</div>
          </div>

          <div style={previewBody}>
            <div style={previewText}>
              {cleanDesc || "Tell the campus community what you need, why you need it, and when you need it."}
            </div>

            <div style={previewFooterRow}>
              <span>{draft.requestLocation.trim() || "No location added"}</span>
              <span>•</span>
              <span>{draft.hideName ? "Anonymous" : "Visible name"}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={previewCard}>
        <div style={previewMedia}>
          {eventPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={eventPreviewUrl} alt="Event preview" style={previewImage} />
          ) : (
            <div style={previewPlaceholder}>
              <div style={{ fontSize: 40 }}>🎫</div>
              <div style={{ marginTop: 8 }}>Add a flyer for your event</div>
            </div>
          )}

          <div style={previewBadgePurple}>EVENT</div>
        </div>

        <div style={previewBody}>
          <div style={previewMetaRow}>
            <span>{eventCategoryLabel(draft.eventCategory)}</span>
            <span>•</span>
            <span>{draft.hostOrg.trim() || "Host"}</span>
          </div>

          <div style={previewTitle}>{cleanTitle || "What’s your event called?"}</div>

          <div style={{ marginTop: 8, fontSize: 13, color: "#7c3aed", fontWeight: 900 }}>
            📍 {draft.eventLocation.trim() || "Location"} • {eventTimeSummary}
          </div>

          <div style={previewText}>
            {cleanDesc || "What should students know before joining? Share the details that make the event worth attending."}
          </div>
        </div>
      </div>
    );
  }

  function renderModePicker() {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <button type="button" onClick={() => selectMode("give")} style={heroCard(draft.mode === "give", "warm")}>
          <div style={heroIcon}>🎁</div>
          <div style={{ flex: 1 }}>
            <div style={heroTitle}>Give</div>
            <div style={heroDesc}>Share something useful</div>
          </div>
          <div style={heroArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("request")} style={heroCard(draft.mode === "request", "blue")}>
          <div style={heroIcon}>🤝</div>
          <div style={{ flex: 1 }}>
            <div style={heroTitle}>Request</div>
            <div style={heroDesc}>Ask the campus community</div>
          </div>
          <div style={heroArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("event")} style={heroCard(draft.mode === "event", "purple")}>
          <div style={heroIcon}>📅</div>
          <div style={{ flex: 1 }}>
            <div style={heroTitle}>Event</div>
            <div style={heroDesc}>Promote something happening</div>
          </div>
          <div style={heroArrow}>→</div>
        </button>
      </div>
    );
  }

  function renderMediaSection() {
    if (!draft.mode || draft.mode === "request") return null;

    const isGive = draft.mode === "give";
    const file = isGive ? itemFile : eventFile;
    const previewUrl = isGive ? itemPreviewUrl : eventPreviewUrl;
    const savedName = isGive ? draft.itemFileName : draft.eventFileName;

    return (
      <section ref={mediaSectionRef} style={sectionWrap(fieldError === "media")}>
        <div style={sectionLabel}>Media</div>
        <div style={sectionTitle}>{isGive ? "Start with a photo" : "Start with a flyer"}</div>
        <div style={sectionSub}>
          {isGive
            ? "Posts feel more real when people see the item first."
            : "A good flyer makes your event look worth opening."}
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
          style={uploadHeroButton}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={uploadHeroInner}>
              <div style={{ fontSize: 44 }}>{isGive ? "📷" : "🪄"}</div>
              <div style={{ marginTop: 10, fontWeight: 900, fontSize: 18 }}>
                {isGive ? "Upload item photo" : "Upload event flyer"}
              </div>
              <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>JPG, PNG, or WEBP</div>
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
              style={smallDangerBtn}
              onClick={() => (isGive ? pickItemFile(null) : pickEventFile(null))}
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

    const titlePlaceholder =
      draft.mode === "give"
        ? "What are you sharing?"
        : draft.mode === "request"
        ? "What do you need?"
        : "What’s your event called?";

    const descPlaceholder =
      draft.mode === "give"
        ? "Mention condition, quantity, and pickup info."
        : draft.mode === "request"
        ? "What exactly do you need, and by when?"
        : "What should students know before joining?";

    return (
      <section ref={titleSectionRef} style={sectionWrap(fieldError === "title")}>
        <div style={sectionLabel}>Message</div>
        <div style={sectionTitle}>
          {draft.mode === "request" ? "Write the ask" : "Write the post"}
        </div>

        <input
          value={draft.title}
          onChange={(e) => patchDraft("title", e.target.value)}
          style={headlineInput}
          placeholder={titlePlaceholder}
          autoFocus={draft.mode === "request"}
        />

        <textarea
          value={draft.description}
          onChange={(e) => patchDraft("description", e.target.value)}
          style={editorTextarea}
          rows={5}
          placeholder={descPlaceholder}
        />

        <div style={helperText}>
          {draft.mode === "give" && "Tip: clear condition + pickup info gets more responses."}
          {draft.mode === "request" && "Tip: be specific so people know whether they can help."}
          {draft.mode === "event" && "Tip: focus on why someone should show up."}
        </div>
      </section>
    );
  }

  function renderDetailsSection() {
    if (!draft.mode) return null;

    if (draft.mode === "give") {
      return (
        <section ref={detailsSectionRef} style={sectionWrap(fieldError === "details")}>
          <div style={sectionLabel}>Details</div>
          <div style={sectionTitle}>Help people understand the item</div>

          <div style={{ marginTop: 16 }}>
            <div style={chipLabel}>Category</div>
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
            <div style={chipLabel}>Pickup</div>
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
        <section ref={detailsSectionRef} style={sectionWrap(fieldError === "details")}>
          <div style={sectionLabel}>Details</div>
          <div style={sectionTitle}>Make your request easy to respond to</div>

          <div style={{ marginTop: 16 }}>
            <div style={chipLabel}>Request type</div>
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
            <div style={chipLabel}>Timeframe</div>
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
            <div style={chipLabel}>Location</div>
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
      <section ref={detailsSectionRef} style={sectionWrap(fieldError === "details")}>
        <div style={sectionLabel}>Details</div>
        <div style={sectionTitle}>Build the event like a real flyer</div>

        <div style={{ marginTop: 16 }}>
          <div style={chipLabel}>Category</div>
          <div style={chipWrap}>
            {(["career", "club", "sports", "music", "arts", "academic", "social", "volunteering", "other"] as EventCategory[]).map((v) => (
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
            <div style={chipLabel}>Host</div>
            <input
              value={draft.hostOrg}
              onChange={(e) => patchDraft("hostOrg", e.target.value)}
              style={softInput}
              placeholder="Host club / organisation"
            />
          </div>

          <div>
            <div style={chipLabel}>Location</div>
            <input
              value={draft.eventLocation}
              onChange={(e) => patchDraft("eventLocation", e.target.value)}
              style={softInput}
              placeholder="Where is it happening?"
            />
          </div>

          <div style={grid2}>
            <div>
              <div style={chipLabel}>Date</div>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patchDraft("eventDate", e.target.value)}
                style={softInput}
              />
            </div>
            <div>
              <div style={chipLabel}>Start time</div>
              <input
                type="time"
                value={draft.eventStartTime}
                onChange={(e) => patchDraft("eventStartTime", e.target.value)}
                style={softInput}
              />
            </div>
          </div>

          <div style={grid2}>
            <div>
              <div style={chipLabel}>End time</div>
              <input
                type="time"
                value={draft.eventEndTime}
                onChange={(e) => patchDraft("eventEndTime", e.target.value)}
                style={softInput}
              />
            </div>
            <div>
              <div style={chipLabel}>Link</div>
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
      <section ref={optionsSectionRef} style={sectionWrap(fieldError === "options")}>
        <div style={sectionLabel}>Options</div>
        <div style={sectionTitle}>A few final settings</div>

        <div style={{ marginTop: 16 }}>
          <div style={chipLabel}>Visibility</div>
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
            <div style={chipLabel}>Auto-close</div>
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

  function getStickyHint() {
    if (!draft.mode) return "Choose a post type to begin.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email.";
    if (!profileComplete) return "Finish your profile first.";
    const validation = validateBeforeSubmit();
    if (validation) return validation.message;
    return "Ready to publish.";
  }

  function getPrimaryLabel() {
    if (saving) return "Posting…";
    if (!draft.mode) return "Choose a type";
    if (draft.mode === "give") return "Share item";
    if (draft.mode === "request") return "Post request";
    return "Publish event";
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

  const primaryDisabled = saving || !draft.mode;

  return (
    <div style={pageStyle}>
      <div style={shell}>
        <div style={topBar}>
          <div>
            <div style={appTitle}>Create</div>
            <div style={appSub}>What do you want to share today?</div>
          </div>

          <button onClick={() => router.push("/feed")} style={topPillBtn}>
            ← Feed
          </button>
        </div>

        <div style={postingAsCard}>
          <div style={{ fontSize: 13, color: "#475569", fontWeight: 800 }}>
            Posting as <b>{email}</b>
          </div>
        </div>

        {renderModePicker()}

        {draft.mode && (
          <div ref={topComposerRef} style={contentGrid}>
            <div style={composerShell}>
              <div style={composerProgressWrap}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 950, fontSize: 18 }}>
                      {draft.mode === "give" && "Share with campus"}
                      {draft.mode === "request" && "Ask the campus community"}
                      {draft.mode === "event" && "Promote your event"}
                    </div>
                    <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                      Build your post in one clean composer.
                    </div>
                  </div>

                  <button type="button" onClick={resetComposer} style={subtleResetBtn} disabled={saving}>
                    Reset
                  </button>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={progressTrack}>
                    <div style={{ ...progressFill, width: `${Math.round(composerProgress * 100)}%` }} />
                  </div>
                  <div style={progressLegend}>
                    <span>Media</span>
                    <span>Details</span>
                    <span>Ready</span>
                  </div>
                </div>
              </div>

              {renderMediaSection()}
              {renderTitleSection()}
              {detailsReady || draft.mode === "request" ? renderDetailsSection() : renderDetailsSection()}
              {renderOptionsSection()}

              {msg && <div style={errorBanner}>{msg}</div>}
            </div>

            <div style={previewColumn}>
              <div style={previewSticky}>{renderPreviewCard()}</div>
            </div>
          </div>
        )}
      </div>

      {draft.mode && (
        <div style={stickyBar}>
          <div style={stickyInner}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Composer status</div>
              <div style={{ marginTop: 3, fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{getStickyHint()}</div>
            </div>

            <button type="button" onClick={() => router.push("/feed")} style={ghostBtn} disabled={saving}>
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={primaryDisabled}
              style={primaryBtn(primaryDisabled)}
            >
              {getPrimaryLabel()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ styles ------------------------------ */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f8fafc 0%, #f6f7fb 45%, #f8fafc 100%)",
  color: "#0f172a",
  padding: 18,
  paddingBottom: `calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + ${STICKY_HEIGHT}px + 30px)`,
};

const shell: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
};

const topBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 16,
};

const appTitle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 1000,
  letterSpacing: "-0.04em",
};

const appSub: React.CSSProperties = {
  marginTop: 5,
  fontSize: 15,
  color: "#64748b",
  fontWeight: 600,
};

const topPillBtn: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  background: "rgba(255,255,255,0.88)",
  color: "#0f172a",
  padding: "11px 16px",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 900,
  backdropFilter: "blur(10px)",
};

const postingAsCard: React.CSSProperties = {
  marginBottom: 14,
  background: "rgba(255,255,255,0.82)",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: "12px 14px",
  boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
};

const statusCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #e5e7eb",
  borderRadius: 24,
  padding: 22,
  boxShadow: "0 24px 60px rgba(15,23,42,0.06)",
};

const contentGrid: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.95fr)",
  gap: 18,
  alignItems: "start",
};

const composerShell: React.CSSProperties = {
  background: "rgba(255,255,255,0.86)",
  border: "1px solid rgba(226,232,240,0.95)",
  borderRadius: 30,
  padding: 20,
  boxShadow: "0 30px 80px rgba(15,23,42,0.08)",
  backdropFilter: "blur(14px)",
};

const composerProgressWrap: React.CSSProperties = {
  paddingBottom: 20,
  marginBottom: 18,
  borderBottom: "1px solid #edf2f7",
};

const progressTrack: React.CSSProperties = {
  width: "100%",
  height: 6,
  background: "#e2e8f0",
  borderRadius: 999,
  overflow: "hidden",
};

const progressFill: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #0f172a 0%, #6366f1 100%)",
  transition: "width 220ms ease",
};

const progressLegend: React.CSSProperties = {
  marginTop: 8,
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const previewColumn: React.CSSProperties = {
  minWidth: 0,
};

const previewSticky: React.CSSProperties = {
  position: "sticky",
  top: 16,
};

const previewCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  border: "1px solid #e5e7eb",
  borderRadius: 28,
  overflow: "hidden",
  boxShadow: "0 24px 60px rgba(15,23,42,0.08)",
};

const previewMedia: React.CSSProperties = {
  position: "relative",
  height: 250,
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

const previewBody: React.CSSProperties = {
  padding: 18,
};

const previewBadgeWarm: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  padding: "7px 11px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 1000,
  color: "#9a3412",
  background: "rgba(255,247,237,0.94)",
  border: "1px solid #fdba74",
};

const previewBadgeBlue: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  padding: "7px 11px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 1000,
  color: "#1d4ed8",
  background: "rgba(239,246,255,0.95)",
  border: "1px solid #93c5fd",
};

const previewBadgePurple: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  padding: "7px 11px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 1000,
  color: "#6d28d9",
  background: "rgba(245,243,255,0.95)",
  border: "1px solid #c4b5fd",
};

const previewMetaRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#64748b",
  fontWeight: 900,
};

const previewTitle: React.CSSProperties = {
  marginTop: 9,
  fontSize: 25,
  lineHeight: 1.12,
  fontWeight: 1000,
  letterSpacing: "-0.03em",
};

const previewText: React.CSSProperties = {
  marginTop: 12,
  color: "#334155",
  fontSize: 14,
  lineHeight: 1.55,
};

const previewFooterRow: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const miniTagBlue: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.78)",
  border: "1px solid #bfdbfe",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 1000,
};

const heroIcon: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 18,
  display: "grid",
  placeItems: "center",
  fontSize: 26,
  background: "rgba(255,255,255,0.72)",
  border: "1px solid rgba(255,255,255,0.85)",
  flexShrink: 0,
};

const heroTitle: React.CSSProperties = {
  fontSize: 21,
  fontWeight: 1000,
  letterSpacing: "-0.02em",
};

const heroDesc: React.CSSProperties = {
  marginTop: 6,
  fontSize: 14,
  color: "#475569",
  fontWeight: 700,
};

const heroArrow: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 1000,
  color: "#0f172a",
  opacity: 0.7,
};

function heroCard(active: boolean, tone: "warm" | "blue" | "purple"): React.CSSProperties {
  const palette =
    tone === "warm"
      ? {
          bg: "linear-gradient(135deg, #fff7ed 0%, #ffffff 100%)",
          border: active ? "#fb923c" : "#fed7aa",
          glow: "rgba(251,146,60,0.14)",
        }
      : tone === "blue"
      ? {
          bg: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)",
          border: active ? "#60a5fa" : "#bfdbfe",
          glow: "rgba(96,165,250,0.14)",
        }
      : {
          bg: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)",
          border: active ? "#8b5cf6" : "#ddd6fe",
          glow: "rgba(139,92,246,0.14)",
        };

  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 16,
    textAlign: "left",
    padding: 18,
    borderRadius: 24,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    boxShadow: active ? `0 16px 40px ${palette.glow}` : "0 8px 20px rgba(15,23,42,0.04)",
    cursor: "pointer",
    transition: "all 180ms ease",
  };
}

function sectionWrap(highlight: boolean): React.CSSProperties {
  return {
    padding: "18px 4px 20px 4px",
    borderBottom: "1px solid #eef2f7",
    outline: highlight ? "2px solid #fecdd3" : "none",
    outlineOffset: 8,
    borderRadius: 18,
    scrollMarginTop: 80,
  };
}

const sectionLabel: React.CSSProperties = {
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

const uploadHeroButton: React.CSSProperties = {
  width: "100%",
  height: 280,
  marginTop: 16,
  borderRadius: 24,
  overflow: "hidden",
  border: "1px solid #e5e7eb",
  background: "#f8fafc",
  cursor: "pointer",
  position: "relative",
  padding: 0,
};

const uploadHeroInner: React.CSSProperties = {
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
  backdropFilter: "blur(8px)",
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

const headlineInput: React.CSSProperties = {
  width: "100%",
  marginTop: 16,
  padding: "14px 0",
  fontSize: 32,
  fontWeight: 1000,
  letterSpacing: "-0.04em",
  border: "none",
  borderBottom: "1px solid #e5e7eb",
  outline: "none",
  background: "transparent",
  color: "#0f172a",
};

const editorTextarea: React.CSSProperties = {
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

const chipLabel: React.CSSProperties = {
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

const grid2: React.CSSProperties = {
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

const errorBanner: React.CSSProperties = {
  marginTop: 18,
  padding: "14px 16px",
  borderRadius: 18,
  background: "#fff1f2",
  border: "1px solid #fecdd3",
  color: "#9f1239",
  fontWeight: 900,
};

const stickyBar: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px))",
  padding: "12px 16px",
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
  background: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(226,232,240,0.9)",
  borderRadius: 24,
  padding: "14px 16px",
  boxShadow: "0 22px 60px rgba(15,23,42,0.14)",
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
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "none",
    background: disabled ? "#94a3b8" : "#0f172a",
    color: "white",
    padding: "13px 18px",
    borderRadius: 16,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 1000,
    minWidth: 142,
    opacity: disabled ? 0.58 : 1,
    boxShadow: disabled ? "none" : "0 18px 35px rgba(15,23,42,0.2)",
  };
}

const subtleResetBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#334155",
  padding: "10px 14px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 900,
};