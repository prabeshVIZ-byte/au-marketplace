"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* =========================
   TYPES
========================= */

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

type StepKey = "media" | "write" | "details" | "review";
type ErrorSection = "account" | "type" | "media" | "details" | "review" | null;

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

type ValidationResult = {
  ok: boolean;
  message?: string;
  section?: ErrorSection;
};

/* =========================
   CONSTANTS
========================= */

const ITEMS_TABLE = "items";
const ITEM_PHOTOS_TABLE = "item_photos";
const EVENTS_TABLE = "events";

const ITEM_PHOTOS_BUCKET = "item-photos";
const EVENT_FLYERS_BUCKET = "event-flyers";

const MAX_ITEM_PHOTO_MB = 6;
const MAX_EVENT_FLYER_MB = 8;

const DRAFT_KEY = "scholarswap_create_phone_first_v2";
const SUCCESS_ROUTE = "/feed";

const GIVE_STEPS: StepKey[] = ["media", "write", "details", "review"];
const REQUEST_STEPS: StepKey[] = ["write", "details", "review"];
const EVENT_STEPS: StepKey[] = ["media", "write", "details", "review"];

const GIVE_CATEGORY_OPTIONS: GiveCategory[] = [
  "books",
  "notes",
  "electronics",
  "furniture",
  "clothing",
  "sport equipment",
  "stationary item",
  "ride",
  "art pieces",
  "health & beauty",
  "home & kitchen",
  "jeweleries",
  "musical instruments",
  "lost & found",
  "others",
];

const PICKUP_OPTIONS: PickupLocation[] = [
  "College Quad",
  "Safety Service Office",
  "Dining Hall",
  "Library",
  "Student Center",
];

const REQUEST_GROUP_OPTIONS: RequestGroup[] = [
  "logistics",
  "services",
  "urgent",
  "collaboration",
  "lost & found",
];

const REQUEST_TIMEFRAME_OPTIONS: RequestTimeframe[] = [
  "today",
  "this_week",
  "flexible",
];

const EVENT_CATEGORY_OPTIONS: EventCategory[] = [
  "career",
  "club",
  "sports",
  "music",
  "arts",
  "volunteering",
  "academic",
  "social",
  "other",
];

const EXPIRE_OPTIONS: ExpireChoice[] = ["urgent24", "7", "14", "30", "never"];

/* =========================
   HELPERS
========================= */

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

function getStepsForMode(mode: Mode | null): StepKey[] {
  if (mode === "give") return GIVE_STEPS;
  if (mode === "request") return REQUEST_STEPS;
  if (mode === "event") return EVENT_STEPS;
  return [];
}

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

