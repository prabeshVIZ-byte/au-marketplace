"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
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
  price: number | null;
  is_negotiable: boolean | null;
  reserved_interest_id?: string | null;
};

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

function sanitizePriceInput(v: string) {
  const cleaned = v.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const left = cleaned.slice(0, firstDot + 1);
  const right = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return left + right;
}

function parsePrice(v: string) {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Number(n.toFixed(2));
}

function formatPrice(price: number | null, isNegotiable: boolean) {
  if (price == null) return "Free";
  return `$${price.toFixed(2)}${isNegotiable ? " • Negotiable" : ""}`;
}

export default function EditItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [category, setCategory] = useState<GiveCategory>("books");
  const [pickupLocation, setPickupLocation] = useState<PickupLocation>("College Quad");

  const [requestGroup, setRequestGroup] = useState<RequestGroup>("logistics");
  const [requestTimeframe, setRequestTimeframe] = useState<RequestTimeframe>("today");
  const [requestLocation, setRequestLocation] = useState("");

  const [photoUrl, setPhotoUrl] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [isNegotiable, setIsNegotiable] = useState(false);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const editingLocked = useMemo(() => {
    if (!item) return false;
    const st = (item.status ?? "").trim().toLowerCase();
    return st === "reserved" || st === "claimed" || st === "completed" || !!item.reserved_interest_id;
  }, [item]);

  const dirty = useMemo(() => {
    if (!item) return false;

    const sharedChanged =
      title !== (item.title ?? "") ||
      description !== (item.description ?? "") ||
      photoUrl !== (item.photo_url ?? "") ||
      isAnonymous !== !!item.is_anonymous ||
      expiresAtLocal !== toInputDateTime(item.expires_at);

    if (postType === "give") {
      return (
        sharedChanged ||
        category !== ((item.category as GiveCategory) ?? "books") ||
        pickupLocation !== ((item.pickup_location as PickupLocation) ?? "College Quad") ||
        priceInput !== (item.price == null ? "" : String(item.price)) ||
        isNegotiable !== !!item.is_negotiable
      );
    }

    return (
      sharedChanged ||
      requestGroup !== ((item.request_group as RequestGroup) ?? "logistics") ||
      requestTimeframe !== ((item.request_timeframe as RequestTimeframe) ?? "today") ||
      requestLocation !== (item.request_location ?? "")
    );
  }, [
    item,
    postType,
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
    priceInput,
    isNegotiable,
  ]);

  function hydrateForm(row: ItemRow) {
    setTitle(row.title ?? "");
    setDescription(row.description ?? "");
    setCategory(((row.category as GiveCategory) ?? "books") as GiveCategory);
    setPickupLocation(((row.pickup_location as PickupLocation) ?? "College Quad") as PickupLocation);
    setRequestGroup(((row.request_group as RequestGroup) ?? "logistics") as RequestGroup);
    setRequestTimeframe(((row.request_timeframe as RequestTimeframe) ?? "today") as RequestTimeframe);
    setRequestLocation(row.request_location ?? "");
    setPhotoUrl(row.photo_url ?? "");
    setIsAnonymous(!!row.is_anonymous);
    setExpiresAtLocal(toInputDateTime(row.expires_at));
    setPriceInput(row.price == null ? "" : String(row.price));
    setIsNegotiable(!!row.is_negotiable);
  }

  async function bootstrap() {
    if (!id) {
      setError("Missing item id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setOk(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);

      const uid = sessionData.session?.user?.id ?? null;
      setUserId(uid);

      const { data, error } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id,price,is_negotiable,reserved_interest_id"
        )
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("Post not found.");

      const row = data as ItemRow;
      setItem(row);
      hydrateForm(row);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load post.";
      setError(message);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }

  function validate() {
    if (!title.trim()) return "Title is required.";
    if (description.trim().length < 3) return "Description is required.";

    if (postType === "give") {
      if (!category) return "Choose a category.";
      if (!pickupLocation) return "Choose a pickup location.";
      const parsedPrice = parsePrice(priceInput);
      if (Number.isNaN(parsedPrice)) return "Price must be a valid number.";
    } else {
      if (!requestGroup) return "Choose a request type.";
      if (!requestTimeframe) return "Choose a timeframe.";
    }

    return null;
  }

  async function sendUpdateNotifications(itemId: string, ownerId: string, nextTitle: string) {
    const recipientIds = new Set<string>();

    if (postType === "give") {
      const { data: interests } = await supabase
        .from("interests")
        .select("user_id,status")
        .eq("item_id", itemId);

      for (const row of (interests as Array<{ user_id: string | null; status: string | null }>) || []) {
        const st = (row.status ?? "").toLowerCase().trim();
        if (!row.user_id) continue;
        if (row.user_id === ownerId) continue;
        if (["pending", "accepted", "reserved"].includes(st)) recipientIds.add(row.user_id);
      }
    } else {
      const { data: offers } = await supabase
        .from("request_offers")
        .select("helper_id,status")
        .eq("request_id", itemId);

      for (const row of (offers as Array<{ helper_id: string | null; status: string | null }>) || []) {
        const st = (row.status ?? "").toLowerCase().trim();
        if (!row.helper_id) continue;
        if (row.helper_id === ownerId) continue;
        if (["pending", "hold", "accepted"].includes(st)) recipientIds.add(row.helper_id);
      }
    }

    if (recipientIds.size === 0) return;

    const notifications = Array.from(recipientIds).map((recipientId) => ({
      recipient_id: recipientId,
      actor_id: ownerId,
      type: "system_notice",
      category: postType,
      entity_type: "item",
      entity_id: itemId,
      parent_entity_type: null,
      parent_entity_id: null,
      title: "Post updated",
      body: `"${nextTitle}" was updated.`,
      image_url: null,
      action_url: `/item/${itemId}`,
      is_read: false,
      read_at: null,
      is_hidden: false,
      hidden_at: null,
    }));

    await supabase.from("notifications").insert(notifications);
  }

  async function save() {
    if (!item) return;

    setSaving(true);
    setError(null);
    setOk(null);

    try {
      if (!userId) throw new Error("Please log in first.");
      if (!isOwner) throw new Error("Only the owner can edit this post.");
      if (editingLocked) {
        throw new Error("Editing is locked because this post is already in an active pickup flow.");
      }

      const validationError = validate();
      if (validationError) throw new Error(validationError);

      const parsedPrice = parsePrice(priceInput);

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
              price: parsedPrice,
              is_negotiable: parsedPrice == null ? false : isNegotiable,
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

      const { error } = await supabase
        .from("items")
        .update(payload)
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      await sendUpdateNotifications(item.id, userId, title.trim());

      setOk("Saved successfully.");
      await bootstrap();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void bootstrap();
    });

    return () => sub.subscription.unsubscribe();
  }, [id]);

  const canEdit = isOwner && !editingLocked && !saving;
  const canSave = canEdit && dirty;

  if (loading) {
    return (
      <div className="page">
        <div className="shell">
          <div className="statusCard">
            <div className="statusTitle">Loading…</div>
            <div className="statusText">Getting your post ready for editing.</div>
          </div>
        </div>

        <style jsx>{styles}</style>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page">
        <div className="shell">
          <div className="topBar">
            <button className="topBtn" onClick={() => router.back()} type="button">
              ← Back
            </button>
          </div>

          <div className="statusCard">
            <div className="statusTitle">Unable to open edit page</div>
            <div className="statusText">{error || "This post could not be loaded."}</div>
          </div>
        </div>

        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="shell">
        <div className="topBar">
          <button className="topBtn" onClick={() => router.push(`/item/${item.id}`)} type="button">
            ← View post
          </button>

          <div className="topRight">
            <button className="topBtn" onClick={() => router.push(`/manage/${item.id}`)} type="button">
              Manage
            </button>
          </div>
        </div>

        <div className="heroHeader">
          <div className="eyebrow">EDIT</div>
          <div className="heroTitle">Edit your {postType === "give" ? "post" : "request"}</div>
          <div className="heroSubtitle">
            This version waits for both session and item data before deciding access.
          </div>
        </div>

        {!userId ? (
          <div className="errorBanner">You need to log in before editing this post.</div>
        ) : null}

        {userId && !isOwner ? (
          <div className="errorBanner">You are not the owner of this post. Editing is disabled.</div>
        ) : null}

        {editingLocked ? (
          <div className="warningBanner">
            Editing is locked because this post is already reserved, claimed, completed, or tied to an active pickup flow.
          </div>
        ) : null}

        {error ? <div className="errorBanner">{error}</div> : null}
        {ok ? <div className="okBanner">{ok}</div> : null}

        <section className="card">
          <div className="sectionTitle">Main content</div>

          <div className="fieldBlock">
            <label className="fieldLabel">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="titleInput"
              placeholder="What are you posting?"
              disabled={!canEdit}
            />
          </div>

          <div className="fieldBlock">
            <label className="fieldLabel">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="textArea"
              rows={6}
              placeholder="Describe the post"
              disabled={!canEdit}
            />
          </div>

          <div className="fieldBlock">
            <label className="fieldLabel">Photo URL</label>
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="softInput"
              placeholder="https://..."
              disabled={!canEdit}
            />
          </div>
        </section>

        <section className="card">
          <div className="sectionTitle">{postType === "give" ? "Item details" : "Request details"}</div>

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
                      disabled={!canEdit}
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
                      disabled={!canEdit}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fieldBlock">
                <label className="fieldLabel">Price (optional)</label>
                <input
                  value={priceInput}
                  onChange={(e) => {
                    const next = sanitizePriceInput(e.target.value);
                    setPriceInput(next);
                    if (!next.trim()) setIsNegotiable(false);
                  }}
                  className="softInput"
                  placeholder="Leave blank if free"
                  disabled={!canEdit}
                  inputMode="decimal"
                />
              </div>

              {priceInput.trim() ? (
                <div className="fieldBlock">
                  <div className="fieldLabel">Negotiation</div>
                  <div className="segmentRow two">
                    <button
                      type="button"
                      className={`segment ${!isNegotiable ? "active" : ""}`}
                      onClick={() => setIsNegotiable(false)}
                      disabled={!canEdit}
                    >
                      Fixed price
                    </button>
                    <button
                      type="button"
                      className={`segment ${isNegotiable ? "active" : ""}`}
                      onClick={() => setIsNegotiable(true)}
                      disabled={!canEdit}
                    >
                      Negotiable
                    </button>
                  </div>
                </div>
              ) : null}
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
                      disabled={!canEdit}
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
                      disabled={!canEdit}
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
                  disabled={!canEdit}
                />
              </div>
            </>
          )}
        </section>

        <section className="card">
          <div className="sectionTitle">Visibility and timing</div>

          <div className="fieldBlock">
            <div className="fieldLabel">Visibility</div>
            <div className="segmentRow two">
              <button
                type="button"
                className={`segment ${!isAnonymous ? "active" : ""}`}
                onClick={() => setIsAnonymous(false)}
                disabled={!canEdit}
              >
                Show my name
              </button>
              <button
                type="button"
                className={`segment ${isAnonymous ? "active" : ""}`}
                onClick={() => setIsAnonymous(true)}
                disabled={!canEdit}
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
              disabled={!canEdit}
            />
            <div className="helperText">Leave blank to keep the post open until you cancel it.</div>
          </div>
        </section>

        <section className="card">
          <div className="sectionTitle">Preview</div>

          <div className="previewCard">
            <div className="previewMedia">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={title || "Preview"} className="previewImg" />
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
                <div className="reviewRow">
                  <span className="reviewKey">Price</span>
                  <span className="reviewValue">
                    {formatPrice(parsePrice(priceInput) as number | null, isNegotiable)}
                  </span>
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

        <div className="stickyBar">
          <div className="stickyInner">
            <div className="stickyText">
              <div className="stickyMini">Edit status</div>
              <div className="stickyMain">
                {!userId
                  ? "Login required"
                  : !isOwner
                  ? "Owner access required"
                  : editingLocked
                  ? "Editing locked"
                  : dirty
                  ? "Ready to save changes"
                  : "No changes yet"}
              </div>
            </div>

            <button
              className="secondaryBtn"
              onClick={() => (item ? hydrateForm(item) : null)}
              disabled={!canEdit || !dirty}
              type="button"
            >
              Reset
            </button>

            <button className="primaryBtn" onClick={save} disabled={!canSave} type="button">
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .page {
    min-height: 100vh;
    background: linear-gradient(180deg, #f8fafc 0%, #f6f7fb 42%, #f8fafc 100%);
    color: #0f172a;
    padding: 16px 16px 120px;
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
    background: rgba(255, 255, 255, 0.9);
    color: #0f172a;
    padding: 10px 14px;
    border-radius: 999px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
  }

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

  .statusCard {
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #e5e7eb;
    border-radius: 26px;
    padding: 22px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.06);
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

  .card {
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #e5e7eb;
    border-radius: 28px;
    padding: 18px;
    box-shadow: 0 20px 50px rgba(15, 23, 42, 0.05);
    margin-bottom: 16px;
  }

  .sectionTitle {
    font-size: 18px;
    font-weight: 1000;
    margin-bottom: 14px;
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
    color: #0f172a;
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

  .helperText {
    font-size: 12px;
    color: #64748b;
    font-weight: 700;
    line-height: 1.4;
  }

  .previewCard {
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid #e5e7eb;
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
  }

  .previewMedia {
    position: relative;
    height: 220px;
    background: #f8fafc;
    border-bottom: 1px solid #eef2f7;
    overflow: hidden;
  }

  .previewImg {
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

  .previewBody {
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

  .stickyBar {
    position: sticky;
    bottom: 12px;
    z-index: 50;
  }

  .stickyInner {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid rgba(226, 232, 240, 0.95);
    border-radius: 24px;
    padding: 14px 16px;
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14);
    backdrop-filter: blur(16px);
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
    box-shadow: 0 18px 35px rgba(3, 19, 61, 0.22);
    white-space: nowrap;
  }

  .primaryBtn:disabled,
  .secondaryBtn:disabled,
  .choice:disabled,
  .segment:disabled,
  .topBtn:disabled,
  .titleInput:disabled,
  .textArea:disabled,
  .softInput:disabled {
    opacity: 0.58;
    cursor: not-allowed;
    box-shadow: none;
  }

  @media (max-width: 560px) {
    .page {
      padding: 12px 12px 110px;
    }

    .heroTitle {
      font-size: 27px;
    }

    .titleInput {
      font-size: 27px;
    }

    .segmentRow {
      grid-template-columns: 1fr;
    }

    .previewMedia {
      height: 190px;
    }

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