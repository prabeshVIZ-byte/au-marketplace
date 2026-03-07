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
type StepIndex = 0 | 1 | 2;

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

  currentStep: StepIndex;

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

const DRAFT_KEY = "scholarswap_create_draft_v2";
const SUCCESS_ROUTE = "/feed";
const WIZARD_STICKY_HEIGHT = 86;

// ---------- utils ----------
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

    currentStep: 0,

    itemFileName: null,
    eventFileName: null,
  };
}

function getSteps(mode: Mode | null) {
  if (!mode) return ["Choose", "Details", "Review"];
  if (mode === "give") return ["Details", "Photo & options", "Review"];
  if (mode === "request") return ["Details", "Location & options", "Review"];
  return ["Details", "Time & flyer", "Review"];
}

// ---------- main ----------
export default function CreatePage() {
  const router = useRouter();

  const itemFileInputRef = useRef<HTMLInputElement | null>(null);
  const eventFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const steps = useMemo(() => getSteps(draft.mode), [draft.mode]);
  const currentStep = draft.currentStep;

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

      if (merged.currentStep !== 0 && merged.currentStep !== 1 && merged.currentStep !== 2) {
        merged.currentStep = 0;
      }

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
      // ignore localStorage failure
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

  function pickItemFile(file: File | null) {
    setMsg(null);

    if (!file) {
      setItemFile(null);
      patchDraft("itemFileName", null);
      return;
    }

    if (!isAllowedImage(file)) {
      setMsg("Upload JPG, PNG, or WEBP.");
      return;
    }

    if (file.size > MAX_ITEM_PHOTO_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_ITEM_PHOTO_MB}MB.`);
      return;
    }

    setItemFile(file);
    patchDraft("itemFileName", file.name);
  }

  function pickEventFile(file: File | null) {
    setMsg(null);

    if (!file) {
      setEventFile(null);
      patchDraft("eventFileName", null);
      return;
    }

    if (!isAllowedImage(file)) {
      setMsg("Upload JPG, PNG, or WEBP.");
      return;
    }

    if (file.size > MAX_EVENT_FLYER_MB * 1024 * 1024) {
      setMsg(`Image is too large. Max ${MAX_EVENT_FLYER_MB}MB.`);
      return;
    }

    setEventFile(file);
    patchDraft("eventFileName", file.name);
  }

  function selectMode(mode: Mode) {
    setMsg(null);
    setDraft((prev) => ({
      ...getDefaultDraft(),
      mode,
      currentStep: 0,
    }));
    setItemFile(null);
    setEventFile(null);
  }

  function getStepError(step: StepIndex): string | null {
    if (!draft.mode) return "Choose Give, Request, or Event.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first.";

    if (draft.mode === "give") {
      if (step === 0) {
        if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
        if (cleanDesc.length < 3) return "Description is required.";
        if (!draft.giveCategory) return "Choose a category.";
        if (!draft.pickupLocation) return "Choose a pickup location.";
      }

      if (step === 1) {
        if (!itemFile) return "Please upload an image.";
        if (!isAllowedImage(itemFile)) return "Image must be JPG, PNG, or WEBP.";
      }

      return null;
    }

    if (draft.mode === "request") {
      if (step === 0) {
        if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
        if (cleanDesc.length < 3) return "Description is required.";
        if (!draft.requestGroup) return "Choose a request type.";
      }

      if (step === 1) {
        if (!draft.requestTimeframe) return "Choose a timeframe.";
      }

      return null;
    }

    if (draft.mode === "event") {
      if (step === 0) {
        if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
        if (cleanDesc.length < 3) return "Description is required.";
        if (!draft.eventCategory) return "Choose a category.";
        if (!draft.hostOrg.trim()) return "Host is required.";
      }

      if (step === 1) {
        if (!draft.eventLocation.trim()) return "Location is required.";
        if (!draft.eventDate) return "Choose a date.";
        if (!draft.eventStartTime) return "Choose a start time.";
        if (!eventStartIso) return "Start time is invalid.";
        if (!eventFile) return "Please upload an image.";
        if (!isValidHttpUrlMaybeEmpty(draft.eventLink)) {
          return "Link must start with http:// or https://";
        }
        if (
          draft.eventEndTime &&
          eventEndIso &&
          new Date(eventEndIso).getTime() < new Date(eventStartIso).getTime()
        ) {
          return "End time cannot be before start time.";
        }
      }

      return null;
    }

    return null;
  }

  function validateAllBeforeSubmit() {
    const e0 = getStepError(0);
    if (e0) return e0;
    const e1 = getStepError(1);
    if (e1) return e1;
    return null;
  }

  function goToStep(step: StepIndex) {
    setMsg(null);
    if (!draft.mode) return;
    setDraft((prev) => ({ ...prev, currentStep: step }));
  }

  function nextStep() {
    setMsg(null);
    const err = getStepError(currentStep);
    if (err) {
      setMsg(err);
      if (!isLoggedIn || !profileComplete) router.push("/me");
      return;
    }
    if (currentStep < 2) {
      patchDraft("currentStep", (currentStep + 1) as StepIndex);
    }
  }

  function prevStep() {
    setMsg(null);
    if (currentStep > 0) {
      patchDraft("currentStep", (currentStep - 1) as StepIndex);
    }
  }

  async function handleSubmit() {
    setMsg(null);

    const validationError = validateAllBeforeSubmit();
    if (validationError) {
      setMsg(validationError);
      return;
    }

    if (!userId) {
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

        resetWizard();
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
        resetWizard();
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

      resetWizard();
      router.push(`/item/${itemId}`);
      router.refresh();
    } catch (err: any) {
      setMsg(errToMsg(err));
    } finally {
      setSaving(false);
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg, #f8fafc 0%, #f6f7fb 35%, #f8fafc 100%)",
    color: "#0f172a",
    padding: 18,
    paddingBottom:
      "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px) + 98px + 24px)",
  };

  const shell: React.CSSProperties = {
    maxWidth: 780,
    margin: "0 auto",
  };

  const brandWrap: React.CSSProperties = {
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };

  const brandTitle: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 1000,
    letterSpacing: "-0.03em",
  };

  const brandSub: React.CSSProperties = {
    marginTop: 4,
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
  };

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.96)",
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    padding: 16,
    boxShadow: "0 16px 40px rgba(15,23,42,0.06)",
    backdropFilter: "blur(8px)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    outline: "none",
    fontSize: 14,
  };

  const textarea: React.CSSProperties = {
    ...input,
    resize: "vertical",
    lineHeight: 1.4,
  };

  const select: React.CSSProperties = {
    ...input,
    cursor: "pointer",
  };

  const button: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#111827",
    padding: "11px 14px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 900,
  };

  const primary = (disabled: boolean): React.CSSProperties => ({
    border: "none",
    borderRadius: 16,
    padding: "12px 16px",
    minWidth: 130,
    fontWeight: 1000,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    color: "white",
    background: disabled ? "#94a3b8" : "#0f172a",
    boxShadow: disabled ? "none" : "0 16px 34px rgba(15,23,42,0.18)",
  });

  const ghostBtn: React.CSSProperties = {
    ...button,
    borderRadius: 16,
    minWidth: 96,
  };

  const danger: React.CSSProperties = {
    ...button,
    borderColor: "#fecaca",
    color: "#b91c1c",
  };

  const modeButton = (active: boolean): React.CSSProperties => ({
    ...button,
    width: "100%",
    textAlign: "left",
    borderRadius: 18,
    padding: 16,
    background: active ? "#eef2ff" : "#ffffff",
    borderColor: active ? "#c7d2fe" : "#e5e7eb",
    boxShadow: active ? "0 10px 25px rgba(79,70,229,0.08)" : "none",
  });

  const sticky: React.CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height, 86px))",
    minHeight: WIZARD_STICKY_HEIGHT,
    background: "rgba(248,250,252,0.92)",
    borderTop: "1px solid #e5e7eb",
    backdropFilter: "blur(14px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 16px",
  };

  const stickyInner: React.CSSProperties = {
    width: "100%",
    maxWidth: 780,
    display: "flex",
    alignItems: "center",
    gap: 12,
  };

  const row2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  };

  const canGoBack = currentStep > 0;
  const stepError = draft.mode ? getStepError(currentStep) : null;
  const isReviewStep = !!draft.mode && currentStep === 2;

  const stickyHint = useMemo(() => {
    if (!draft.mode) return "Choose one to start.";
    if (!isLoggedIn) return "Log in with your @ashland.edu email.";
    if (!profileComplete) return "Finish your profile first.";
    if (stepError) return stepError;
    if (isReviewStep) return "Review everything before posting.";
    return "Looks good.";
  }, [draft.mode, isLoggedIn, profileComplete, stepError, isReviewStep]);

  const eventTimeSummary = eventStartIso
    ? `${formatLongDateTime(eventStartIso)}${eventEndIso ? ` → ${formatLongDateTime(eventEndIso)}` : ""}`
    : "—";

  function renderModePicker() {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <button type="button" onClick={() => selectMode("give")} style={modeButton(draft.mode === "give")}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Give</div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>
            Share items with others.
          </div>
        </button>

        <button type="button" onClick={() => selectMode("request")} style={modeButton(draft.mode === "request")}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Request</div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>
            Ask the community for items or help you need.
          </div>
        </button>

        <button type="button" onClick={() => selectMode("event")} style={modeButton(draft.mode === "event")}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Event</div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>
            Promote upcoming campus events.
          </div>
        </button>
      </div>
    );
  }

  function renderStepTabs() {
    if (!draft.mode) return null;

    return (
      <div style={{ ...card, padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {steps.map((label, i) => {
            const idx = i as StepIndex;
            const active = idx === currentStep;
            const done = idx < currentStep;

            return (
              <button
                key={label}
                type="button"
                onClick={() => goToStep(idx)}
                style={{
                  ...button,
                  borderRadius: 999,
                  padding: "10px 14px",
                  background: active ? "#0f172a" : done ? "#ecfeff" : "#ffffff",
                  color: active ? "#ffffff" : "#111827",
                  borderColor: active ? "#0f172a" : done ? "#a5f3fc" : "#e5e7eb",
                }}
              >
                {done ? "✓ " : ""}
                {label}
              </button>
            );
          })}
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
              height: 230,
              background: "#eef2ff",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 2,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(15,23,42,0.72)",
                color: "white",
                fontSize: 12,
                fontWeight: 900,
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
                  color: "#64748b",
                  fontWeight: 900,
                }}
              >
                No preview
              </div>
            )}
          </div>

          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              {draft.eventCategory.toUpperCase()} • {draft.hostOrg || "Host"}
            </div>
            <div style={{ marginTop: 8, fontWeight: 1000, fontSize: 22 }}>
              {cleanTitle || "Untitled event"}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: "#0f766e" }}>
              📍 {draft.eventLocation || "Location needed"} • {eventTimeSummary}
            </div>
            <div style={{ marginTop: 12, color: "#374151", fontSize: 14 }}>
              {cleanDesc || "No description yet."}
            </div>
          </div>
        </div>
      );
    }

    if (draft.mode === "request") {
      return (
        <div style={{ ...card, overflow: "hidden", padding: 0 }}>
          <div
            style={{
              minHeight: 170,
              padding: 18,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              background: "linear-gradient(135deg, #ecfeff 0%, #f8fafc 100%)",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f766e" }}>
              {requestGroupLabel(draft.requestGroup)} • {requestTimeframeLabel(draft.requestTimeframe)}
            </div>
            <div style={{ marginTop: 8, fontWeight: 1000, fontSize: 22 }}>
              {cleanTitle || "Untitled request"}
            </div>
          </div>

          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 800 }}>
              📍 {draft.requestLocation.trim() || "No location added"}
            </div>
            <div style={{ marginTop: 12, color: "#374151", fontSize: 14 }}>
              {cleanDesc || "No description yet."}
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
            height: 230,
            background: "#f1f5f9",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 2,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.72)",
              color: "white",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            GIVE
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
                color: "#64748b",
                fontWeight: 900,
              }}
            >
              No preview
            </div>
          )}
        </div>

        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900 }}>
            {draft.giveCategory.toUpperCase()} • {draft.pickupLocation}
          </div>
          <div style={{ marginTop: 8, fontWeight: 1000, fontSize: 22 }}>
            {cleanTitle || "Untitled item"}
          </div>
          <div style={{ marginTop: 12, color: "#374151", fontSize: 14 }}>
            {cleanDesc || "No description yet."}
          </div>
        </div>
      </div>
    );
  }

  function renderReviewDetails() {
    if (!draft.mode) return null;

    return (
      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 1000 }}>Final check</div>

        <div style={{ marginTop: 12, display: "grid", gap: 10, color: "#374151", fontSize: 14 }}>
          <div><b>Type:</b> {draft.mode}</div>
          <div><b>Title:</b> {cleanTitle || "—"}</div>
          <div><b>Description:</b> {cleanDesc || "—"}</div>

          {draft.mode === "give" && (
            <>
              <div><b>Category:</b> {draft.giveCategory}</div>
              <div><b>Pickup:</b> {draft.pickupLocation}</div>
              <div><b>Image:</b> {itemFile ? itemFile.name : draft.itemFileName || "Missing"}</div>
              <div><b>Anonymous:</b> {draft.hideName ? "Yes" : "No"}</div>
              <div><b>Auto-close:</b> {draft.expireChoice}</div>
            </>
          )}

          {draft.mode === "request" && (
            <>
              <div><b>Request type:</b> {requestGroupLabel(draft.requestGroup)}</div>
              <div><b>Timeframe:</b> {requestTimeframeLabel(draft.requestTimeframe)}</div>
              <div><b>Location:</b> {draft.requestLocation.trim() || "—"}</div>
              <div><b>Anonymous:</b> {draft.hideName ? "Yes" : "No"}</div>
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
              <div><b>Image:</b> {eventFile ? eventFile.name : draft.eventFileName || "Missing"}</div>
              <div><b>Anonymous:</b> {draft.hideName ? "Yes" : "No"}</div>
            </>
          )}
        </div>

        {((draft.mode === "give" && !itemFile) || (draft.mode === "event" && !eventFile)) && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 14,
              background: "#fff7ed",
              border: "1px solid #fdba74",
              color: "#9a3412",
              fontWeight: 800,
            }}
          >
            Your text draft was restored, but the browser may not preserve the actual uploaded file after refresh.
            Re-select the image before posting if needed.
          </div>
        )}
      </div>
    );
  }

  function renderStepContent() {
    if (!draft.mode) return null;

    // STEP 1
    if (currentStep === 0) {
      if (draft.mode === "give") {
        return (
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Give details</div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <input
                value={draft.title}
                onChange={(e) => patchDraft("title", e.target.value)}
                style={input}
                placeholder="Item title"
                autoFocus
              />

              <textarea
                value={draft.description}
                onChange={(e) => patchDraft("description", e.target.value)}
                style={textarea}
                rows={5}
                placeholder="Describe the item, condition, and useful details."
              />

              <div style={row2}>
                <select
                  value={draft.giveCategory}
                  onChange={(e) => patchDraft("giveCategory", e.target.value as GiveCategory)}
                  style={select}
                >
                  <option value="books">Books</option>
                  <option value="notes">Notes</option>
                  <option value="electronics">Electronics</option>
                  <option value="furniture">Furniture</option>
                  <option value="clothing">Clothing</option>
                  <option value="sport equipment">Sport Equipment</option>
                  <option value="stationary item">Stationary Item</option>
                  <option value="ride">Ride</option>
                  <option value="art pieces">Art Pieces</option>
                  <option value="health & beauty">Health & Beauty</option>
                  <option value="home & kitchen">Home & Kitchen</option>
                  <option value="jeweleries">Jeweleries</option>
                  <option value="musical instruments">Musical Instruments</option>
                  <option value="lost & found">Lost & Found</option>
                  <option value="others">Others</option>
                </select>

                <select
                  value={draft.pickupLocation}
                  onChange={(e) => patchDraft("pickupLocation", e.target.value as PickupLocation)}
                  style={select}
                >
                  <option value="College Quad">College Quad</option>
                  <option value="Safety Service Office">Safety Service Office</option>
                  <option value="Dining Hall">Dining Hall</option>
                  <option value="Library">Library</option>
                  <option value="Student Center">Student Center</option>
                </select>
              </div>
            </div>
          </div>
        );
      }

      if (draft.mode === "request") {
        return (
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Request details</div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <input
                value={draft.title}
                onChange={(e) => patchDraft("title", e.target.value)}
                style={input}
                placeholder="What do you need?"
                autoFocus
              />

              <textarea
                value={draft.description}
                onChange={(e) => patchDraft("description", e.target.value)}
                style={textarea}
                rows={5}
                placeholder="Add the details people need in order to help you."
              />

              <select
                value={draft.requestGroup}
                onChange={(e) => patchDraft("requestGroup", e.target.value as RequestGroup)}
                style={select}
              >
                <option value="logistics">Logistics</option>
                <option value="services">Services</option>
                <option value="urgent">Urgent</option>
                <option value="collaboration">Collaboration</option>
                <option value="lost & found">Lost & Found</option>
              </select>
            </div>
          </div>
        );
      }

      return (
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 1000 }}>Event details</div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <input
              value={draft.title}
              onChange={(e) => patchDraft("title", e.target.value)}
              style={input}
              placeholder="Event title"
              autoFocus
            />

            <textarea
              value={draft.description}
              onChange={(e) => patchDraft("description", e.target.value)}
              style={textarea}
              rows={5}
              placeholder="Write a short event description."
            />

            <div style={row2}>
              <select
                value={draft.eventCategory}
                onChange={(e) => patchDraft("eventCategory", e.target.value as EventCategory)}
                style={select}
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

              <input
                value={draft.hostOrg}
                onChange={(e) => patchDraft("hostOrg", e.target.value)}
                style={input}
                placeholder="Host club / organisation"
              />
            </div>
          </div>
        </div>
      );
    }

    // STEP 2
    if (currentStep === 1) {
      if (draft.mode === "give") {
        return (
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Image & options</div>

            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              <div>
                <input
                  ref={itemFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => pickItemFile(e.target.files?.[0] ?? null)}
                  style={{ display: "none" }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" style={button} onClick={() => itemFileInputRef.current?.click()}>
                    {itemFile ? "Change image" : "Upload image"}
                  </button>

                  {itemFile && (
                    <button type="button" style={danger} onClick={() => pickItemFile(null)}>
                      Remove
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                  {itemFile
                    ? itemFile.name
                    : draft.itemFileName
                    ? `Saved draft file: ${draft.itemFileName}`
                    : "No image selected"}
                </div>

                {itemPreviewUrl && (
                  <div style={{ marginTop: 12 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={itemPreviewUrl}
                      alt="Item preview"
                      style={{
                        width: "100%",
                        height: 290,
                        objectFit: "cover",
                        borderRadius: 16,
                        border: "1px solid #e5e7eb",
                      }}
                    />
                  </div>
                )}
              </div>

              <div style={row2}>
                <button
                  type="button"
                  onClick={() => patchDraft("hideName", !draft.hideName)}
                  style={{
                    ...button,
                    background: draft.hideName ? "#eef2ff" : "#ffffff",
                    borderColor: draft.hideName ? "#c7d2fe" : "#e5e7eb",
                    width: "100%",
                  }}
                >
                  {draft.hideName ? "Anonymous: ON" : "Anonymous: OFF"}
                </button>

                <select
                  value={draft.expireChoice}
                  onChange={(e) => patchDraft("expireChoice", e.target.value as ExpireChoice)}
                  style={select}
                >
                  <option value="urgent24">24 hours</option>
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

      if (draft.mode === "request") {
        return (
          <div style={card}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Location & options</div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div style={row2}>
                <select
                  value={draft.requestTimeframe}
                  onChange={(e) => patchDraft("requestTimeframe", e.target.value as RequestTimeframe)}
                  style={select}
                >
                  <option value="today">Today</option>
                  <option value="this_week">This week</option>
                  <option value="flexible">Flexible</option>
                </select>

                <input
                  value={draft.requestLocation}
                  onChange={(e) => patchDraft("requestLocation", e.target.value)}
                  style={input}
                  placeholder="Location (optional)"
                />
              </div>

              <div style={row2}>
                <button
                  type="button"
                  onClick={() => patchDraft("hideName", !draft.hideName)}
                  style={{
                    ...button,
                    background: draft.hideName ? "#eef2ff" : "#ffffff",
                    borderColor: draft.hideName ? "#c7d2fe" : "#e5e7eb",
                    width: "100%",
                  }}
                >
                  {draft.hideName ? "Anonymous: ON" : "Anonymous: OFF"}
                </button>

                <select
                  value={draft.expireChoice}
                  onChange={(e) => patchDraft("expireChoice", e.target.value as ExpireChoice)}
                  style={select}
                >
                  <option value="urgent24">24 hours</option>
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
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 1000 }}>Time, place & image</div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div style={row2}>
              <input
                value={draft.eventLocation}
                onChange={(e) => patchDraft("eventLocation", e.target.value)}
                style={input}
                placeholder="Location"
              />

              <input
                value={draft.eventLink}
                onChange={(e) => patchDraft("eventLink", e.target.value)}
                style={input}
                placeholder="Link (optional)"
              />
            </div>

            <div style={row2}>
              <input
                type="date"
                value={draft.eventDate}
                onChange={(e) => patchDraft("eventDate", e.target.value)}
                style={input}
              />
              <input
                type="time"
                value={draft.eventStartTime}
                onChange={(e) => patchDraft("eventStartTime", e.target.value)}
                style={input}
              />
            </div>

            <div style={row2}>
              <input
                type="time"
                value={draft.eventEndTime}
                onChange={(e) => patchDraft("eventEndTime", e.target.value)}
                style={input}
              />
              <button
                type="button"
                onClick={() => patchDraft("hideName", !draft.hideName)}
                style={{
                  ...button,
                  background: draft.hideName ? "#eef2ff" : "#ffffff",
                  borderColor: draft.hideName ? "#c7d2fe" : "#e5e7eb",
                  width: "100%",
                }}
              >
                {draft.hideName ? "Anonymous: ON" : "Anonymous: OFF"}
              </button>
            </div>

            <div>
              <input
                ref={eventFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => pickEventFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" style={button} onClick={() => eventFileInputRef.current?.click()}>
                  {eventFile ? "Change image" : "Upload image"}
                </button>

                {eventFile && (
                  <button type="button" style={danger} onClick={() => pickEventFile(null)}>
                    Remove
                  </button>
                )}
              </div>

              <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                {eventFile
                  ? eventFile.name
                  : draft.eventFileName
                  ? `Saved draft file: ${draft.eventFileName}`
                  : "No image selected"}
              </div>

              {eventPreviewUrl && (
                <div style={{ marginTop: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={eventPreviewUrl}
                    alt="Event preview"
                    style={{
                      width: "100%",
                      height: 290,
                      objectFit: "cover",
                      borderRadius: 16,
                      border: "1px solid #e5e7eb",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // STEP 3
    return (
      <>
        {renderReviewCard()}
        {renderReviewDetails()}
      </>
    );
  }

  if (!hydratedDraft || authLoading || profileLoading) {
    return (
      <div style={pageStyle}>
        <div style={shell}>
          <div style={card}>
            <div style={{ fontWeight: 1000 }}>Loading…</div>
            <div style={{ marginTop: 6, color: "#64748b", fontSize: 14 }}>
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
          <div style={card}>
            <div style={{ fontWeight: 1000, fontSize: 22 }}>You need your Ashland email</div>
            <div style={{ marginTop: 8, color: "#64748b" }}>
              Log in with your <b>@ashland.edu</b> account before posting.
            </div>
            <button onClick={() => router.push("/me")} style={{ ...primary(false), marginTop: 14 }}>
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
          <div style={card}>
            <div style={{ fontWeight: 1000, fontSize: 22 }}>Complete your profile</div>
            <div style={{ marginTop: 8, color: "#64748b" }}>
              Add your full name and choose Student or Faculty first.
            </div>
            <button onClick={() => router.push("/me")} style={{ ...primary(false), marginTop: 14 }}>
              Finish profile
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={shell}>
        <div style={brandWrap}>
          <div>
            <div style={brandTitle}>ScholarSwap</div>
            <div style={brandSub}>List something for campus</div>
          </div>

          <button onClick={() => router.push("/feed")} style={{ ...button, borderRadius: 999 }}>
            ← Feed
          </button>
        </div>

        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#475569", fontWeight: 800 }}>
            Posting as <b>{email}</b>
          </div>
        </div>

        {renderModePicker()}

        {draft.mode && (
          <>
            <div style={{ marginTop: 12 }}>{renderStepTabs()}</div>

            <div style={{ ...card, marginTop: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 1000 }}>
                {steps[currentStep]}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", fontSize: 14 }}>
                Step {currentStep + 1} of 3
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
          </>
        )}
      </div>

      {draft.mode && (
        <div style={sticky}>
          <div style={stickyInner}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                {stickyHint}
              </div>
            </div>

            {canGoBack ? (
              <button type="button" onClick={prevStep} style={ghostBtn} disabled={saving}>
                Back
              </button>
            ) : (
              <button type="button" onClick={resetWizard} style={ghostBtn} disabled={saving}>
                Reset
              </button>
            )}

            {!isReviewStep ? (
              <button
                type="button"
                onClick={nextStep}
                disabled={saving}
                style={primary(saving)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                style={primary(saving)}
              >
                {saving
                  ? "Posting…"
                  : draft.mode === "event"
                  ? "Post event"
                  : draft.mode === "request"
                  ? "Post request"
                  : "Post item"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}