function errToMsg(error: unknown) {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
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

function giveCategoryLabel(v: GiveCategory) {
  return v
    .split(" ")
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function requestGroupLabel(v: RequestGroup) {
  if (v === "logistics") return "Logistics";
  if (v === "services") return "Services";
  if (v === "urgent") return "Urgent";
  if (v === "collaboration") return "Collaboration";
  if (v === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(v: RequestTimeframe) {
  if (v === "today") return "Today";
  if (v === "this_week") return "This week";
  if (v === "flexible") return "Flexible";
  return "";
}

function eventCategoryLabel(v: EventCategory) {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function expireChoiceLabel(v: ExpireChoice) {
  if (v === "urgent24") return "24 hours";
  if (v === "7") return "7 days";
  if (v === "14") return "14 days";
  if (v === "30") return "30 days";
  return "Until canceled";
}

function modeLabel(mode: Mode | null) {
  if (!mode) return "";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function stepTitle(mode: Mode, stepKey: StepKey) {
  if (mode === "give") {
    if (stepKey === "media") return "Add a photo";
    if (stepKey === "write") return "Describe the item";
    if (stepKey === "details") return "Add item details";
    return "Review before posting";
  }

  if (mode === "request") {
    if (stepKey === "write") return "Write your request";
    if (stepKey === "details") return "Add details";
    return "Review before posting";
  }

  if (stepKey === "media") return "Add a flyer";
  if (stepKey === "write") return "Write the event";
  if (stepKey === "details") return "Add event details";
  return "Review before publishing";
}

function stepSubtitle(mode: Mode, stepKey: StepKey) {
  if (mode === "give") {
    if (stepKey === "media") return "Photos make posts feel real and trustworthy.";
    if (stepKey === "write") return "Tell students what it is and why it matters.";
    if (stepKey === "details") return "Help people understand category and pickup quickly.";
    return "Check everything once before sharing.";
  }

  if (mode === "request") {
    if (stepKey === "write") return "Be specific so people can actually help.";
    if (stepKey === "details") return "Set urgency and context clearly.";
    return "Check the request before posting.";
  }

  if (stepKey === "media") return "A strong flyer makes the event feel alive.";
  if (stepKey === "write") return "Make the event sound worth attending.";
  if (stepKey === "details") return "Add time, host, location, and category.";
  return "Check everything once before publishing.";
}

/* =========================
   PAGE
========================= */

export default function CreatePage() {
  const router = useRouter();

  const topRef = useRef<HTMLDivElement | null>(null);
  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [hydratedDraft, setHydratedDraft] = useState(false);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);

  const [draft, setDraft] = useState<DraftState>(getDefaultDraft());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const [itemFile, setItemFile] = useState<File | null>(null);
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [itemPreviewUrl, setItemPreviewUrl] = useState<string | null>(null);
  const [eventPreviewUrl, setEventPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<ErrorSection>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  const steps = useMemo(() => getStepsForMode(draft.mode), [draft.mode]);
  const currentStep = steps[currentStepIndex] ?? null;
  const totalSteps = steps.length;
  const displayStep = draft.mode ? currentStepIndex + 1 : 1;

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

  const isAshland = useMemo(
    () => !!email && email.toLowerCase().endsWith("@ashland.edu"),
    [email]
  );
  const isLoggedIn = !!userId && !!email && isAshland;

  const eventTimeSummary = useMemo(() => {
    return eventStartIso
      ? `${formatLongDateTime(eventStartIso)}${
          eventEndIso ? ` → ${formatLongDateTime(eventEndIso)}` : ""
        }`
      : "—";
  }, [eventStartIso, eventEndIso]);

  useEffect(() => {
    const updateDevice = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    updateDevice();
    window.addEventListener("resize", updateDevice);
    return () => window.removeEventListener("resize", updateDevice);
  }, []);

  useEffect(() => {
    const update = () => {
      const el = document.getElementById("bottom-nav");
      const height = el?.offsetHeight ?? 86;
      document.documentElement.style.setProperty("--bottom-nav-height", `${height}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
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

      const parsed = JSON.parse(raw) as Partial<DraftState & { currentStepIndex?: number }>;
      const nextDraft: DraftState = { ...getDefaultDraft(), ...parsed };
      setDraft(nextDraft);

      const nextSteps = getStepsForMode(nextDraft.mode);
      const rawIndex = Number(parsed.currentStepIndex ?? 0);
      const safeIndex =
        Number.isFinite(rawIndex) && rawIndex >= 0 && rawIndex < nextSteps.length ? rawIndex : 0;
      setCurrentStepIndex(safeIndex);
    } catch {
      // ignore corrupted draft
    } finally {
      setHydratedDraft(true);
    }
  }, []);

  useEffect(() => {
    if (!hydratedDraft) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          ...draft,
          currentStepIndex,
        })
      );
    } catch {
      // ignore
    }
  }, [draft, currentStepIndex, hydratedDraft]);

  useEffect(() => {
    let mounted = true;

    async function syncAuth() {
      setAuthLoading(true);
      try {
        const raced = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null }; error: { message: string } }>((resolve) =>
            setTimeout(
              () => resolve({ data: { session: null }, error: { message: "Auth timeout" } }),
              6500
            )
          ),
        ]);

        if (!mounted) return;

        const session = raced?.data?.session ?? null;
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
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
    });

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

  function scrollTopSmooth() {
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function clearModeFiles() {
    setItemFile(null);
    setEventFile(null);
  }

  function resetComposer() {
    setDraft(getDefaultDraft());
    setCurrentStepIndex(0);
    clearModeFiles();
    setMsg(null);
    setFieldError(null);

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function goBackToTypes() {
    resetComposer();
    scrollTopSmooth();
  }

  function selectMode(mode: Mode) {
    setMsg(null);
    setFieldError(null);
    clearModeFiles();
    setDraft({ ...getDefaultDraft(), mode });
    setCurrentStepIndex(0);
    scrollTopSmooth();
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
      return;
    }

    if (file.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_ITEM_PHOTO_MB}MB.`);
      setFieldError("media");
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
      return;
    }

    if (file.size > MAX_EVENT_FLYER_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_EVENT_FLYER_MB}MB.`);
      setFieldError("media");
      return;
    }

    setEventFile(file);
    patchDraft("eventFileName", file.name);
  }

  function validateStep(stepKey: StepKey): ValidationResult {
    if (!draft.mode) {
      return { ok: false, message: "Choose Give, Request, or Event first.", section: "type" };
    }

    if (stepKey === "media") {
      if (draft.mode === "give" && !itemFile) {
        return { ok: false, message: "Add a photo to continue.", section: "media" };
      }
      if (draft.mode === "event" && !eventFile) {
        return { ok: false, message: "Add a flyer image to continue.", section: "media" };
      }
    }

    if (stepKey === "write") {
      if (cleanTitle.length < 3) {
        return { ok: false, message: "Title must be at least 3 characters.", section: "details" };
      }
      if (cleanDesc.length < 3) {
        return { ok: false, message: "Description is required.", section: "details" };
      }
    }

    if (stepKey === "details") {
      if (draft.mode === "give") {
        if (!draft.giveCategory) {
          return { ok: false, message: "Choose a category.", section: "details" };
        }
        if (!draft.pickupLocation) {
          return { ok: false, message: "Choose a pickup location.", section: "details" };
        }
      }

      if (draft.mode === "request") {
        if (!draft.requestGroup) {
          return { ok: false, message: "Choose a request type.", section: "details" };
        }
        if (!draft.requestTimeframe) {
          return { ok: false, message: "Choose a timeframe.", section: "details" };
        }
      }

      if (draft.mode === "event") {
        if (!draft.hostOrg.trim()) {
          return { ok: false, message: "Host is required.", section: "details" };
        }
        if (!draft.eventCategory) {
          return { ok: false, message: "Choose a category.", section: "details" };
        }
        if (!draft.eventLocation.trim()) {
          return { ok: false, message: "Location is required.", section: "details" };
        }
        if (!draft.eventDate) {
          return { ok: false, message: "Choose a date.", section: "details" };
        }
        if (!draft.eventStartTime) {
          return { ok: false, message: "Choose a start time.", section: "details" };
        }
        if (!eventStartIso) {
          return { ok: false, message: "Start time is invalid.", section: "details" };
        }
        if (!isValidHttpUrlMaybeEmpty(draft.eventLink)) {
          return {
            ok: false,
            message: "Link must start with http:// or https://",
            section: "details",
          };
        }
        if (
          draft.eventEndTime &&
          eventEndIso &&
          new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime()
        ) {
          return {
            ok: false,
            message: "End time cannot be before start time.",
            section: "details",
          };
        }
      }
    }

    return { ok: true };
  }

  function validateBeforeSubmit(): ValidationResult {
    if (!draft.mode) {
      return { ok: false, message: "Choose Give, Request, or Event first.", section: "type" };
    }

    if (!isLoggedIn) {
      return {
        ok: false,
        message: "Log in with your @ashland.edu email to post.",
        section: "account",
      };
    }

    if (!profileComplete) {
      return {
        ok: false,
        message: "Complete your profile first.",
        section: "account",
      };
    }

    for (const stepKey of steps) {
      const result = validateStep(stepKey);
      if (!result.ok) return result;
    }

    return { ok: true };
  }

  function goNext() {
    setMsg(null);
    setFieldError(null);

    if (!currentStep || !draft.mode) return;

    const check = validateStep(currentStep);
    if (!check.ok) {
      setMsg(check.message || "Please complete this step.");
      setFieldError(check.section || "details");
      return;
    }

    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
      scrollTopSmooth();
    }
  }

  function goPrev() {
    setMsg(null);
    setFieldError(null);

    if (!draft.mode) {
      goBackToTypes();
      return;
    }

    if (currentStepIndex <= 0) {
      goBackToTypes();
      return;
    }

    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
    scrollTopSmooth();
  }

  async function handleSubmit() {
    setMsg(null);
    setFieldError(null);

    const validation = validateBeforeSubmit();
    if (!validation.ok) {
      setMsg(validation.message || "Please complete the form.");
      setFieldError(validation.section || "details");

      if (validation.section === "account") {
        router.push("/me");
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
        const eventInsert = {
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
          throw new Error("Flyer image is required.");
        }

        const ext = getExt(eventFile.name);
        const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(EVENT_FLYERS_BUCKET)
          .upload(path, eventFile, {
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

        const { error: updateErr } = await supabase
          .from(EVENTS_TABLE)
          .update({ photo_url: photoUrl })
          .eq("id", eventId);

        if (updateErr) {
          await supabase.storage.from(EVENT_FLYERS_BUCKET).remove([path]);
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error(`Event created but image save failed: ${updateErr.message}`);
        }

        resetComposer();
        router.push(SUCCESS_ROUTE);
        router.refresh();
        return;
      }

      const postType: PostType = draft.mode === "give" ? "give" : "request";
      const { untilCancel, expiresAt } = computeExpiry(draft.expireChoice);

      const itemInsert: {
        owner_id: string;
        title: string;
        description: string;
        status: string;
        is_anonymous: boolean;
        until_cancel: boolean;
        expires_at: string | null;
        photo_url: string | null;
        post_type: PostType;
        category?: string | null;
        pickup_location?: string | null;
        request_group?: string | null;
        request_timeframe?: string | null;
        request_location?: string | null;
      } = {
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

      const { error: uploadErr } = await supabase.storage
        .from(ITEM_PHOTOS_BUCKET)
        .upload(storagePath, itemFile, {
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
    } catch (error) {
      setMsg(errToMsg(error));
    } finally {
      setSaving(false);
    }
  }

  function stickyHint() {
    if (!draft.mode) return "Choose a type to begin.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email.";
    if (!profileComplete) return "Finish your profile first.";
    if (currentStep === "review") return "Looks good. Ready to post.";
    return `Step ${displayStep} of ${totalSteps}`;
  }

  function primaryLabel() {
    if (saving) return "Posting...";
    if (!draft.mode) return "Continue";
    if (currentStep !== "review") return "Continue";
    if (draft.mode === "give") return "Share item";
    if (draft.mode === "request") return "Post request";
    return "Publish event";
  }

  function handlePrimaryAction() {
    if (!draft.mode) return;
    if (currentStep !== "review") {
      goNext();
      return;
    }
    handleSubmit();
  }

  function renderModePicker() {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <button type="button" onClick={() => selectMode("give")} style={modeCard("warm")}>
          <div style={modeIconBox}>🎁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Give</div>
            <div style={modeDesc}>Share something useful with campus</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("request")} style={modeCard("blue")}>
          <div style={modeIconBox}>🤝</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Request</div>
            <div style={modeDesc}>Ask the campus community for help</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>

        <button type="button" onClick={() => selectMode("event")} style={modeCard("purple")}>
          <div style={modeIconBox}>📅</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={modeTitle}>Event</div>
            <div style={modeDesc}>Promote something happening on campus</div>
          </div>
          <div style={modeArrow}>→</div>
        </button>
      </div>
    );
  }

  function renderStepper() {
    if (!draft.mode || !steps.length) return null;

    return (
      <div style={stepperWrap(steps.length)}>
        {steps.map((labelKey, index) => {
          const active = index === currentStepIndex;
          const done = index < currentStepIndex;
          const label =
            labelKey === "media"
              ? "Media"
              : labelKey === "write"
              ? "Write"
              : labelKey === "details"
              ? "Details"
              : "Review";

          return (
            <div key={labelKey} style={stepperItem}>
              <div style={stepperLineWrap}>
                <div style={stepperDot(active, done)}>{done ? "✓" : index + 1}</div>
                {index < steps.length - 1 && <div style={stepperLine(done)} />}
              </div>
              <div style={stepperLabel(active)}>{label}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderMediaStep() {
    if (!draft.mode || currentStep !== "media") return null;

    const isGive = draft.mode === "give";
    const file = isGive ? itemFile : eventFile;
    const preview = isGive ? itemPreviewUrl : eventPreviewUrl;
    const savedName = isGive ? draft.itemFileName : draft.eventFileName;

    return (
      <section style={screenCard(fieldError === "media")}>
        <div style={heroUploadWrap}>
          <input
            ref={isGive ? itemFileInputRef : eventFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              isGive
                ? pickItemFile(e.target.files?.[0] ?? null)
                : pickEventFile(e.target.files?.[0] ?? null)
            }
            style={{ display: "none" }}
          />

          <button
            type="button"
            onClick={() =>
              isGive ? itemFileInputRef.current?.click() : eventFileInputRef.current?.click()
            }
            style={heroUploadButton}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Preview" style={heroUploadImage} />
            ) : (
              <div style={heroUploadPlaceholder}>
                <div style={{ fontSize: 54 }}>{isGive ? "📷" : "🎫"}</div>
                <div style={{ marginTop: 14, fontSize: 24, fontWeight: 1000 }}>
                  {isGive ? "Upload item photo" : "Upload event flyer"}
                </div>
                <div style={{ marginTop: 8, color: "#64748b", fontSize: 14, fontWeight: 700 }}>
                  JPG, PNG, or WEBP
                </div>
              </div>
            )}

            <div style={floatingUploadAction}>{file ? "Change image" : "Tap to upload"}</div>
          </button>

          <div style={fileMetaRow}>
            <div style={fileMetaName}>
              {file
                ? file.name
                : savedName
                ? `Saved draft file: ${savedName} (re-upload required after refresh)`
                : "No image selected"}
            </div>

            {file && (
              <button
                type="button"
                onClick={() => (isGive ? pickItemFile(null) : pickEventFile(null))}
                style={removeBtn}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderWriteStep() {
    if (!draft.mode || currentStep !== "write") return null;

    return (
      <section style={screenCard(fieldError === "details")}>
        <div style={contentBlock}>
          <label style={fieldLabelModern}>Title</label>
          <input
            value={draft.title}
            onChange={(e) => patchDraft("title", e.target.value)}
            style={titleInputModern}
            placeholder={
              draft.mode === "give"
                ? "What are you sharing?"
                : draft.mode === "request"
                ? "What do you need?"
                : "What’s your event called?"
            }
            autoFocus
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={fieldLabelModern}>
            {draft.mode === "request"
              ? "Details"
              : draft.mode === "event"
              ? "Why should people come?"
              : "Description"}
          </label>
          <textarea
            value={draft.description}
            onChange={(e) => patchDraft("description", e.target.value)}
            style={textareaModern}
            rows={7}
            placeholder={
              draft.mode === "give"
                ? "Mention condition, quantity, and anything important about pickup."
                : draft.mode === "request"
                ? "Explain exactly what you need, and by when."
                : "Tell students what this is, who it is for, and why they should care."
            }
          />
        </div>

        <div style={tipCard}>
          {draft.mode === "give" && "The clearest give posts usually get picked up first."}
          {draft.mode === "request" && "Specific asks get better responses than vague ones."}
          {draft.mode === "event" && "Lead with the value of the event, not just the logistics."}
        </div>
      </section>
    );
  }

  function renderDetailsStep() {
    if (!draft.mode || currentStep !== "details") return null;

    if (draft.mode === "give") {
      return (
        <section style={screenCard(fieldError === "details")}>
          <div style={detailGroup}>
            <div style={fieldLabelModern}>Category</div>
            <div style={choiceGrid}>
              {GIVE_CATEGORY_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("giveCategory", v)}
                  style={choiceTile(draft.giveCategory === v, "warm")}
                >
                  {giveCategoryLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Pickup location</div>
            <div style={choiceGrid}>
              {PICKUP_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("pickupLocation", v)}
                  style={choiceTile(draft.pickupLocation === v, "neutral")}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div style={dividerLine} />

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Visibility</div>
            <div style={segmentedWrap}>
              <button
                type="button"
                onClick={() => patchDraft("hideName", false)}
                style={segmentBtn(!draft.hideName)}
              >
                Show my name
              </button>
              <button
                type="button"
                onClick={() => patchDraft("hideName", true)}
                style={segmentBtn(draft.hideName)}
              >
                Anonymous
              </button>
            </div>
          </div>

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Auto-close</div>
            <div style={choiceGrid}>
              {EXPIRE_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("expireChoice", v)}
                  style={choiceTile(
                    draft.expireChoice === v,
                    v === "urgent24" ? "danger" : "neutral"
                  )}
                >
                  {expireChoiceLabel(v)}
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    }

    if (draft.mode === "request") {
      return (
        <section style={screenCard(fieldError === "details")}>
          <div style={detailGroup}>
            <div style={fieldLabelModern}>Request type</div>
            <div style={choiceGrid}>
              {REQUEST_GROUP_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("requestGroup", v)}
                  style={choiceTile(draft.requestGroup === v, v === "urgent" ? "danger" : "blue")}
                >
                  {requestGroupLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Timeframe</div>
            <div style={segmentedTripletWrap}>
              {REQUEST_TIMEFRAME_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("requestTimeframe", v)}
                  style={segmentBtn(draft.requestTimeframe === v)}
                >
                  {requestTimeframeLabel(v)}
                </button>
              ))}
            </div>
          </div>

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Location</div>
            <input
              value={draft.requestLocation}
              onChange={(e) => patchDraft("requestLocation", e.target.value)}
              style={softInputModern}
              placeholder="Optional location"
            />
          </div>

          <div style={dividerLine} />

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Visibility</div>
            <div style={segmentedWrap}>
              <button
                type="button"
                onClick={() => patchDraft("hideName", false)}
                style={segmentBtn(!draft.hideName)}
              >
                Show my name
              </button>
              <button
                type="button"
                onClick={() => patchDraft("hideName", true)}
                style={segmentBtn(draft.hideName)}
              >
                Anonymous
              </button>
            </div>
          </div>

          <div style={detailGroup}>
            <div style={fieldLabelModern}>Auto-close</div>
            <div style={choiceGrid}>
              {EXPIRE_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchDraft("expireChoice", v)}
                  style={choiceTile(
                    draft.expireChoice === v,
                    v === "urgent24" ? "danger" : "neutral"
                  )}
                >
                  {expireChoiceLabel(v)}
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    }

    return (
      <section style={screenCard(fieldError === "details")}>
        <div style={detailGroup}>
          <div style={fieldLabelModern}>Category</div>
          <div style={choiceGrid}>
            {EVENT_CATEGORY_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patchDraft("eventCategory", v)}
                style={choiceTile(draft.eventCategory === v, "purple")}
              >
                {eventCategoryLabel(v)}
              </button>
            ))}
          </div>
        </div>

        <div style={detailGroup}>
          <div style={fieldLabelModern}>Host</div>
          <input
            value={draft.hostOrg}
            onChange={(e) => patchDraft("hostOrg", e.target.value)}
            style={softInputModern}
            placeholder="Host club / organisation"
          />
        </div>

        <div style={detailGroup}>
          <div style={fieldLabelModern}>Location</div>
          <input
            value={draft.eventLocation}
            onChange={(e) => patchDraft("eventLocation", e.target.value)}
            style={softInputModern}
            placeholder="Where is it happening?"
          />
        </div>

        <div style={grid2PhoneFirst}>
          <div>
            <div style={fieldLabelModern}>Date</div>
            <input
              type="date"
              value={draft.eventDate}
              onChange={(e) => patchDraft("eventDate", e.target.value)}
              style={softInputModern}
            />
          </div>

          <div>
            <div style={fieldLabelModern}>Start time</div>
            <input
              type="time"
              value={draft.eventStartTime}
              onChange={(e) => patchDraft("eventStartTime", e.target.value)}
              style={softInputModern}
            />
          </div>
        </div>

        <div style={grid2PhoneFirst}>
          <div>
            <div style={fieldLabelModern}>End time</div>
            <input
              type="time"
              value={draft.eventEndTime}
              onChange={(e) => patchDraft("eventEndTime", e.target.value)}
              style={softInputModern}
            />
          </div>

          <div>
            <div style={fieldLabelModern}>Link</div>
            <input
              value={draft.eventLink}
              onChange={(e) => patchDraft("eventLink", e.target.value)}
              style={softInputModern}
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

        <div style={dividerLine} />

        <div style={detailGroup}>
          <div style={fieldLabelModern}>Visibility</div>
          <div style={segmentedWrap}>
            <button
              type="button"
              onClick={() => patchDraft("hideName", false)}
              style={segmentBtn(!draft.hideName)}
            >
              Show my name
            </button>
            <button
              type="button"
              onClick={() => patchDraft("hideName", true)}
              style={segmentBtn(draft.hideName)}
            >
              Anonymous
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderReviewCard() {
    if (!draft.mode) return null;

    if (draft.mode === "give") {
      return (
        <div style={previewCard}>
          <div style={previewMediaWrap}>
            {itemPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={itemPreviewUrl} alt="Item preview" style={previewImage} />
            ) : (
              <div style={previewPlaceholder}>No image selected</div>
            )}
            <div style={previewBadge("#fff7ed", "#9a3412", "#fdba74")}>GIVE</div>
          </div>

          <div style={previewBody}>
            <div style={previewMeta}>
              {giveCategoryLabel(draft.giveCategory)} • {draft.pickupLocation}
            </div>
            <div style={previewHeadline}>{cleanTitle || "Untitled post"}</div>
            <div style={previewText}>{cleanDesc || "No description yet."}</div>
            <div style={previewFooter}>
              {draft.hideName ? "Anonymous" : "Visible name"} •{" "}
              {expireChoiceLabel(draft.expireChoice)}
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
              ...previewMediaWrap,
              height: 160,
              background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)",
            }}
          >
            <div style={{ padding: 18, width: "100%" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={miniPill("#dbeafe", "#1d4ed8", "#93c5fd")}>
                  {requestGroupLabel(draft.requestGroup)}
                </span>
                <span style={miniPill("#dbeafe", "#1d4ed8", "#93c5fd")}>
                  {requestTimeframeLabel(draft.requestTimeframe)}
                </span>
              </div>

              <div style={{ marginTop: 16, fontWeight: 1000, fontSize: 24, lineHeight: 1.15 }}>
                {cleanTitle || "Untitled request"}
              </div>
            </div>

            <div style={previewBadge("#eff6ff", "#1d4ed8", "#93c5fd")}>REQUEST</div>
          </div>

          <div style={previewBody}>
            <div style={previewText}>{cleanDesc || "No description yet."}</div>
            <div style={previewFooter}>
              {draft.requestLocation.trim() || "No location added"} •{" "}
              {draft.hideName ? "Anonymous" : "Visible name"} •{" "}
              {expireChoiceLabel(draft.expireChoice)}
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
            <div style={previewPlaceholder}>No flyer selected</div>
          )}
          <div style={previewBadge("#f5f3ff", "#6d28d9", "#c4b5fd")}>EVENT</div>
        </div>

        <div style={previewBody}>
          <div style={previewMeta}>
            {eventCategoryLabel(draft.eventCategory)} • {draft.hostOrg.trim() || "Host"}
          </div>
          <div style={previewHeadline}>{cleanTitle || "Untitled event"}</div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 900, color: "#6d28d9" }}>
            📍 {draft.eventLocation.trim() || "Location"} • {eventTimeSummary}
          </div>
          <div style={previewText}>{cleanDesc || "No description yet."}</div>
          <div style={previewFooter}>{draft.hideName ? "Anonymous" : "Visible name"}</div>
        </div>
      </div>
    );
  }

  function renderReviewStep() {
    if (!draft.mode || currentStep !== "review") return null;

    return (
      <section style={screenCard(fieldError === "review")}>
        {renderReviewCard()}

        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          <div style={reviewRow}>
            <span style={reviewLabel}>Type</span>
            <span style={reviewValue}>{modeLabel(draft.mode)}</span>
          </div>

          {draft.mode === "give" && (
            <>
              <div style={reviewRow}>
                <span style={reviewLabel}>Category</span>
                <span style={reviewValue}>{giveCategoryLabel(draft.giveCategory)}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Pickup</span>
                <span style={reviewValue}>{draft.pickupLocation}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Auto-close</span>
                <span style={reviewValue}>{expireChoiceLabel(draft.expireChoice)}</span>
              </div>
            </>
          )}

          {draft.mode === "request" && (
            <>
              <div style={reviewRow}>
                <span style={reviewLabel}>Request type</span>
                <span style={reviewValue}>{requestGroupLabel(draft.requestGroup)}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Timeframe</span>
                <span style={reviewValue}>{requestTimeframeLabel(draft.requestTimeframe)}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Location</span>
                <span style={reviewValue}>{draft.requestLocation.trim() || "None"}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Auto-close</span>
                <span style={reviewValue}>{expireChoiceLabel(draft.expireChoice)}</span>
              </div>
            </>
          )}

          {draft.mode === "event" && (
            <>
              <div style={reviewRow}>
                <span style={reviewLabel}>Category</span>
                <span style={reviewValue}>{eventCategoryLabel(draft.eventCategory)}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Host</span>
                <span style={reviewValue}>{draft.hostOrg.trim() || "None"}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Location</span>
                <span style={reviewValue}>{draft.eventLocation.trim() || "None"}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>When</span>
                <span style={reviewValue}>{eventTimeSummary}</span>
              </div>
              <div style={reviewRow}>
                <span style={reviewLabel}>Link</span>
                <span style={reviewValue}>{draft.eventLink.trim() || "None"}</span>
              </div>
            </>
          )}

          <div style={reviewRow}>
            <span style={reviewLabel}>Visibility</span>
            <span style={reviewValue}>{draft.hideName ? "Anonymous" : "Show my name"}</span>
          </div>
        </div>
      </section>
    );
  }

  function renderCurrentStep() {
    if (!draft.mode || !currentStep) return null;

    return (
      <>
        {renderMediaStep()}
        {renderWriteStep()}
        {renderDetailsStep()}
        {renderReviewStep()}
      </>
    );
  }

  if (!hydratedDraft || authLoading || profileLoading) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={statusCard}>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>Loading...</div>
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
            <button onClick={() => router.push("/me")} style={{ ...primaryButton, marginTop: 16 }}>
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
            <button onClick={() => router.push("/me")} style={{ ...primaryButton, marginTop: 16 }}>
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
        <div style={topBar}>
          <button onClick={() => router.push("/feed")} style={topBarButton}>
            ← Feed
          </button>

          {draft.mode ? (
            <button onClick={goBackToTypes} style={topBarButton}>
              Change type
            </button>
          ) : (
            <div />
          )}
        </div>

        {!draft.mode ? (
          <>
            <div style={heroHeader}>
              <div style={heroTitle}>Create</div>
              <div style={heroSubtitle}>What do you want to share today?</div>
            </div>

            <div style={accountCard}>
              <div style={{ fontSize: 13, color: "#475569", fontWeight: 800 }}>
                Posting as <b>{email}</b>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>{renderModePicker()}</div>
          </>
        ) : (
          <div style={composerGrid(isDesktop)}>
            <div style={mainColumn}>
              <div style={heroHeaderCompact}>
                <div style={pageEyebrow}>{draft.mode.toUpperCase()}</div>
                <div style={heroTitleSmall}>{stepTitle(draft.mode, currentStep as StepKey)}</div>
                <div style={heroSubtitleSmall}>
                  {stepSubtitle(draft.mode, currentStep as StepKey)}
                </div>
              </div>

              {renderStepper()}

              <div style={accountInlineCard}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 800 }}>
                  Posting as <b>{email}</b>
                </div>
              </div>

              {renderCurrentStep()}

              {msg && <div style={errorBanner}>{msg}</div>}
            </div>

            {isDesktop && currentStep === "review" && (
              <div style={sideColumn}>
                <div style={desktopStickyPreview}>
                  <div style={{ fontWeight: 1000, fontSize: 16, marginBottom: 12 }}>Preview</div>
                  {renderReviewCard()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {draft.mode && (
        <div style={stickyBar}>
          <div style={stickyInner}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={stickyMiniLabel}>Create flow</div>
              <div style={stickyMainLabel}>{stickyHint()}</div>
            </div>

            <button type="button" onClick={goPrev} style={secondaryStickyBtn} disabled={saving}>
              {displayStep === 1 ? "Types" : "Back"}
            </button>

            <button
              type="button"
              onClick={handlePrimaryAction}
              style={primaryStickyBtn(saving)}
              disabled={saving}
            >
              {primaryLabel()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   STYLES
========================= */

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f8fafc 0%, #f6f7fb 42%, #f8fafc 100%)",
  color: "#0f172a",
  padding: 16,
  paddingBottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + 130px)",
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

const topBarButton: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "rgba(255,255,255,0.88)",
  color: "#0f172a",
  padding: "10px 14px",
  borderRadius: 999,
  fontWeight: 900,
  cursor: "pointer",
};

const heroHeader: React.CSSProperties = {
  paddingTop: 6,
  marginBottom: 14,
};

const heroHeaderCompact: React.CSSProperties = {
  marginBottom: 16,
};

const pageEyebrow: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#64748b",
  fontWeight: 1000,
};

const heroTitle: React.CSSProperties = {
  fontSize: 36,
  lineHeight: 1.02,
  fontWeight: 1000,
  letterSpacing: "-0.05em",
};

const heroSubtitle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 15,
  color: "#64748b",
  fontWeight: 600,
};

const heroTitleSmall: React.CSSProperties = {
  marginTop: 6,
  fontSize: 30,
  lineHeight: 1.04,
  fontWeight: 1000,
  letterSpacing: "-0.045em",
};

const heroSubtitleSmall: React.CSSProperties = {
  marginTop: 8,
  fontSize: 14,
  color: "#64748b",
  fontWeight: 600,
};

const accountCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  border: "1px solid #e5e7eb",
  borderRadius: 20,
  padding: "13px 15px",
  boxShadow: "0 12px 28px rgba(15,23,42,0.04)",
};

const accountInlineCard: React.CSSProperties = {
  marginTop: 16,
  background: "rgba(255,255,255,0.9)",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: "12px 14px",
};

const statusCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #e5e7eb",
  borderRadius: 26,
  padding: 22,
  boxShadow: "0 24px 60px rgba(15,23,42,0.06)",
};

function composerGrid(isDesktop: boolean): React.CSSProperties {
  return isDesktop
    ? {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.15fr) minmax(340px, 0.85fr)",
        gap: 20,
        alignItems: "start",
      }
    : { display: "block" };
}

const mainColumn: React.CSSProperties = {
  minWidth: 0,
};

const sideColumn: React.CSSProperties = {
  minWidth: 0,
};

const desktopStickyPreview: React.CSSProperties = {
  position: "sticky",
  top: 16,
};

function modeCard(tone: "warm" | "blue" | "purple"): React.CSSProperties {
  const palette =
    tone === "warm"
      ? { bg: "linear-gradient(135deg, #fff7ed 0%, #ffffff 100%)", border: "#fed7aa" }
      : tone === "blue"
      ? { bg: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)", border: "#bfdbfe" }
      : { bg: "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)", border: "#c4b5fd" };

  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 16,
    textAlign: "left",
    padding: 18,
    borderRadius: 28,
    border: `1.5px solid ${palette.border}`,
    background: palette.bg,
    boxShadow: "0 14px 32px rgba(15,23,42,0.06)",
    cursor: "pointer",
  };
}

const modeIconBox: React.CSSProperties = {
  width: 68,
  height: 68,
  borderRadius: 22,
  display: "grid",
  placeItems: "center",
  fontSize: 30,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(255,255,255,0.95)",
  flexShrink: 0,
};

const modeTitle: React.CSSProperties = {
  fontSize: 25,
  fontWeight: 1000,
  lineHeight: 1.08,
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

function stepperWrap(stepCount: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${stepCount}, minmax(0, 1fr))`,
    gap: 8,
    marginTop: 6,
    marginBottom: 16,
  };
}

const stepperItem: React.CSSProperties = {
  minWidth: 0,
};

const stepperLineWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
};

function stepperDot(active: boolean, done: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 1000,
    background: done ? "#03133d" : active ? "#e0e7ff" : "#ffffff",
    color: done ? "#ffffff" : active ? "#312e81" : "#64748b",
    border: `1px solid ${done ? "#03133d" : active ? "#a5b4fc" : "#e5e7eb"}`,
    flexShrink: 0,
  };
}

function stepperLine(done: boolean): React.CSSProperties {
  return {
    height: 2,
    flex: 1,
    background: done ? "#03133d" : "#e5e7eb",
    marginLeft: 6,
    borderRadius: 999,
  };
}

function stepperLabel(active: boolean): React.CSSProperties {
  return {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 900,
    color: active ? "#0f172a" : "#64748b",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function screenCard(highlight: boolean): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.92)",
    border: `1px solid ${highlight ? "#fecdd3" : "#e5e7eb"}`,
    borderRadius: 28,
    padding: 18,
    boxShadow: highlight
      ? "0 0 0 3px rgba(251,113,133,0.08)"
      : "0 20px 50px rgba(15,23,42,0.05)",
  };
}

const heroUploadWrap: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const heroUploadButton: React.CSSProperties = {
  width: "100%",
  minHeight: 370,
  padding: 0,
  border: "1px solid #e5e7eb",
  borderRadius: 26,
  overflow: "hidden",
  background: "#f8fafc",
  position: "relative",
  cursor: "pointer",
};

const heroUploadImage: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 370,
  objectFit: "cover",
  display: "block",
};

const heroUploadPlaceholder: React.CSSProperties = {
  minHeight: 370,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  padding: 24,
  color: "#0f172a",
};

const floatingUploadAction: React.CSSProperties = {
  position: "absolute",
  bottom: 14,
  right: 14,
  borderRadius: 999,
  padding: "10px 14px",
  background: "rgba(15,23,42,0.78)",
  color: "#ffffff",
  fontWeight: 1000,
  fontSize: 13,
  backdropFilter: "blur(10px)",
};

const fileMetaRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const fileMetaName: React.CSSProperties = {
  fontSize: 13,
  color: "#64748b",
  fontWeight: 800,
  minWidth: 0,
};

const removeBtn: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#be123c",
  borderRadius: 999,
  padding: "8px 12px",
  fontWeight: 900,
  cursor: "pointer",
};

const contentBlock: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const fieldLabelModern: React.CSSProperties = {
  fontSize: 13,
  color: "#475569",
  fontWeight: 900,
};

const titleInputModern: React.CSSProperties = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  padding: "8px 0 12px 0",
  fontSize: 31,
  lineHeight: 1.08,
  fontWeight: 1000,
  letterSpacing: "-0.045em",
  borderBottom: "1px solid #e5e7eb",
};

const textareaModern: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  outline: "none",
  background: "#ffffff",
  padding: 16,
  borderRadius: 20,
  resize: "vertical",
  fontSize: 15,
  lineHeight: 1.65,
  color: "#0f172a",
};

