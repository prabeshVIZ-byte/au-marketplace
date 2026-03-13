"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  host_org: string | null;
  category: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  link_url: string | null;
  photo_url: string | null;
  is_anonymous: boolean | null;
  is_cancelled: boolean | null;
  created_by: string | null;
  owner_id: string | null;
  price: number | null;
  is_negotiable: boolean | null;
};

type StepKey = "write" | "details" | "review";

const APP_NAV_HEIGHT_PX = 86;
const ACTION_BAR_HEIGHT_PX = 84;

const EVENT_CATEGORY_OPTIONS = [
  "career",
  "club",
  "sports",
  "music",
  "arts",
  "volunteering",
  "academic",
  "social",
  "other",
] as const;

type EventCategory = (typeof EVENT_CATEGORY_OPTIONS)[number];

function toInputDateTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromInputDateTime(v: string) {
  if (!v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventCategoryLabel(v: string | null) {
  const raw = (v ?? "").trim();
  if (!raw) return "Event";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isValidHttpUrlMaybeEmpty(raw: string) {
  const v = raw.trim();
  if (!v) return true;
  return /^https?:\/\//i.test(v);
}

function isEnded(startsAt: string | null, endsAt: string | null) {
  const endIso = endsAt ?? startsAt;
  if (!endIso) return false;
  const ts = new Date(endIso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

function sanitizePriceInput(raw: string) {
  let out = raw.replace(/[^\d.]/g, "");
  const firstDot = out.indexOf(".");
  if (firstDot !== -1) {
    out =
      out.slice(0, firstDot + 1) +
      out
        .slice(firstDot + 1)
        .replace(/\./g, "");
  }
  const [whole, dec] = out.split(".");
  if (dec !== undefined) return `${whole}.${dec.slice(0, 2)}`;
  return out;
}

function parseOptionalPrice(raw: string) {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return value;
}

function formatPriceLabel(raw: string, negotiable: boolean) {
  const parsed = parseOptionalPrice(raw);
  if (parsed === null) return "Free";
  if (Number.isNaN(parsed)) return "Invalid price";
  return `$${parsed.toFixed(2)}${negotiable ? " • Negotiable" : " • Fixed"}`;
}

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";
  const topRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRow | null>(null);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const steps: StepKey[] = ["write", "details", "review"];
  const currentStep = steps[currentStepIndex];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [hostOrg, setHostOrg] = useState("");
  const [category, setCategory] = useState<EventCategory>("club");
  const [location, setLocation] = useState("");

  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");

  const [linkUrl, setLinkUrl] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const [price, setPrice] = useState("");
  const [isNegotiable, setIsNegotiable] = useState(false);

  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  const organizerId = useMemo(() => {
    return event?.owner_id ?? event?.created_by ?? null;
  }, [event?.owner_id, event?.created_by]);

  const isOwner = useMemo(() => {
    return !!userId && !!organizerId && userId === organizerId;
  }, [userId, organizerId]);

  const editingLocked = useMemo(() => {
    if (!event) return false;
    return false;
  }, [event]);

  const startIso = useMemo(() => fromInputDateTime(startsAtLocal), [startsAtLocal]);
  const endIso = useMemo(() => fromInputDateTime(endsAtLocal), [endsAtLocal]);

  const dirty = useMemo(() => {
    if (!event) return false;

    return (
      title !== (event.title ?? "") ||
      description !== (event.description ?? "") ||
      hostOrg !== (event.host_org ?? "") ||
      category !== ((event.category as EventCategory) ?? "club") ||
      location !== (event.location ?? "") ||
      startsAtLocal !== toInputDateTime(event.starts_at ?? null) ||
      endsAtLocal !== toInputDateTime(event.ends_at ?? null) ||
      linkUrl !== (event.link_url ?? "") ||
      photoUrl !== (event.photo_url ?? "") ||
      price !== (event.price == null ? "" : String(event.price)) ||
      isNegotiable !== !!event.is_negotiable ||
      isAnonymous !== !!event.is_anonymous ||
      isCancelled !== !!event.is_cancelled
    );
  }, [
    event,
    title,
    description,
    hostOrg,
    category,
    location,
    startsAtLocal,
    endsAtLocal,
    linkUrl,
    photoUrl,
    price,
    isNegotiable,
    isAnonymous,
    isCancelled,
  ]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
  }

  async function loadEvent() {
    if (!id) return;

    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const { data, error } = await supabase
        .from("events")
        .select(
          "id,title,description,host_org,category,location,starts_at,ends_at,link_url,photo_url,is_anonymous,is_cancelled,created_by,owner_id,price,is_negotiable"
        )
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);

      const row = data as EventRow;

      setEvent(row);

      setTitle(row.title ?? "");
      setDescription(row.description ?? "");
      setHostOrg(row.host_org ?? "");
      setCategory(((row.category as EventCategory) ?? "club") as EventCategory);
      setLocation(row.location ?? "");
      setStartsAtLocal(toInputDateTime(row.starts_at ?? null));
      setEndsAtLocal(toInputDateTime(row.ends_at ?? null));
      setLinkUrl(row.link_url ?? "");
      setPhotoUrl(row.photo_url ?? "");
      setPrice(row.price == null ? "" : String(row.price));
      setIsNegotiable(!!row.is_negotiable);
      setIsAnonymous(!!row.is_anonymous);
      setIsCancelled(!!row.is_cancelled);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load event.";
      setErr(message);
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }

  function stepTitle(step: StepKey) {
    if (step === "write") return "Edit your event";
    if (step === "details") return "Update event details";
    return "Review changes";
  }

  function stepSubtitle(step: StepKey) {
    if (step === "write") return "Fix the title, description, and flyer link.";
    if (step === "details") return "Update host, category, location, time, and visibility.";
    return "Check everything before saving.";
  }

  function validateStep(step: StepKey) {
    if (!title.trim()) return "Title is required.";
    if (step === "write" && description.trim().length < 3) return "Description is required.";

    if (step === "details") {
      if (!hostOrg.trim()) return "Host is required.";
      if (!category) return "Choose a category.";
      if (!location.trim()) return "Location is required.";
      if (!startsAtLocal.trim()) return "Start time is required.";
      if (!startIso) return "Start time is invalid.";
      if (!isValidHttpUrlMaybeEmpty(linkUrl)) return "Link must start with http:// or https://";
      if (!isValidHttpUrlMaybeEmpty(photoUrl)) return "Flyer URL must start with http:// or https://";

      const parsedPrice = parseOptionalPrice(price);
      if (Number.isNaN(parsedPrice)) return "Price must be a valid number with up to 2 decimals.";

      if (endsAtLocal.trim() && endIso && startIso) {
        if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
          return "End time cannot be before start time.";
        }
      }
    }

    return null;
  }

  function goNext() {
    setErr(null);
    setOk(null);

    const problem = validateStep(currentStep);
    if (problem) {
      setErr(problem);
      return;
    }

    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((p) => p + 1);
      requestAnimationFrame(() => {
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function goPrev() {
    setErr(null);
    setOk(null);

    if (currentStepIndex <= 0) {
      router.back();
      return;
    }

    setCurrentStepIndex((p) => Math.max(0, p - 1));
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function save() {
    if (!event) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      if (!isOwner) throw new Error("You are not allowed to edit this event.");
      if (editingLocked) throw new Error("Editing is currently locked for this event.");

      const finalProblem =
        validateStep("write") || validateStep("details") || validateStep("review");
      if (finalProblem) throw new Error(finalProblem);

      const parsedPrice = parseOptionalPrice(price);

      const payload = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        host_org: hostOrg.trim() ? hostOrg.trim() : null,
        category,
        location: location.trim() ? location.trim() : null,
        starts_at: startIso,
        ends_at: endsAtLocal.trim() ? endIso : null,
        link_url: linkUrl.trim() ? linkUrl.trim() : null,
        photo_url: photoUrl.trim() ? photoUrl.trim() : null,
        price: parsedPrice === null ? null : parsedPrice,
        is_negotiable: parsedPrice === null ? false : isNegotiable,
        is_anonymous: isAnonymous,
        is_cancelled: isCancelled,
      };

      const { error } = await supabase.from("events").update(payload).eq("id", event.id);
      if (error) throw new Error(error.message);

      setOk("Saved successfully ✅");
      await loadEvent();
      setCurrentStepIndex(2);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save.";
      setErr(message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    syncAuth();
    loadEvent();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadEvent();
    });

    return () => sub.subscription.unsubscribe();
  }, [id]);

  const pageBottomPad = `calc(${APP_NAV_HEIGHT_PX}px + ${ACTION_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom) + 22px)`;
  const bottomOffset = `calc(${APP_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 10px)`;

  if (loading) {
    return (
      <div className="page">
        <div className="shell">
          <div className="statusCard">
            <div className="statusTitle">Loading…</div>
            <div className="statusText">Getting your event ready for editing.</div>
          </div>

          <style jsx>{baseStyles}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: pageBottomPad as string }}>
      <div className="shell" ref={topRef}>
        <div className="topBar">
          <button className="topBtn" onClick={() => router.push(`/event/${id}`)} type="button">
            ← View event
          </button>

          <div className="topRight">
            <button className="topBtn" onClick={() => router.push("/me")} type="button">
              My profile
            </button>
          </div>
        </div>

        <div className="heroHeader">
          <div className="eyebrow">EDIT</div>
          <div className="heroTitle">{stepTitle(currentStep)}</div>
          <div className="heroSubtitle">{stepSubtitle(currentStep)}</div>
        </div>

        {!isOwner && (
          <div className="errorBanner">You are not the owner of this event. Editing is disabled.</div>
        )}

        {editingLocked && (
          <div className="warningBanner">
            Editing is currently locked for this event.
          </div>
        )}

        {err && <div className="errorBanner">{err}</div>}
        {ok && <div className="okBanner">{ok}</div>}

        <div className="stepper">
          {steps.map((step, index) => {
            const active = index === currentStepIndex;
            const done = index < currentStepIndex;
            const label = step === "write" ? "Write" : step === "details" ? "Details" : "Review";

            return (
              <div className="stepItem" key={step}>
                <div className={`stepDot ${active ? "active" : ""} ${done ? "done" : ""}`}>
                  {done ? "✓" : index + 1}
                </div>
                <div className={`stepLabel ${active ? "active" : ""}`}>{label}</div>
              </div>
            );
          })}
        </div>

        {event && (
          <>
            {currentStep === "write" && (
              <section className="card">
                <div className="fieldBlock">
                  <label className="fieldLabel">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="titleInput"
                    placeholder="What’s your event called?"
                    disabled={!isOwner || saving || editingLocked}
                    autoFocus
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="textArea"
                    rows={7}
                    placeholder="Update the event description"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Flyer URL</label>
                  <input
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    className="softInput"
                    placeholder="https://..."
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="previewCard">
                  <div className="previewMedia">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt="Preview" className="previewImg" />
                    ) : (
                      <div className="previewEmpty">No flyer preview</div>
                    )}
                  </div>

                  <div className="previewBody">
                    <div className="previewMeta">EVENT</div>
                    <div className="previewHeadline">{title.trim() || "Untitled event"}</div>
                    <div className="previewText">{description.trim() || "No description yet."}</div>
                  </div>
                </div>
              </section>
            )}

            {currentStep === "details" && (
              <section className="card">
                <div className="fieldBlock">
                  <label className="fieldLabel">Host</label>
                  <input
                    value={hostOrg}
                    onChange={(e) => setHostOrg(e.target.value)}
                    className="softInput"
                    placeholder="Host club / organization"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <div className="fieldLabel">Category</div>
                  <div className="choiceGrid">
                    {EVENT_CATEGORY_OPTIONS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`choice ${category === v ? "selected purple" : ""}`}
                        onClick={() => setCategory(v)}
                        disabled={!isOwner || saving || editingLocked}
                      >
                        {eventCategoryLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Location</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="softInput"
                    placeholder="Where is it happening?"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Start time</label>
                  <input
                    type="datetime-local"
                    value={startsAtLocal}
                    onChange={(e) => setStartsAtLocal(e.target.value)}
                    className="softInput"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">End time</label>
                  <input
                    type="datetime-local"
                    value={endsAtLocal}
                    onChange={(e) => setEndsAtLocal(e.target.value)}
                    className="softInput"
                    disabled={!isOwner || saving || editingLocked}
                  />
                  <div className="helperText">Leave blank if no end time is needed.</div>
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Event link</label>
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="softInput"
                    placeholder="https://..."
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Price (optional)</label>
                  <input
                    value={price}
                    onChange={(e) => {
                      const next = sanitizePriceInput(e.target.value);
                      setPrice(next);
                      if (!next.trim()) setIsNegotiable(false);
                    }}
                    className="softInput"
                    placeholder="Leave blank if free"
                    inputMode="decimal"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                {price.trim().length > 0 && (
                  <div className="fieldBlock">
                    <div className="fieldLabel">Negotiation</div>
                    <div className="segmentRow two">
                      <button
                        type="button"
                        className={`segment ${!isNegotiable ? "active" : ""}`}
                        onClick={() => setIsNegotiable(false)}
                        disabled={!isOwner || saving || editingLocked}
                      >
                        Fixed price
                      </button>
                      <button
                        type="button"
                        className={`segment ${isNegotiable ? "active" : ""}`}
                        onClick={() => setIsNegotiable(true)}
                        disabled={!isOwner || saving || editingLocked}
                      >
                        Negotiable
                      </button>
                    </div>
                  </div>
                )}

                {!isValidHttpUrlMaybeEmpty(linkUrl) && (
                  <div className="warningBanner">Link must start with http:// or https://</div>
                )}

                {!isValidHttpUrlMaybeEmpty(photoUrl) && (
                  <div className="warningBanner">Flyer URL must start with http:// or https://</div>
                )}

                {!!startsAtLocal &&
                  !!endsAtLocal &&
                  !!startIso &&
                  !!endIso &&
                  new Date(endIso).getTime() < new Date(startIso).getTime() && (
                    <div className="warningBanner">End time cannot be before start time.</div>
                  )}

                <div className="divider" />

                <div className="fieldBlock">
                  <div className="fieldLabel">Visibility</div>
                  <div className="segmentRow two">
                    <button
                      type="button"
                      className={`segment ${!isAnonymous ? "active" : ""}`}
                      onClick={() => setIsAnonymous(false)}
                      disabled={!isOwner || saving || editingLocked}
                    >
                      Show my name
                    </button>
                    <button
                      type="button"
                      className={`segment ${isAnonymous ? "active" : ""}`}
                      onClick={() => setIsAnonymous(true)}
                      disabled={!isOwner || saving || editingLocked}
                    >
                      Anonymous
                    </button>
                  </div>
                </div>

                <div className="fieldBlock">
                  <div className="fieldLabel">Event status</div>
                  <div className="segmentRow two">
                    <button
                      type="button"
                      className={`segment ${!isCancelled ? "active" : ""}`}
                      onClick={() => setIsCancelled(false)}
                      disabled={!isOwner || saving || editingLocked}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      className={`segment ${isCancelled ? "active cancel" : "cancel"}`}
                      onClick={() => setIsCancelled(true)}
                      disabled={!isOwner || saving || editingLocked}
                    >
                      Cancelled
                    </button>
                  </div>
                  <div className="helperText">
                    Canceling the event will later trigger attendee notifications.
                  </div>
                </div>
              </section>
            )}

            {currentStep === "review" && (
              <section className="card">
                <div className="reviewPreview">
                  <div className="reviewPreviewMedia">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt={title || "Preview"} className="reviewPreviewImg" />
                    ) : (
                      <div className="previewEmpty">No flyer preview</div>
                    )}
                  </div>

                  <div className="reviewPreviewBody">
                    <div className="previewMeta">EVENT</div>
                    <div className="previewHeadline">{title.trim() || "Untitled event"}</div>
                    <div className="previewText">{description.trim() || "No description yet."}</div>
                  </div>
                </div>

                <div className="reviewList">
                  <div className="reviewRow">
                    <span className="reviewKey">Type</span>
                    <span className="reviewValue">Event</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Host</span>
                    <span className="reviewValue">{hostOrg.trim() || "None"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Category</span>
                    <span className="reviewValue">{eventCategoryLabel(category)}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Location</span>
                    <span className="reviewValue">{location.trim() || "None"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Starts</span>
                    <span className="reviewValue">{formatDateTime(startIso)}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Ends</span>
                    <span className="reviewValue">{formatDateTime(endsAtLocal ? endIso : null)}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Link</span>
                    <span className="reviewValue">{linkUrl.trim() || "None"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Price</span>
                    <span className="reviewValue">{formatPriceLabel(price, isNegotiable)}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Visibility</span>
                    <span className="reviewValue">{isAnonymous ? "Anonymous" : "Show my name"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Status</span>
                    <span className="reviewValue">
                      {isCancelled ? "Cancelled" : isEnded(startIso, endIso) ? "Ended / scheduled in past" : "Active"}
                    </span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Changed</span>
                    <span className="reviewValue">{dirty ? "Yes" : "No changes yet"}</span>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <div className="stickyBar" style={{ bottom: bottomOffset as string }}>
        <div className="stickyInner">
          <div className="stickyText">
            <div className="stickyMini">Edit flow</div>
            <div className="stickyMain">
              {!isOwner
                ? "Owner access required"
                : editingLocked
                ? "Editing locked"
                : currentStep === "review"
                ? dirty
                  ? "Ready to save changes"
                  : "No changes yet"
                : `Step ${currentStepIndex + 1} of ${steps.length}`}
            </div>
          </div>

          <button className="secondaryBtn" onClick={goPrev} disabled={saving} type="button">
            {currentStepIndex === 0 ? "Back" : "Previous"}
          </button>

          {currentStep !== "review" ? (
            <button
              className="primaryBtn"
              onClick={goNext}
              disabled={!isOwner || saving || editingLocked}
              type="button"
            >
              Continue
            </button>
          ) : (
            <button
              className="primaryBtn"
              onClick={save}
              disabled={!isOwner || saving || editingLocked || !dirty}
              type="button"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          )}
        </div>
      </div>

      <style jsx>{baseStyles}</style>
      <style jsx>{`
        .heroHeader {
          margin-bottom: 16px;
        }

        .eyebrow {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #64748b;
          font-weight: 1000;
        }

        .heroTitle {
          margin-top: 6px;
          font-size: 31px;
          line-height: 1.04;
          font-weight: 1000;
          letter-spacing: -0.045em;
        }

        .heroSubtitle {
          margin-top: 8px;
          font-size: 14px;
          color: #64748b;
          font-weight: 600;
        }

        .stepper {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }

        .stepItem {
          min-width: 0;
          text-align: center;
        }

        .stepDot {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          margin: 0 auto;
          font-size: 12px;
          font-weight: 1000;
          background: #fff;
          color: #64748b;
          border: 1px solid #e5e7eb;
        }

        .stepDot.active {
          background: #ede9fe;
          color: #6d28d9;
          border-color: #c4b5fd;
        }

        .stepDot.done {
          background: #03133d;
          color: #fff;
          border-color: #03133d;
        }

        .stepLabel {
          margin-top: 8px;
          font-size: 12px;
          color: #64748b;
          font-weight: 900;
        }

        .stepLabel.active {
          color: #0f172a;
        }

        .card {
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid #e5e7eb;
          border-radius: 28px;
          padding: 18px;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.05);
        }

        .fieldBlock {
          display: grid;
          gap: 8px;
          margin-bottom: 18px;
        }

        .fieldLabel {
          font-size: 13px;
          color: #475569;
          font-weight: 900;
        }

        .titleInput {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          padding: 8px 0 12px 0;
          font-size: 30px;
          line-height: 1.05;
          font-weight: 1000;
          letter-spacing: -0.045em;
          border-bottom: 1px solid #e5e7eb;
        }

        .textArea {
          width: 100%;
          border: 1px solid #e5e7eb;
          outline: none;
          background: #fff;
          padding: 16px;
          border-radius: 20px;
          resize: vertical;
          font-size: 15px;
          line-height: 1.65;
          color: #0f172a;
        }

        .softInput {
          width: 100%;
          padding: 14px 15px;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: #fff;
          outline: none;
          font-size: 14px;
          color: #0f172a;
        }

        .choiceGrid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .choice {
          padding: 12px 14px;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-weight: 900;
          font-size: 14px;
          cursor: pointer;
        }

        .choice.selected.purple {
          background: #ede9fe;
          border-color: #8b5cf6;
          color: #6d28d9;
        }

        .segmentRow {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .segmentRow.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .segment {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          border-radius: 18px;
          padding: 13px 14px;
          font-weight: 900;
          cursor: pointer;
        }

        .segment.active {
          border-color: #03133d;
          background: #03133d;
          color: #fff;
        }

        .segment.cancel.active {
          border-color: #b91c1c;
          background: #b91c1c;
          color: #fff;
        }

        .divider {
          height: 1px;
          background: #eef2f7;
          margin: 6px 0 18px 0;
        }

        .helperText {
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
          line-height: 1.4;
        }

        .previewCard,
        .reviewPreview {
          background: rgba(255, 255, 255, 0.98);
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
        }

        .previewMedia,
        .reviewPreviewMedia {
          position: relative;
          height: 220px;
          background: #f8fafc;
          border-bottom: 1px solid #eef2f7;
          overflow: hidden;
        }

        .previewImg,
        .reviewPreviewImg {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .previewEmpty {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          text-align: center;
          color: #64748b;
          font-weight: 800;
          padding: 20px;
        }

        .previewBody,
        .reviewPreviewBody {
          padding: 16px;
        }

        .previewMeta {
          font-size: 12px;
          color: #64748b;
          font-weight: 900;
        }

        .previewHeadline {
          margin-top: 8px;
          font-size: 24px;
          line-height: 1.14;
          font-weight: 1000;
          letter-spacing: -0.03em;
        }

        .previewText {
          margin-top: 12px;
          font-size: 14px;
          color: #334155;
          line-height: 1.55;
        }

        .reviewList {
          margin-top: 18px;
          display: grid;
          gap: 0;
        }

        .reviewRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 0;
          border-bottom: 1px solid #eef2f7;
        }

        .reviewKey {
          font-size: 13px;
          color: #64748b;
          font-weight: 900;
        }

        .reviewValue {
          font-size: 14px;
          color: #0f172a;
          font-weight: 900;
          text-align: right;
          line-height: 1.45;
        }

        @media (max-width: 520px) {
          .heroTitle {
            font-size: 27px;
          }

          .titleInput {
            font-size: 27px;
          }

          .segmentRow {
            grid-template-columns: 1fr;
          }

          .previewMedia,
          .reviewPreviewMedia {
            height: 190px;
          }
        }
      `}</style>
    </div>
  );
}

const baseStyles = `
  .page {
    min-height: 100vh;
    background: linear-gradient(180deg, #f8fafc 0%, #f6f7fb 42%, #f8fafc 100%);
    color: #0f172a;
    padding: 16px;
  }

  .shell {
    max-width: 980px;
    margin: 0 auto;
  }

  .topBar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .topRight {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topBtn {
    border: 1px solid #e5e7eb;
    background: rgba(255,255,255,0.88);
    color: #0f172a;
    padding: 10px 14px;
    border-radius: 999px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 10px 24px rgba(15,23,42,0.04);
  }

  .statusCard {
    background: rgba(255,255,255,0.95);
    border: 1px solid #e5e7eb;
    border-radius: 26px;
    padding: 22px;
    box-shadow: 0 24px 60px rgba(15,23,42,0.06);
  }

  .statusTitle {
    font-weight: 1000;
    font-size: 22px;
  }

  .statusText {
    margin-top: 8px;
    color: #64748b;
    font-weight: 700;
  }

  .errorBanner,
  .warningBanner,
  .okBanner {
    margin-bottom: 14px;
    padding: 14px 16px;
    border-radius: 18px;
    font-weight: 900;
  }

  .errorBanner {
    background: #fff1f2;
    border: 1px solid #fecdd3;
    color: #9f1239;
  }

  .warningBanner {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
  }

  .okBanner {
    background: #ecfdf5;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .stickyBar {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 9999;
    padding: 10px 12px;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .stickyInner {
    width: 100%;
    max-width: 980px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(255,255,255,0.92);
    border: 1px solid rgba(226,232,240,0.95);
    border-radius: 24px;
    padding: 14px 16px;
    box-shadow: 0 18px 50px rgba(15,23,42,0.14);
    backdrop-filter: blur(16px);
    pointer-events: auto;
  }

  .stickyText {
    min-width: 0;
    flex: 1;
  }

  .stickyMini {
    font-size: 12px;
    color: #64748b;
    font-weight: 800;
  }

  .stickyMain {
    margin-top: 3px;
    font-size: 14px;
    color: #0f172a;
    font-weight: 1000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .secondaryBtn {
    border: 1px solid #e5e7eb;
    background: #fff;
    color: #0f172a;
    padding: 12px 15px;
    border-radius: 16px;
    cursor: pointer;
    font-weight: 900;
    white-space: nowrap;
  }

  .primaryBtn {
    border: none;
    background: #03133d;
    color: #fff;
    padding: 13px 18px;
    border-radius: 18px;
    cursor: pointer;
    font-weight: 1000;
    min-width: 142px;
    box-shadow: 0 18px 35px rgba(3,19,61,0.22);
    white-space: nowrap;
  }

  .primaryBtn:disabled,
  .secondaryBtn:disabled {
    opacity: 0.58;
    cursor: not-allowed;
    box-shadow: none;
  }

  @media (max-width: 560px) {
    .stickyInner {
      flex-wrap: wrap;
    }

    .secondaryBtn,
    .primaryBtn {
      flex: 1;
      min-width: 0;
    }
  }
`;