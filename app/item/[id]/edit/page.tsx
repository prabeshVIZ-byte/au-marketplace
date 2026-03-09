"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  category: string | null;
  pickup_location: string | null;

  post_type: PostType | null;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
  reserved_interest_id?: string | null;
};

type StepKey = "write" | "details" | "review";

const APP_NAV_HEIGHT_PX = 86;
const ACTION_BAR_HEIGHT_PX = 84;

const GIVE_CATEGORIES = [
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
] as const;

const PICKUP_OPTIONS = [
  "College Quad",
  "Safety Service Office",
  "Dining Hall",
  "Library",
  "Student Center",
] as const;

const REQUEST_GROUP_OPTIONS = [
  "logistics",
  "services",
  "urgent",
  "collaboration",
  "lost & found",
] as const;

const REQUEST_TIMEFRAME_OPTIONS = [
  "today",
  "this_week",
  "flexible",
] as const;

type GiveCategory = (typeof GIVE_CATEGORIES)[number];
type PickupLocation = (typeof PICKUP_OPTIONS)[number];
type RequestGroup = (typeof REQUEST_GROUP_OPTIONS)[number];
type RequestTimeframe = (typeof REQUEST_TIMEFRAME_OPTIONS)[number];

function toInputDateTime(expiresAt: string | null) {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
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

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until canceled";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "Until canceled";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function giveCategoryLabel(v: string | null) {
  return (v ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function requestGroupLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  if (k === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "—";
}

export default function EditItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";
  const topRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const steps: StepKey[] = ["write", "details", "review"];
  const currentStep = steps[currentStepIndex];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [postType, setPostType] = useState<PostType>("give");

  const [category, setCategory] = useState<GiveCategory>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");

  const [requestGroup, setRequestGroup] = useState<RequestGroup>("logistics");
  const [requestTimeframe, setRequestTimeframe] = useState<RequestTimeframe>("today");
  const [requestLocation, setRequestLocation] = useState("");

  const [photoUrl, setPhotoUrl] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expiresAtLocal, setExpiresAtLocal] = useState("");

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const editingLocked = useMemo(() => {
    if (!item) return false;
    const st = (item.status ?? "").toLowerCase();
    return st === "reserved" || st === "claimed" || !!item.reserved_interest_id;
  }, [item]);

  const dirty = useMemo(() => {
    if (!item) return false;

    return (
      title !== (item.title ?? "") ||
      description !== (item.description ?? "") ||
      category !== ((item.category as GiveCategory) ?? "books") ||
      pickupLocation !== ((item.pickup_location as PickupLocation) ?? "College Quad") ||
      requestGroup !== ((item.request_group as RequestGroup) ?? "logistics") ||
      requestTimeframe !== ((item.request_timeframe as RequestTimeframe) ?? "today") ||
      requestLocation !== (item.request_location ?? "") ||
      photoUrl !== (item.photo_url ?? "") ||
      isAnonymous !== !!item.is_anonymous ||
      expiresAtLocal !== toInputDateTime(item.expires_at ?? null)
    );
  }, [
    item,
    title,
    description,
    category,
    pickupLocation,
    requestGroup,
    requestTimeframe,
    requestLocation,
    photoUrl,
    isAnonymous,
    expiresAtLocal,
  ]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    setUserId(data.session?.user?.id ?? null);
  }

  async function loadItem() {
    if (!id) return;

    setLoading(true);
    setErr(null);
    setOk(null);

    try {
      const { data, error } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id,reserved_interest_id"
        )
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);

      const row = data as ItemRow;
      const type = ((row.post_type ?? "give") as PostType) || "give";

      setItem(row);
      setPostType(type);

      setTitle(row.title ?? "");
      setDescription(row.description ?? "");
      setCategory(((row.category as GiveCategory) ?? "books") as GiveCategory);
      setPickupLocation(
        ((row.pickup_location as PickupLocation) ?? "College Quad") as PickupLocation
      );
      setRequestGroup(((row.request_group as RequestGroup) ?? "logistics") as RequestGroup);
      setRequestTimeframe(
        ((row.request_timeframe as RequestTimeframe) ?? "today") as RequestTimeframe
      );
      setRequestLocation(row.request_location ?? "");
      setPhotoUrl(row.photo_url ?? "");
      setIsAnonymous(!!row.is_anonymous);
      setExpiresAtLocal(toInputDateTime(row.expires_at ?? null));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load item.";
      setErr(message);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  function stepTitle(step: StepKey) {
    if (step === "write") return "Edit your post";
    if (step === "details") return "Update details";
    return "Review changes";
  }

  function stepSubtitle(step: StepKey) {
    if (step === "write") return "Fix the title, description, and image link.";
    if (step === "details") return "Update category, pickup, visibility, and expiry.";
    return "Check everything before saving.";
  }

  function validateStep(step: StepKey) {
    if (!title.trim()) return "Title is required.";
    if (step === "write" && description.trim().length < 3) return "Description is required.";

    if (step === "details") {
      if (postType === "give") {
        if (!category) return "Choose a category.";
        if (!pickupLocation) return "Choose a pickup location.";
      } else {
        if (!requestGroup) return "Choose a request type.";
        if (!requestTimeframe) return "Choose a timeframe.";
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
    if (!item) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      if (!isOwner) throw new Error("You are not allowed to edit this item.");
      if (editingLocked) {
        throw new Error("Editing is locked because this post is already in an active pickup flow.");
      }

      const finalProblem =
        validateStep("write") || validateStep("details") || validateStep("review");
      if (finalProblem) throw new Error(finalProblem);

      const payload =
        postType === "give"
          ? {
              title: title.trim(),
              description: description.trim() ? description.trim() : null,
              category,
              pickup_location: pickupLocation,
              request_group: null,
              request_timeframe: null,
              request_location: null,
              photo_url: photoUrl.trim() ? photoUrl.trim() : null,
              is_anonymous: isAnonymous,
              expires_at: fromInputDateTime(expiresAtLocal),
            }
          : {
              title: title.trim(),
              description: description.trim() ? description.trim() : null,
              category: requestGroup === "lost & found" ? "lost & found" : "others",
              pickup_location: null,
              request_group: requestGroup,
              request_timeframe: requestTimeframe,
              request_location: requestLocation.trim() ? requestLocation.trim() : null,
              photo_url: photoUrl.trim() ? photoUrl.trim() : null,
              is_anonymous: isAnonymous,
              expires_at: fromInputDateTime(expiresAtLocal),
            };

      const { error } = await supabase.from("items").update(payload).eq("id", item.id);
      if (error) throw new Error(error.message);

      setOk("Saved successfully ✅");
      await loadItem();
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
    loadItem();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadItem();
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
            <div className="statusText">Getting your post ready for editing.</div>
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
          <button className="topBtn" onClick={() => router.push(`/item/${id}`)} type="button">
            ← View post
          </button>

          <div className="topRight">
            <button className="topBtn" onClick={() => router.push("/me")} type="button">
              My posts
            </button>
          </div>
        </div>

        <div className="heroHeader">
          <div className="eyebrow">EDIT</div>
          <div className="heroTitle">{stepTitle(currentStep)}</div>
          <div className="heroSubtitle">{stepSubtitle(currentStep)}</div>
        </div>

        {!isOwner && (
          <div className="errorBanner">You are not the owner of this item. Editing is disabled.</div>
        )}

        {editingLocked && (
          <div className="warningBanner">
            Editing is locked because this post is already reserved, claimed, or linked to an active pickup flow.
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

        {item && (
          <>
            {currentStep === "write" && (
              <section className="card">
                <div className="fieldBlock">
                  <label className="fieldLabel">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="titleInput"
                    placeholder="What are you posting?"
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
                    placeholder="Update the description"
                    disabled={!isOwner || saving || editingLocked}
                  />
                </div>

                <div className="fieldBlock">
                  <label className="fieldLabel">Photo URL</label>
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
                      <div className="previewEmpty">No image preview</div>
                    )}
                  </div>

                  <div className="previewBody">
                    <div className="previewMeta">{postType === "give" ? "ITEM" : "REQUEST"}</div>
                    <div className="previewHeadline">{title.trim() || "Untitled post"}</div>
                    <div className="previewText">{description.trim() || "No description yet."}</div>
                  </div>
                </div>
              </section>
            )}

            {currentStep === "details" && (
              <section className="card">
                {postType === "give" ? (
                  <>
                    <div className="fieldBlock">
                      <div className="fieldLabel">Category</div>
                      <div className="choiceGrid">
                        {GIVE_CATEGORIES.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`choice ${category === v ? "selected warm" : ""}`}
                            onClick={() => setCategory(v)}
                            disabled={!isOwner || saving || editingLocked}
                          >
                            {giveCategoryLabel(v)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="fieldBlock">
                      <div className="fieldLabel">Pickup location</div>
                      <div className="choiceGrid">
                        {PICKUP_OPTIONS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`choice ${pickupLocation === v ? "selected neutral" : ""}`}
                            onClick={() => setPickupLocation(v)}
                            disabled={!isOwner || saving || editingLocked}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="fieldBlock">
                      <div className="fieldLabel">Request type</div>
                      <div className="choiceGrid">
                        {REQUEST_GROUP_OPTIONS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`choice ${requestGroup === v ? "selected blue" : ""}`}
                            onClick={() => setRequestGroup(v)}
                            disabled={!isOwner || saving || editingLocked}
                          >
                            {requestGroupLabel(v)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="fieldBlock">
                      <div className="fieldLabel">Timeframe</div>
                      <div className="segmentRow">
                        {REQUEST_TIMEFRAME_OPTIONS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`segment ${requestTimeframe === v ? "active" : ""}`}
                            onClick={() => setRequestTimeframe(v)}
                            disabled={!isOwner || saving || editingLocked}
                          >
                            {requestTimeframeLabel(v)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="fieldBlock">
                      <label className="fieldLabel">Location</label>
                      <input
                        value={requestLocation}
                        onChange={(e) => setRequestLocation(e.target.value)}
                        className="softInput"
                        placeholder="Optional location"
                        disabled={!isOwner || saving || editingLocked}
                      />
                    </div>
                  </>
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
                  <label className="fieldLabel">Expires at</label>
                  <input
                    type="datetime-local"
                    value={expiresAtLocal}
                    onChange={(e) => setExpiresAtLocal(e.target.value)}
                    className="softInput"
                    disabled={!isOwner || saving || editingLocked}
                  />
                  <div className="helperText">
                    Leave blank to keep it open until you cancel it.
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
                      <div className="previewEmpty">No image preview</div>
                    )}
                  </div>

                  <div className="reviewPreviewBody">
                    <div className="previewMeta">{postType === "give" ? "ITEM" : "REQUEST"}</div>
                    <div className="previewHeadline">{title.trim() || "Untitled post"}</div>
                    <div className="previewText">{description.trim() || "No description yet."}</div>
                  </div>
                </div>

                <div className="reviewList">
                  <div className="reviewRow">
                    <span className="reviewKey">Type</span>
                    <span className="reviewValue">{postType === "give" ? "Give" : "Request"}</span>
                  </div>

                  {postType === "give" ? (
                    <>
                      <div className="reviewRow">
                        <span className="reviewKey">Category</span>
                        <span className="reviewValue">{giveCategoryLabel(category)}</span>
                      </div>
                      <div className="reviewRow">
                        <span className="reviewKey">Pickup</span>
                        <span className="reviewValue">{pickupLocation}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="reviewRow">
                        <span className="reviewKey">Request type</span>
                        <span className="reviewValue">{requestGroupLabel(requestGroup)}</span>
                      </div>
                      <div className="reviewRow">
                        <span className="reviewKey">Timeframe</span>
                        <span className="reviewValue">{requestTimeframeLabel(requestTimeframe)}</span>
                      </div>
                      <div className="reviewRow">
                        <span className="reviewKey">Location</span>
                        <span className="reviewValue">{requestLocation.trim() || "None"}</span>
                      </div>
                    </>
                  )}

                  <div className="reviewRow">
                    <span className="reviewKey">Visibility</span>
                    <span className="reviewValue">{isAnonymous ? "Anonymous" : "Show my name"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Expires</span>
                    <span className="reviewValue">{formatExpiry(fromInputDateTime(expiresAtLocal))}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Changed</span>
                    <span className="reviewValue">{dirty ? "Yes" : "No changes yet"}</span>
                  </div>

                  <div className="reviewRow">
                    <span className="reviewKey">Workflow status</span>
                    <span className="reviewValue">{item.status ?? "available"} (read-only)</span>
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
          background: #e0e7ff;
          color: #312e81;
          border-color: #a5b4fc;
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

        .choice.selected.warm {
          background: #ffedd5;
          border-color: #fb923c;
          color: #9a3412;
        }

        .choice.selected.neutral {
          background: #f1f5f9;
          border-color: #94a3b8;
        }

        .choice.selected.blue {
          background: #dbeafe;
          border-color: #60a5fa;
          color: #1d4ed8;
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