const tipCard: React.CSSProperties = {
  marginTop: 14,
  padding: "14px 15px",
  borderRadius: 18,
  background: "#f8fafc",
  color: "#475569",
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid #e5e7eb",
};

const detailGroup: React.CSSProperties = {
  display: "grid",
  gap: 10,
  marginBottom: 18,
};

const choiceGrid: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};

function choiceTile(
  active: boolean,
  tone: "warm" | "blue" | "purple" | "neutral" | "danger"
): React.CSSProperties {
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
    padding: "12px 14px",
    borderRadius: 18,
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.color,
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
  };
}

const segmentedWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const segmentedTripletWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 10,
};

function segmentBtn(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? "#03133d" : "#e5e7eb"}`,
    background: active ? "#03133d" : "#ffffff",
    color: active ? "#ffffff" : "#0f172a",
    borderRadius: 18,
    padding: "13px 14px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

const softInputModern: React.CSSProperties = {
  width: "100%",
  padding: "14px 15px",
  borderRadius: 18,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  outline: "none",
  fontSize: 14,
};

const grid2PhoneFirst: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
  marginBottom: 18,
};

const dividerLine: React.CSSProperties = {
  height: 1,
  background: "#eef2f7",
  margin: "4px 0 18px 0",
};

const inlineWarning: React.CSSProperties = {
  padding: "11px 13px",
  borderRadius: 16,
  background: "#fff1f2",
  color: "#9f1239",
  fontSize: 13,
  fontWeight: 800,
  border: "1px solid #fecdd3",
  marginBottom: 16,
};

const reviewRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 0",
  borderBottom: "1px solid #eef2f7",
};

const reviewLabel: React.CSSProperties = {
  fontSize: 13,
  color: "#64748b",
  fontWeight: 900,
};

const reviewValue: React.CSSProperties = {
  fontSize: 14,
  color: "#0f172a",
  fontWeight: 900,
  textAlign: "right",
  lineHeight: 1.45,
};

const previewCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.96)",
  border: "1px solid #e5e7eb",
  borderRadius: 28,
  overflow: "hidden",
  boxShadow: "0 20px 50px rgba(15,23,42,0.08)",
};

const previewMediaWrap: React.CSSProperties = {
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
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(226,232,240,0.95)",
  borderRadius: 24,
  padding: "14px 16px",
  boxShadow: "0 18px 50px rgba(15,23,42,0.14)",
  backdropFilter: "blur(16px)",
  pointerEvents: "auto",
};

const stickyMiniLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const stickyMainLabel: React.CSSProperties = {
  marginTop: 3,
  fontSize: 14,
  color: "#0f172a",
  fontWeight: 1000,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const secondaryStickyBtn: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#0f172a",
  padding: "12px 15px",
  borderRadius: 16,
  cursor: "pointer",
  fontWeight: 900,
  whiteSpace: "nowrap",
};

function primaryStickyBtn(disabled: boolean): React.CSSProperties {
  return {
    border: "none",
    background: disabled ? "#94a3b8" : "#03133d",
    color: "#ffffff",
    padding: "13px 18px",
    borderRadius: 18,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 1000,
    minWidth: 142,
    opacity: disabled ? 0.58 : 1,
    boxShadow: disabled ? "none" : "0 18px 35px rgba(3,19,61,0.22)",
    whiteSpace: "nowrap",
  };
}

const primaryButton: React.CSSProperties = {
  border: "none",
  background: "#03133d",
  color: "#ffffff",
  padding: "13px 18px",
  borderRadius: 18,
  cursor: "pointer",
  fontWeight: 1000,
  boxShadow: "0 18px 35px rgba(3,19,61,0.22)",
};