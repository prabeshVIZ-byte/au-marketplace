"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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
type EventDurationPreset = "30" | "60" | "90" | "120" | "custom";

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

  eventDate: string; // YYYY-MM-DD
  eventStartTime: string; // HH:mm
  eventEndTime: string; // HH:mm
  eventDurationPreset: EventDurationPreset;

  hideName: boolean;
  expireChoice: ExpireChoice;

  currentStep: number;

  // draft note only; actual file cannot safely persist through refresh
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

const DRAFT_KEY = "scholarswap_create_wizard_draft_v1";

const WIZARD_STICKY_HEIGHT = 78;
const SUCCESS_ROUTE = "/feed";

const GIVE_STEPS = [
  "Choose type",
  "Title",
  "Description",
  "Photo",
  "Category",
  "Pickup",
  "Options",
  "Review",
] as const;

const REQUEST_STEPS = [
  "Choose type",
  "Title",
  "Description",
  "Request type",
  "Timeframe",
  "Location",
  "Options",
  "Review",
] as const;

const EVENT_STEPS = [
  "Choose type",
  "Title",
  "Description",
  "Category",
  "Host",
  "Location",
  "Time",
  "Flyer",
  "Link",
  "Options",
  "Review",
] as const;

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

function addMinutesToTime(timeStr: string, mins: number) {
  const m = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const total = hh * 60 + mm + mins;
  const next = ((total % 1440) + 1440) % 1440;
  const outH = String(Math.floor(next / 60)).padStart(2, "0");
  const outM = String(next % 60).padStart(2, "0");
  return `${outH}:${outM}`;
}

function formatShortDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  return "Request";
}

function requestTimeframeLabel(t: RequestTimeframe) {
  if (t === "today") return "Today";
  if (t === "this_week") return "This week";
  if (t === "flexible") return "Flexible";
  return "";
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
    eventDurationPreset: "60",

    hideName: false,
    expireChoice: "7",

    currentStep: 0,

    itemFileName: null,
    eventFileName: null,
  };
}

function getStepsForMode(mode: Mode | null) {
  if (mode === "give") return GIVE_STEPS;
  if (mode === "request") return REQUEST_STEPS;
  if (mode === "event") return EVENT_STEPS;
  return ["Choose type"] as const;
}

// ---------------- main ----------------
export default function CreatePage() {
  const router = useRouter();

  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

  // auth + profile
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);

  // wizard state
  const [draft, setDraft] = useState<DraftState>(getDefaultDraft());
  const [hydratedDraft, setHydratedDraft] = useState(false);

  // files
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreviewUrl, setItemPreviewUrl] = useState<string | null>(null);
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [eventPreviewUrl, setEventPreviewUrl] = useState<string | null>(null);

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const steps = useMemo(() => getStepsForMode(draft.mode), [draft.mode]);
  const maxStepIndex = steps.length - 1;
  const currentStep = Math.max(0, Math.min(draft.currentStep, maxStepIndex));

  // derived
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

  // preview urls
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

  // draft hydrate
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) {
        setHydratedDraft(true);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DraftState>;
      const merged = { ...getDefaultDraft(), ...parsed };
      const safeSteps = getStepsForMode(merged.mode);
      merged.currentStep = Math.max(0, Math.min(Number(merged.currentStep ?? 0), safeSteps.length - 1));
      setDraft(merged);
    } catch {
      // ignore broken localStorage
    } finally {
      setHydratedDraft(true);
    }
  }, []);

  // save draft
  useEffect(() => {
    if (!hydratedDraft) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore localStorage failure
    }
  }, [draft, hydratedDraft]);

  // bottom-nav height css var
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
    if (!f) {
      setItemFile(null);
      setDraft((p) => ({ ...p, itemFileName: null }));
      return;
    }
    if (!isAllowedImage(f)) return setMsg("Upload JPG, PNG, or WEBP.");
    if (f.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) return setMsg(`Photo too large (max ${MAX_ITEM_PHOTO_MB}MB).`);
    setItemFile(f);
    setDraft((p) => ({ ...p, itemFileName: f.name }));
  }

  function pickEventFile(f: File | null) {
    setMsg(null);
    if (!f) {
      setEventFile(null);
      setDraft((p) => ({ ...p, eventFileName: null }));
      return;
    }
    if (!isAllowedImage(f)) return setMsg("Flyer must be JPG, PNG, or WEBP.");
    if (f.size > MAX_EVENT_FLYER_MB * 1024 * 1024) return setMsg(`Flyer too large (max ${MAX_EVENT_FLYER_MB}MB).`);
    setEventFile(f);
    setDraft((p) => ({ ...p, eventFileName: f.name }));
  }

  function patchDraft<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetWizard() {
    setDraft(getDefaultDraft());
    setItemFile(null);
    setEventFile(null);
    setMsg(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function selectMode(mode: Mode) {
    if (draft.mode && draft.mode !== mode) return;
    setDraft((prev) => ({
      ...prev,
      mode,
      currentStep: 1,
    }));
    setMsg(null);
  }

  function applyDurationPreset(mins: number, preset: EventDurationPreset) {
    if (!draft.eventStartTime) return;
    patchDraft("eventDurationPreset", preset);
    patchDraft("eventEndTime", addMinutesToTime(draft.eventStartTime, mins));
  }

  function getStepError(step: number): string | null {
    if (!draft.mode) {
      if (step === 0) return "Choose what you want to create.";
      return null;
    }

    if (!isLoggedIn) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";

    if (draft.mode === "give") {
      if (step === 1 && cleanTitle.length < 3) return "Title must be at least 3 characters.";
      if (step === 2 && cleanDesc.length < 3) return "Description is required.";
      if (step === 3) {
        if (!itemFile) return "A photo is required for Give posts.";
        if (!isAllowedImage(itemFile)) return "Photo must be JPG, PNG, or WEBP.";
        if (itemFile.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) return `Photo too large (max ${MAX_ITEM_PHOTO_MB}MB).`;
      }
      if (step === 4 && !draft.giveCategory) return "Category is required.";
      if (step === 5 && !draft.pickupLocation) return "Pickup spot is required.";
      return null;
    }

    if (draft.mode === "request") {
      if (step === 1 && cleanTitle.length < 3) return "Title must be at least 3 characters.";
      if (step === 2 && cleanDesc.length < 3) return "Description is required.";
      if (step === 3 && !draft.requestGroup) return "Request type is required.";
      if (step === 4 && !draft.requestTimeframe) return "Timeframe is required.";
      return null;
    }

    // event
    if (step === 1 && cleanTitle.length < 3) return "Title must be at least 3 characters.";
    if (step === 2 && cleanDesc.length < 3) return "Description is required.";
    if (step === 3 && !draft.eventCategory) return "Event category is required.";
    if (step === 4 && !draft.hostOrg.trim()) return "Host Club/Organisation is required.";
    if (step === 5 && !draft.eventLocation.trim()) return "Location is required.";
    if (step === 6) {
      if (!draft.eventDate) return "Pick an event date.";
      if (!draft.eventStartTime) return "Pick a start time.";
      if (!eventStartIso) return "Start time is invalid.";
      if (draft.eventEndTime && eventEndIso && new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime()) {
        return "End time cannot be before start time.";
      }
    }
    if (step === 7) {
      if (!eventFile) return "A flyer/photo is required for events.";
      if (!isAllowedImage(eventFile)) return "Flyer must be JPG, PNG, or WEBP.";
      if (eventFile.size > MAX_EVENT_FLYER_MB * 1024 * 1024) return `Flyer too large (max ${MAX_EVENT_FLYER_MB}MB).`;
    }
    if (step === 8 && !isValidHttpUrlMaybeEmpty(draft.eventLink)) {
      return "Link must start with http:// or https:// (or be empty).";
    }

    return null;
  }

  function validateAllBeforeSubmit(): string | null {
    if (!draft.mode) return "Choose what you want to create.";
    for (let i = 0; i <= maxStepIndex; i += 1) {
      const err = getStepError(i);
      if (err) return err;
    }
    return null;
  }

  function nextStep() {
    setMsg(null);
    const err = getStepError(currentStep);
    if (err) {
      setMsg(err);
      if (!isLoggedIn || !profileComplete) router.push("/me");
      return;
    }
    patchDraft("currentStep", Math.min(currentStep + 1, maxStepIndex));
  }

  function prevStep() {
    setMsg(null);
    patchDraft("currentStep", Math.max(currentStep - 1, 0));
  }

  const canGoNext = !getStepError(currentStep);
  const isReviewStep = draft.mode ? currentStep === maxStepIndex : false;

  const stepTitle = useMemo(() => {
    if (!draft.mode && currentStep === 0) return "What would you like to create?";
    return steps[currentStep] || "Create";
  }, [draft.mode, currentStep, steps]);

  const progressText = draft.mode ? `Step ${currentStep + 1} of ${steps.length}` : "Start";
  const eventTimeSummary = eventStartIso
    ? `${formatLongDateTime(eventStartIso)}${eventEndIso ? ` → ${formatLongDateTime(eventEndIso)}` : ""}`
    : "—";

  async function handleSubmit() {
    setMsg(null);

    const validationError = validateAllBeforeSubmit();
    if (validationError) {
      setMsg(validationError);
      if (!isLoggedIn || !profileComplete) router.push("/me");
      return;
    }

    if (!userId) {
      setMsg("You must be logged in.");
      return;
    }

    setSaving(true);

    try {
      if (draft.mode === "event") {
        const insertRow: any = {
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
          .insert([insertRow])
          .select("id")
          .single();

        if (createErr || !created?.id) {
          throw new Error(createErr?.message || "Failed to create event.");
        }

        const eventId = String(created.id);

        // required flyer
        const flyer = eventFile;
        if (!flyer) {
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error("Event flyer is required.");
        }

        const ext = getExt(flyer.name);
        const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

        const { error: upErr } = await supabase.storage.from(EVENT_FLYERS_BUCKET).upload(path, flyer, {
          cacheControl: "3600",
          upsert: false,
          contentType: flyer.type || undefined,
        });

        if (upErr) {
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error(`Flyer upload failed: ${upErr.message}`);
        }

        const { data: pub } = supabase.storage.from(EVENT_FLYERS_BUCKET).getPublicUrl(path);
        const flyerPublicUrl = pub.publicUrl;

        const { error: updErr } = await supabase.from(EVENTS_TABLE).update({ photo_url: flyerPublicUrl }).eq("id", eventId);

        if (updErr) {
          await supabase.storage.from(EVENT_FLYERS_BUCKET).remove([path]);
          await supabase.from(EVENTS_TABLE).delete().eq("id", eventId);
          throw new Error(`Flyer saved but event update failed: ${updErr.message}`);
        }

        resetWizard();
        router.push(SUCCESS_ROUTE);
        router.refresh();
        return;
      }

      // items / requests
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
        itemInsert.category = "others";
        itemInsert.pickup_location = null;
        itemInsert.request_group = draft.requestGroup;
        itemInsert.request_timeframe = draft.requestTimeframe;
        itemInsert.request_location = draft.requestLocation.trim() ? draft.requestLocation.trim() : null;
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

      // request: no photo
      if (postType === "request") {
        resetWizard();
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // give: required photo + rollback on fail
      const givePhoto = itemFile;
      if (!givePhoto) {
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error("Photo is required for Give posts.");
      }

      const ext = getExt(givePhoto.name);
      const storagePath = `items/${userId}/${itemId}/${uuidSafe()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from(ITEM_PHOTOS_BUCKET).upload(storagePath, givePhoto, {
        cacheControl: "3600",
        upsert: false,
        contentType: givePhoto.type || undefined,
      });

      if (uploadErr) {
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Photo upload failed: ${uploadErr.message}`);
      }

      const { data: pub } = supabase.storage.from(ITEM_PHOTOS_BUCKET).getPublicUrl(storagePath);
      const publicUrl = pub.publicUrl;

      const { error: updateErr } = await supabase.from(ITEMS_TABLE).update({ photo_url: publicUrl }).eq("id", itemId);

      if (updateErr) {
        await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([storagePath]);
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Photo uploaded but item update failed: ${updateErr.message}`);
      }

      const { error: photoErr } = await supabase
        .from(ITEM_PHOTOS_TABLE)
        .insert([{ item_id: itemId, owner_id: userId, path: storagePath }]);

      if (photoErr) {
        await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([storagePath]);
        await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
        throw new Error(`Photo metadata save failed: ${photoErr.message}`);
      }

      resetWizard();
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(errToMsg(err));
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
    paddingBottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + 84px + 24px)",
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

  const danger: React.CSSProperties = {
    ...button,
    borderColor: "#fecaca",
    color: "#b91c1c",
  };

  const sticky: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px))",
    minHeight: WIZARD_STICKY_HEIGHT,
    background: "rgba(247,247,248,0.92)",
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
    minWidth: 140,
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    color: "white",
    background: disabled ? "#94a3b8" : "#10b981",
    boxShadow: disabled ? "none" : "0 14px 30px rgba(16,185,129,0.25)",
  });

  const ghostBtn: React.CSSProperties = {
    ...button,
    borderRadius: 16,
    minWidth: 96,
  };

  const canGoBack = currentStep > 0;
  const stepError = getStepError(currentStep);

  const stickyHint = useMemo(() => {
    if (!draft.mode) return "Choose Give, Request, or Event to begin.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Finish profile setup in Account.";
    if (stepError) return stepError;
    if (isReviewStep) return "Review everything carefully before posting.";
    return "Looks good. Continue to the next step.";
  }, [draft.mode, isLoggedIn, profileComplete, stepError, isReviewStep]);

  // ---------------- gated screens ----------------
  if (!hydratedDraft || authLoading || profileLoading) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Loading your account…</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
              Restoring your wizard draft and checking profile status.
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

  function renderProgress() {
    if (!draft.mode) return null;
    const pct = ((currentStep + 1) / steps.length) * 100;

    return (
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 950 }}>{progressText}</div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#6b7280" }}>{steps[currentStep]}</div>
          </div>
          <button type="button" onClick={resetWizard} style={{ ...danger, borderRadius: 999 }}>
            Start over
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            height: 10,
            borderRadius: 999,
            background: "#e5e7eb",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "#10b981",
              transition: "width 0.2s ease",
            }}
          />
        </div>
      </div>
    );
  }

  function renderTypeChoice() {
    return (
      <div style={card}>
        <div style={{ fontSize: 24, fontWeight: 950 }}>Choose what you want to create</div>
        <div style={{ marginTop: 8, color: "#4b5563" }}>
          Once you choose a type, it stays locked for this draft unless you start over.
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <button
            type="button"
            onClick={() => selectMode("give")}
            style={{
              ...button,
              textAlign: "left",
              padding: 16,
              borderRadius: 18,
            }}
          >
            <div style={{ fontWeight: 950, fontSize: 18 }}>Give</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
              Give away an item with a required photo, category, and pickup spot.
            </div>
          </button>

          <button
            type="button"
            onClick={() => selectMode("request")}
            style={{
              ...button,
              textAlign: "left",
              padding: 16,
              borderRadius: 18,
            }}
          >
            <div style={{ fontWeight: 950, fontSize: 18 }}>Request</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
              Ask for help or something you need. No photo required.
            </div>
          </button>

          <button
            type="button"
            onClick={() => selectMode("event")}
            style={{
              ...button,
              textAlign: "left",
              padding: 16,
              borderRadius: 18,
            }}
          >
            <div style={{ fontWeight: 950, fontSize: 18 }}>Event</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
              Post a campus event with date, time, location, and a required flyer/photo.
            </div>
          </button>
        </div>
      </div>
    );
  }

  function renderReviewCard() {
    if (!draft.mode) return null;

    if (draft.mode === "event") {
      return (
        <div style={{ ...card, overflow: "hidden", padding: 0 }}>
          <div
            style={{
              position: "relative",
              height: 220,
              background: "#eff6ff",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 900,
                background: "rgba(59,130,246,0.12)",
                color: "#1e3a8a",
                border: "1px solid rgba(59,130,246,0.25)",
              }}
            >
              EVENT
            </div>

            {eventPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={eventPreviewUrl}
                alt="Event preview"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "grid",
                  placeItems: "center",
                  color: "#6b7280",
                  fontWeight: 900,
                }}
              >
                Flyer required
              </div>
            )}
          </div>

          <div style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                Host: {draft.hideName ? "Anonymous" : draft.hostOrg || "—"}
              </span>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>• {draft.eventCategory}</span>
            </div>

            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950 }}>{cleanTitle || "Untitled event"}</div>

            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: "#065f46" }}>
              {eventTimeSummary} • {draft.eventLocation || "Location needed"}
            </div>

            <div style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>
              {cleanDesc || "No description yet."}
            </div>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                color: "#6b7280",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              <span>{draft.eventLink.trim() ? "Link included" : "No link"}</span>
              <span>Starts: {formatShortDate(eventStartIso)}</span>
            </div>
          </div>
        </div>
      );
    }

    if (draft.mode === "request") {
      return (
        <div style={{ ...card, overflow: "hidden", padding: 0, borderColor: "rgba(16,185,129,0.25)" }}>
          <div
            style={{
              position: "relative",
              minHeight: 220,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              background: "rgba(16,185,129,0.08)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 900,
                background: "rgba(16,185,129,0.12)",
                color: "#065f46",
                border: "1px solid rgba(16,185,129,0.25)",
              }}
            >
              REQUEST
            </div>

            <div style={{ fontSize: 13, fontWeight: 900, color: "#374151", marginBottom: 8 }}>
              {requestGroupLabel(draft.requestGroup)}
              {draft.requestTimeframe ? ` • ${requestTimeframeLabel(draft.requestTimeframe)}` : ""}
              {draft.requestLocation.trim() ? ` • ${draft.requestLocation.trim()}` : ""}
            </div>

            <div style={{ fontSize: 20, fontWeight: 950 }}>{cleanTitle || "Untitled request"}</div>
          </div>

          <div style={{ padding: 14 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
              Type: {requestGroupLabel(draft.requestGroup)}
            </div>
            <div style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>
              {cleanDesc || "No description yet."}
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                color: "#6b7280",
                fontWeight: 900,
                fontSize: 12,
              }}
            >
              <span>Tap to offer help</span>
              <span>{draft.expireChoice === "never" ? "No auto-close" : `Auto-close: ${draft.expireChoice}`}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={{ ...card, overflow: "hidden", padding: 0 }}>
        <div
          style={{
            position: "relative",
            height: 220,
            background: "#f3f4f6",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              padding: "6px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 900,
              background: "rgba(16,185,129,0.12)",
              color: "#065f46",
              border: "1px solid rgba(16,185,129,0.25)",
              zIndex: 1,
            }}
          >
            AVAILABLE
          </div>

          {itemPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={itemPreviewUrl}
              alt="Item preview"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "#6b7280",
                fontWeight: 900,
              }}
            >
              Photo required
            </div>
          )}
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
              Category: {draft.giveCategory || "—"}
            </span>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>• Pickup: {draft.pickupLocation}</span>
          </div>

          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950 }}>{cleanTitle || "Untitled item"}</div>

          <div style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>
            {cleanDesc || "No description yet."}
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              color: "#6b7280",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            <span>0 requests</span>
            <span>{draft.expireChoice === "never" ? "No auto-close" : `Auto-close: ${draft.expireChoice}`}</span>
          </div>
        </div>
      </div>
    );
  }

  function renderReviewDetails() {
    if (!draft.mode) return null;

    return (
      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 950 }}>Review details</div>
        <div style={{ marginTop: 12, display: "grid", gap: 10, color: "#374151" }}>
          <div><b>Type:</b> {draft.mode}</div>
          <div><b>Title:</b> {cleanTitle || "—"}</div>
          <div><b>Description:</b> {cleanDesc || "—"}</div>

          {draft.mode === "give" && (
            <>
              <div><b>Category:</b> {draft.giveCategory}</div>
              <div><b>Pickup:</b> {draft.pickupLocation}</div>
              <div><b>Photo:</b> {itemFile ? itemFile.name : draft.itemFileName || "Missing"}</div>
              <div><b>Hide my name:</b> {draft.hideName ? "Yes" : "No"}</div>
              <div><b>Auto-close:</b> {draft.expireChoice}</div>
            </>
          )}

          {draft.mode === "request" && (
            <>
              <div><b>Request type:</b> {requestGroupLabel(draft.requestGroup)}</div>
              <div><b>Timeframe:</b> {requestTimeframeLabel(draft.requestTimeframe)}</div>
              <div><b>Location:</b> {draft.requestLocation.trim() || "—"}</div>
              <div><b>Hide my name:</b> {draft.hideName ? "Yes" : "No"}</div>
              <div><b>Auto-close:</b> {draft.expireChoice}</div>
            </>
          )}

          {draft.mode === "event" && (
            <>
              <div><b>Category:</b> {draft.eventCategory}</div>
              <div><b>Host:</b> {draft.hostOrg.trim() || "—"}</div>
              <div><b>Location:</b> {draft.eventLocation.trim() || "—"}</div>
              <div><b>Time:</b> {eventTimeSummary}</div>
              <div><b>Link:</b> {draft.eventLink.trim() || "—"}</div>
              <div><b>Flyer:</b> {eventFile ? eventFile.name : draft.eventFileName || "Missing"}</div>
              <div><b>Hide my name:</b> {draft.hideName ? "Yes" : "No"}</div>
            </>
          )}
        </div>

        {(draft.mode === "give" && !itemFile) || (draft.mode === "event" && !eventFile) ? (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 14,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontWeight: 800,
            }}
          >
            Drafts save your text and choices, but browser refreshes do not safely preserve the actual uploaded file.
            Please re-select the image before posting if needed.
          </div>
        ) : null}
      </div>
    );
  }

  function renderStepContent() {
    if (!draft.mode || currentStep === 0) return renderTypeChoice();

    // GIVE
    if (draft.mode === "give") {
      if (currentStep === 1) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>What are you giving away?</div>
            <div style={{ marginTop: 10 }}>
              <input
                value={draft.title}
                onChange={(e) => patchDraft("title", e.target.value)}
                style={input}
                placeholder={`Example: "Bedford Handbook (good condition)"`}
                autoFocus
              />
            </div>
          </div>
        );
      }

      if (currentStep === 2) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Any details someone should know?</div>
            <div style={{ marginTop: 10 }}>
              <textarea
                value={draft.description}
                onChange={(e) => patchDraft("description", e.target.value)}
                style={textarea}
                rows={5}
                placeholder="Condition, what's included, any flaws."
                autoFocus
              />
            </div>
          </div>
        );
      }

      if (currentStep === 3) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Add a photo (required)</div>
            <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
              JPG / PNG / WEBP • max {MAX_ITEM_PHOTO_MB}MB
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                ref={itemFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => pickItemFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
              <button type="button" style={button} onClick={() => itemFileInputRef.current?.click()}>
                {itemFile ? "Change photo" : "Choose photo"}
              </button>
              {itemFile && (
                <button type="button" style={danger} onClick={() => pickItemFile(null)}>
                  Remove
                </button>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
              {itemFile ? `Selected: ${itemFile.name}` : draft.itemFileName ? `Saved draft file name: ${draft.itemFileName}` : "No file selected yet."}
            </div>

            {itemPreviewUrl && (
              <div style={{ marginTop: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={itemPreviewUrl}
                  alt="Item preview"
                  style={{
                    width: "100%",
                    height: 280,
                    objectFit: "cover",
                    borderRadius: 16,
                    border: "1px solid #e5e7eb",
                  }}
                />
              </div>
            )}
          </div>
        );
      }

      if (currentStep === 4) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Choose a category</div>
            <div style={{ marginTop: 10 }}>
              <select
                value={draft.giveCategory}
                onChange={(e) => patchDraft("giveCategory", e.target.value as GiveCategory)}
                style={select}
                autoFocus
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
          </div>
        );
      }

      if (currentStep === 5) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Choose a pickup spot</div>
            <div style={{ marginTop: 10 }}>
              <select
                value={draft.pickupLocation}
                onChange={(e) => patchDraft("pickupLocation", e.target.value as PickupLocation)}
                style={select}
                autoFocus
              >
                <option value="College Quad">College Quad</option>
                <option value="Safety Service Office">Safety Service Office</option>
                <option value="Dining Hall">Dining Hall</option>
              </select>
            </div>
          </div>
        );
      }

      if (currentStep === 6) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>More options</div>

            <div style={{ marginTop: 12, ...row2 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Hide my name</div>
                <button
                  type="button"
                  onClick={() => patchDraft("hideName", !draft.hideName)}
                  style={{
                    ...button,
                    width: "100%",
                    background: draft.hideName ? "rgba(16,185,129,0.10)" : "white",
                  }}
                >
                  {draft.hideName ? "Hidden: ON" : "Hidden: OFF"}
                </button>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Automatically close after</div>
                <select
                  value={draft.expireChoice}
                  onChange={(e) => patchDraft("expireChoice", e.target.value as ExpireChoice)}
                  style={select}
                >
                  <option value="urgent24">Urgent (24 hours)</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="never">Until I cancel</option>
                </select>
              </div>
            </div>
          </div>
        );
      }

      return (
        <>
          {renderReviewCard()}
          {renderReviewDetails()}
        </>
      );
    }

    // REQUEST
    if (draft.mode === "request") {
      if (currentStep === 1) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>What do you need?</div>
            <div style={{ marginTop: 10 }}>
              <input
                value={draft.title}
                onChange={(e) => patchDraft("title", e.target.value)}
                style={input}
                placeholder={`Example: "Need a ride Friday 6am"`}
                autoFocus
              />
            </div>
          </div>
        );
      }

      if (currentStep === 2) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Add context so people can help fast</div>
            <div style={{ marginTop: 10 }}>
              <textarea
                value={draft.description}
                onChange={(e) => patchDraft("description", e.target.value)}
                style={textarea}
                rows={5}
                placeholder="Where/when/how urgent? Keep it simple."
                autoFocus
              />
            </div>
          </div>
        );
      }

      if (currentStep === 3) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Choose request type</div>
            <div style={{ marginTop: 10 }}>
              <select
                value={draft.requestGroup}
                onChange={(e) => patchDraft("requestGroup", e.target.value as RequestGroup)}
                style={select}
                autoFocus
              >
                <option value="logistics">Logistics (ride / moving / borrow)</option>
                <option value="services">Services (tutoring / tech help / haircut)</option>
                <option value="urgent">Urgent (charger / calculator / meds)</option>
                <option value="collaboration">Collaboration (club / hackathon / project)</option>
              </select>
            </div>
          </div>
        );
      }

      if (currentStep === 4) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Choose timeframe</div>
            <div style={{ marginTop: 10 }}>
              <select
                value={draft.requestTimeframe}
                onChange={(e) => patchDraft("requestTimeframe", e.target.value as RequestTimeframe)}
                style={select}
                autoFocus
              >
                <option value="today">Today</option>
                <option value="this_week">This week</option>
                <option value="flexible">Flexible</option>
              </select>
            </div>
          </div>
        );
      }

      if (currentStep === 5) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>Location (optional)</div>
            <div style={{ marginTop: 10 }}>
              <input
                value={draft.requestLocation}
                onChange={(e) => patchDraft("requestLocation", e.target.value)}
                style={input}
                placeholder={`Example: "Dorm A" or "Near dining hall"`}
                autoFocus
              />
            </div>
          </div>
        );
      }

      if (currentStep === 6) {
        return (
          <div style={card}>
            <div style={{ fontWeight: 950 }}>More options</div>

            <div style={{ marginTop: 12, ...row2 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Hide my name</div>
                <button
                  type="button"
                  onClick={() => patchDraft("hideName", !draft.hideName)}
                  style={{
                    ...button,
                    width: "100%",
                    background: draft.hideName ? "rgba(16,185,129,0.10)" : "white",
                  }}
                >
                  {draft.hideName ? "Hidden: ON" : "Hidden: OFF"}
                </button>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Automatically close after</div>
                <select
                  value={draft.expireChoice}
                  onChange={(e) => patchDraft("expireChoice", e.target.value as ExpireChoice)}
                  style={select}
                >
                  <option value="urgent24">Urgent (24 hours)</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="never">Until I cancel</option>
                </select>
              </div>
            </div>
          </div>
        );
      }

      return (
        <>
          {renderReviewCard()}
          {renderReviewDetails()}
        </>
      );
    }

    // EVENT
    if (currentStep === 1) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Event title</div>
          <div style={{ marginTop: 10 }}>
            <input
              value={draft.title}
              onChange={(e) => patchDraft("title", e.target.value)}
              style={input}
              placeholder={`Example: "Finance Club Guest Speaker Night"`}
              autoFocus
            />
          </div>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Short description</div>
          <div style={{ marginTop: 10 }}>
            <textarea
              value={draft.description}
              onChange={(e) => patchDraft("description", e.target.value)}
              style={textarea}
              rows={5}
              placeholder="What is it? Who is it for? Any key details."
              autoFocus
            />
          </div>
        </div>
      );
    }

    if (currentStep === 3) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Choose event category</div>
          <div style={{ marginTop: 10 }}>
            <select
              value={draft.eventCategory}
              onChange={(e) => patchDraft("eventCategory", e.target.value as EventCategory)}
              style={select}
              autoFocus
            >
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
        </div>
      );
    }

    if (currentStep === 4) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Host Club / Organisation</div>
          <div style={{ marginTop: 10 }}>
            <input
              value={draft.hostOrg}
              onChange={(e) => patchDraft("hostOrg", e.target.value)}
              style={input}
              placeholder={`Example: "Finance Club"`}
              autoFocus
            />
          </div>
        </div>
      );
    }

    if (currentStep === 5) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Where is the event?</div>
          <div style={{ marginTop: 10 }}>
            <input
              value={draft.eventLocation}
              onChange={(e) => patchDraft("eventLocation", e.target.value)}
              style={input}
              placeholder={`Example: "Dauch 125"`}
              autoFocus
            />
          </div>
        </div>
      );
    }

    if (currentStep === 6) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Choose time</div>

          <div style={{ marginTop: 12, ...row2 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Date</div>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patchDraft("eventDate", e.target.value)}
                style={input}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Start time</div>
              <input
                type="time"
                value={draft.eventStartTime}
                onChange={(e) => {
                  patchDraft("eventStartTime", e.target.value);
                  if (draft.eventDurationPreset !== "custom" && e.target.value) {
                    const mins = Number(draft.eventDurationPreset);
                    if (!Number.isNaN(mins)) patchDraft("eventEndTime", addMinutesToTime(e.target.value, mins));
                  }
                }}
                style={input}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 8 }}>
              Quick duration
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "30 min", value: 30, preset: "30" as EventDurationPreset },
                { label: "1 hour", value: 60, preset: "60" as EventDurationPreset },
                { label: "90 min", value: 90, preset: "90" as EventDurationPreset },
                { label: "2 hours", value: 120, preset: "120" as EventDurationPreset },
              ].map((x) => {
                const active = draft.eventDurationPreset === x.preset;
                return (
                  <button
                    key={x.preset}
                    type="button"
                    onClick={() => applyDurationPreset(x.value, x.preset)}
                    style={{
                      ...button,
                      borderRadius: 999,
                      background: active ? "rgba(16,185,129,0.10)" : "white",
                    }}
                  >
                    {x.label}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => patchDraft("eventDurationPreset", "custom")}
                style={{
                  ...button,
                  borderRadius: 999,
                  background: draft.eventDurationPreset === "custom" ? "rgba(16,185,129,0.10)" : "white",
                }}
              >
                Custom
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>
              End time (optional)
            </div>
            <input
              type="time"
              value={draft.eventEndTime}
              onChange={(e) => {
                patchDraft("eventDurationPreset", "custom");
                patchDraft("eventEndTime", e.target.value);
              }}
              style={input}
            />
          </div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
            Preview: {eventTimeSummary}
          </div>
        </div>
      );
    }

    if (currentStep === 7) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Flyer / poster (required)</div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            JPG / PNG / WEBP • max {MAX_EVENT_FLYER_MB}MB
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              ref={eventFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => pickEventFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            <button type="button" style={button} onClick={() => eventFileInputRef.current?.click()}>
              {eventFile ? "Change flyer" : "Choose flyer"}
            </button>
            {eventFile && (
              <button type="button" style={danger} onClick={() => pickEventFile(null)}>
                Remove
              </button>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
            {eventFile ? `Selected: ${eventFile.name}` : draft.eventFileName ? `Saved draft file name: ${draft.eventFileName}` : "No file selected yet."}
          </div>

          {eventPreviewUrl && (
            <div style={{ marginTop: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={eventPreviewUrl}
                alt="Flyer preview"
                style={{
                  width: "100%",
                  height: 280,
                  objectFit: "cover",
                  borderRadius: 16,
                  border: "1px solid #e5e7eb",
                }}
              />
            </div>
          )}
        </div>
      );
    }

    if (currentStep === 8) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>Optional link</div>
          <div style={{ marginTop: 10 }}>
            <input
              value={draft.eventLink}
              onChange={(e) => patchDraft("eventLink", e.target.value)}
              style={input}
              placeholder={`Example: "https://instagram.com/p/..."`}
              autoFocus
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            If provided, must start with http:// or https://
          </div>
        </div>
      );
    }

    if (currentStep === 9) {
      return (
        <div style={card}>
          <div style={{ fontWeight: 950 }}>More options</div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#6b7280", marginBottom: 6 }}>Hide my name</div>
            <button
              type="button"
              onClick={() => patchDraft("hideName", !draft.hideName)}
              style={{
                ...button,
                width: "100%",
                background: draft.hideName ? "rgba(16,185,129,0.10)" : "white",
              }}
            >
              {draft.hideName ? "Hidden: ON" : "Hidden: OFF"}
            </button>
            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              When ON, your name won’t show publicly.
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {renderReviewCard()}
        {renderReviewDetails()}
      </>
    );
  }

  // ---------------- render ----------------
  return (
    <div style={pageStyle}>
      <div style={shell}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
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

        {renderProgress()}

        <div style={{ ...card, marginTop: draft.mode ? 12 : 0 }}>
          <div style={{ fontSize: 22, fontWeight: 950 }}>{stepTitle}</div>
          <div style={{ marginTop: 6, color: "#4b5563" }}>
            {!draft.mode
              ? "Pick one path and go step by step."
              : draft.mode === "give"
              ? "Give flow: item with required photo, category, and pickup."
              : draft.mode === "request"
              ? "Request flow: no photo, faster completion."
              : "Event flow: efficient date and time setup with required flyer."}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {renderStepContent()}

          {msg && (
            <div
              style={{
                ...card,
                borderColor: "#fecdd3",
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

      {/* Sticky controls */}
      <div style={sticky}>
        <div style={stickyInner}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{stickyHint}</div>
          </div>

          {canGoBack ? (
            <button type="button" onClick={prevStep} style={ghostBtn} disabled={saving}>
              Back
            </button>
          ) : (
            <button type="button" onClick={() => router.push("/feed")} style={ghostBtn} disabled={saving}>
              Cancel
            </button>
          )}

          {!isReviewStep ? (
            <button type="button" onClick={nextStep} disabled={saving || !canGoNext} style={primary(saving || !canGoNext)}>
              Next
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={saving} style={primary(saving)}>
              {saving ? "Posting…" : draft.mode === "event" ? "Post event" : draft.mode === "request" ? "Post request" : "Post item"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}