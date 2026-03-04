"use client";

import Image from "next/image";
import { Outfit } from "next/font/google";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const brandFont = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

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

type RequestGroup = "logistics" | "services" | "urgent" | "collaboration";
type RequestTimeframe = "today" | "this_week" | "flexible";

type PickupLocation = "College Quad" | "Safety Service Office" | "Dining Hall";
type ExpireChoice = "7" | "14" | "30" | "never" | "urgent24";

const NAV_APPROX_HEIGHT = 86;
const STICKY_BAR_HEIGHT = 74;
const MAX_PHOTO_MB = 6;

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
  // mobile safe
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export default function CreatePage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // auth
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // profile
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);

  // post type
  const [postType, setPostType] = useState<PostType>("give");

  // shared
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

  // options
  const [showOptions, setShowOptions] = useState(false);
  const [hideName, setHideName] = useState(false);
  const [expireChoice, setExpireChoice] = useState<ExpireChoice>("7");

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // photo drag state
  const [dragOver, setDragOver] = useState(false);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanDesc = useMemo(() => {
    const d = description.trim();
    return d.length ? d : null;
  }, [description]);

  // switching to request resets photo
  useEffect(() => {
    if (postType === "request") {
      setFile(null);
      setPreviewUrl(null);
      if (expireChoice === "never") setExpireChoice("7");
    }
    setMsg(null);
  }, [postType]); // eslint-disable-line react-hooks/exhaustive-deps

  // preview URL
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // auth (timeout-safe; never hangs forever)
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

  function validate(): string | null {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";
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
    if (cleanTitle.length < 3) return false;

    if (postType === "give" && !file) return false;
    if (postType === "give" && file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return false;
      if (!isAllowedImage(file)) return false;
    }
    return true;
  }, [isAllowed, userId, profileComplete, cleanTitle, postType, file]);

  function handleFilePicked(f: File | null) {
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

      const { data: created, error: createErr } = await supabase
        .from("items")
        .insert([baseInsert])
        .select("id")
        .single();

      if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create post.");

      const itemId = created.id as string;

      // request: no photo step
      if (postType === "request") {
        router.push(`/item/${itemId}`);
        router.refresh();
        return;
      }

      // give: photo upload required
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

  const stickyHint =
    cleanTitle.length < 3
      ? "Add a clear title (3+ characters)."
      : postType === "give"
      ? file
        ? "Photo attached — ready to post."
        : "Photo required to post."
      : "Ready to post.";

  // LOADING / GATES
  if (authLoading || profileLoading) {
    return (
      <div className={`${brandFont.className} page`}>
        <div className="gate">
          <div className="gateCard">
            <div className="gateTitle">Loading…</div>
            <div className="gateHint">
              If this hangs on Vercel, your <b>NEXT_PUBLIC_SUPABASE_URL</b> or <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b> is
              missing.
            </div>
            {msg ? <div className="gateErr">{msg}</div> : null}
            <button className="gateBtn" onClick={() => router.push("/feed")} type="button">
              Back to Feed
            </button>
          </div>
        </div>
        <style jsx>{baseStyles}</style>
      </div>
    );
  }

  if (!isAllowed || !userId) {
    return (
      <div className={`${brandFont.className} page`}>
        <div className="gate">
          <div className="gateCard">
            <div className="gateTitle">Sign in required</div>
            <div className="gateHint">
              You must log in with your <b>@ashland.edu</b> email to post.
            </div>
            {msg ? <div className="gateErr">{msg}</div> : null}
            <button className="gateBtn" onClick={() => router.push("/me")} type="button">
              Go to Account
            </button>
          </div>
        </div>
        <style jsx>{baseStyles}</style>
      </div>
    );
  }

  if (!profileComplete) {
    return (
      <div className={`${brandFont.className} page`}>
        <div className="gate">
          <div className="gateCard">
            <div className="gateTitle">Complete profile</div>
            <div className="gateHint">
              Before posting, add your <b>full name</b> and choose <b>Student/Faculty</b>.
            </div>
            {msg ? <div className="gateErr">{msg}</div> : null}
            <button className="gateBtn" onClick={() => router.push("/me")} type="button">
              Set up Profile
            </button>
          </div>
        </div>
        <style jsx>{baseStyles}</style>
      </div>
    );
  }

  return (
    <div className={`${brandFont.className} page`}>
      {/* TOPBAR aligned with Feed styling */}
      <header className="topbar">
        {/* Row 1: Brand */}
        <div className="row brandRow">
          <button className="logoBtn" onClick={() => router.push("/feed")} aria-label="Back to feed" type="button">
            <Image src="/scholarswap-logo.png" alt="ScholarSwap" width={34} height={34} priority className="logoImg" />
          </button>

          <div className="brandCenter" role="heading" aria-level={1}>
            <span className="brandName">Create</span>
            <Image
              src="/Ashland_Eagles_logo.svg.png"
              alt="Ashland University"
              width={18}
              height={18}
              priority
              className="brandMark"
            />
          </div>

          <button className="plusBtn" onClick={() => router.push("/feed")} aria-label="Close" type="button">
            ✕
          </button>
        </div>

        {/* Row 2: Toggle */}
        <div className="row tabsRow">
          <div className="seg" role="tablist" aria-label="Create tabs">
            <button
              className={`segBtn ${postType === "give" ? "active" : ""}`}
              onClick={() => setPostType("give")}
              type="button"
            >
              Give
            </button>
            <button
              className={`segBtn ${postType === "request" ? "active" : ""}`}
              onClick={() => setPostType("request")}
              type="button"
            >
              Request
            </button>
            <span className={`segIndicator ${postType === "give" ? "left" : "right"}`} aria-hidden="true" />
          </div>

          <button
            className={`ctrlBtn ${showOptions ? "ctrlActive" : ""}`}
            onClick={() => setShowOptions((v) => !v)}
            type="button"
            aria-label="More options"
            title="More options"
          >
            <span className="ctrlIcon">≡</span>
          </button>
        </div>

        {/* Row 3: Context line */}
        <div className="row sublineRow">
          <div className="subTitle">
            {postType === "give" ? "List an item with a photo" : "Post a request for help"}{" "}
            <span className="muted">• {email}</span>
          </div>
        </div>

        {msg ? <div className="row errRow">{msg}</div> : null}
      </header>

      {/* MAIN */}
      <main className="main">
        <form ref={formRef} onSubmit={handleSubmit} className="stack">
          {/* Card 1: Title */}
          <section className="card">
            <div className="cardTop">
              <div className="cardTitle">{postType === "give" ? "What are you offering?" : "What do you need?"}</div>
              <div className="cardHint">Keep it short. Condition + key detail.</div>
            </div>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={postType === "give" ? 'Example: "Bedford Handbook (good condition)"' : 'Example: "Ride to airport Friday 6am"'}
              maxLength={120}
            />
          </section>

          {/* Card 2: Details */}
          <section className="card">
            <div className="cardTop">
              <div className="cardTitle">Add details (optional)</div>
              <div className="cardHint">{postType === "give" ? "Include flaws, pickup constraints." : "Location, urgency, timing."}</div>
            </div>
            <textarea
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={postType === "give" ? "What’s included? any flaws?" : "Where/when/how urgent? Keep it simple."}
            />
          </section>

          {/* Give: Photo */}
          {postType === "give" && (
            <section className="card">
              <div className="cardTop">
                <div className="cardTitle">
                  Photo <span className="req">(required)</span>
                </div>
                <div className="cardHint">
                  JPG/PNG/WEBP • max {MAX_PHOTO_MB}MB
                </div>
              </div>

              <div
                className={`drop ${dragOver ? "dropOn" : ""} ${previewUrl ? "dropHas" : ""}`}
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
                  if (dropped) handleFilePicked(dropped);
                }}
              >
                <div className="dropLeft">
                  <div className="dropIcon">⬆</div>
                  <div>
                    <div className="dropTitle">
                      {previewUrl ? "Photo attached" : dragOver ? "Drop it here" : "Drag & drop a photo"}
                    </div>
                    <div className="dropSub">{previewUrl ? "You can change it anytime." : "Or choose a file."}</div>
                  </div>
                </div>

                <div className="dropBtns">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
                    style={{ display: "none" }}
                  />
                  <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>
                    {previewUrl ? "Change" : "Choose"}
                  </button>
                  {file ? (
                    <button type="button" className="btn danger" onClick={() => setFile(null)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>

              {previewUrl ? (
                <div className="previewWrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Preview" className="previewImg" />
                </div>
              ) : null}
            </section>
          )}

          {/* Give essentials */}
          {postType === "give" && (
            <section className="card">
              <div className="cardTop">
                <div className="cardTitle">Quick choices</div>
                <div className="cardHint">Helps people find it faster.</div>
              </div>

              <div className="grid2">
                <div>
                  <div className="label">Category</div>
                  <select className="select" value={giveCategory} onChange={(e) => setGiveCategory(e.target.value as GiveCategory)}>
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
                  <div className="label">Pickup spot</div>
                  <select
                    className="select"
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value as PickupLocation)}
                  >
                    <option value="College Quad">College Quad</option>
                    <option value="Safety Service Office">Safety Service Office</option>
                    <option value="Dining Hall">Dining Hall</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          {/* Request essentials */}
          {postType === "request" && (
            <section className="card">
              <div className="cardTop">
                <div className="cardTitle">Request details</div>
                <div className="cardHint">Make it easy to respond.</div>
              </div>

              <div className="grid2">
                <div>
                  <div className="label">Type</div>
                  <select className="select" value={requestGroup} onChange={(e) => setRequestGroup(e.target.value as RequestGroup)}>
                    <option value="logistics">Logistics (ride / moving / borrow)</option>
                    <option value="services">Services (tutoring / tech help / haircut)</option>
                    <option value="urgent">Urgent (charger / calculator / meds)</option>
                    <option value="collaboration">Collaboration (club / hackathon / project)</option>
                  </select>
                </div>

                <div>
                  <div className="label">Timeframe</div>
                  <select
                    className="select"
                    value={requestTimeframe}
                    onChange={(e) => setRequestTimeframe(e.target.value as RequestTimeframe)}
                  >
                    <option value="today">Today</option>
                    <option value="this_week">This week</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="label">Location (optional)</div>
                <input
                  className="input"
                  value={requestLocation}
                  onChange={(e) => setRequestLocation(e.target.value)}
                  placeholder='Example: "Dorm A" or "Near dining hall"'
                />
              </div>
            </section>
          )}

          {/* Options (same sheet vibe as your filters) */}
          {showOptions && (
            <section className="sheetCard">
              <div className="sheetTop">
                <div className="sheetTitle">More options</div>
                <button className="sheetClose" type="button" onClick={() => setShowOptions(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="sheetGrid">
                <div className="sheetBlock">
                  <div className="sheetLabel">Anonymous</div>
                  <div className="togRow">
                    <button
                      type="button"
                      className={`tog ${hideName ? "togOn" : ""}`}
                      onClick={() => setHideName((v) => !v)}
                    >
                      {hideName ? "Hidden: ON" : "Hidden: OFF"}
                    </button>
                  </div>
                  <div className="sheetHint">When ON, your name won’t show on the feed.</div>
                </div>

                <div className="sheetBlock">
                  <div className="sheetLabel">Auto close</div>
                  <select className="select" value={expireChoice} onChange={(e) => setExpireChoice(e.target.value as ExpireChoice)}>
                    {postType === "request" ? <option value="urgent24">Urgent (24 hours)</option> : null}
                    <option value="7">7 days</option>
                    <option value="14">14 days</option>
                    <option value="30">30 days</option>
                    <option value="never">Until I cancel</option>
                  </select>
                  {postType === "request" && expireChoice === "urgent24" ? (
                    <div className="sheetHint">Urgent requests expire in 24 hours unless you repost.</div>
                  ) : null}
                </div>
              </div>
            </section>
          )}

          <div style={{ height: 12 }} />
        </form>
      </main>

      {/* Sticky submit (matches your “app has bottom nav”) */}
      <div className="sticky">
        <div className="stickyInner">
          <div className="stickyHint">{stickyHint}</div>
          <button
            className={`stickyBtn ${saving || !canSubmit ? "stickyDisabled" : ""}`}
            onClick={() => formRef.current?.requestSubmit()}
            disabled={saving || !canSubmit}
            type="button"
          >
            {saving ? "Posting…" : postType === "give" ? "Post item" : "Post request"}
          </button>
        </div>
      </div>

      <style jsx>{baseStyles}</style>
    </div>
  );
}

/* ====== Shared styles: aligned with your Feed look ====== */
const baseStyles = `
.page{
  min-height:100vh;
  background:#000;
  color:#fff;
}

/* TOPBAR */
.topbar{
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(148,163,184,0.12);
}
.row{ padding:10px 12px; }

.brandRow{
  display:grid;
  grid-template-columns: 44px 1fr 44px;
  align-items:center;
  gap:10px;
  padding-top:12px;
  padding-bottom:8px;
}
.logoBtn{
  width:44px; height:44px;
  border-radius:16px;
  overflow:hidden;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  display:grid;
  place-items:center;
  padding:0;
  cursor:pointer;
  box-shadow:0 10px 26px rgba(0,0,0,0.45);
}
.logoImg{ width:100%; height:100%; object-fit:contain; padding:6px; }
.brandCenter{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  min-width:0;
}
.brandName{
  font-size:22px;
  font-weight:800;
  letter-spacing:-0.6px;
  white-space:nowrap;
  text-shadow:0 10px 30px rgba(0,0,0,0.65);
}
.brandMark{ opacity:0.9; transform:translateY(1px); }

.plusBtn{
  width:44px; height:44px;
  border-radius:16px;
  border: 1px solid rgba(52,211,153,0.35);
  background: radial-gradient(circle at 30% 30%, rgba(16,185,129,0.28), rgba(16,185,129,0.12));
  color:#fff;
  font-size:18px;
  font-weight:900;
  display:grid;
  place-items:center;
  cursor:pointer;
  box-shadow:0 12px 30px rgba(0,0,0,0.55);
  transition: transform .12s ease;
}
.plusBtn:active{ transform:scale(0.98); }

.tabsRow{
  display:grid;
  grid-template-columns: 1fr 46px;
  gap:10px;
  align-items:center;
  padding-top:6px;
  padding-bottom:6px;
}
.seg{
  position:relative;
  height:44px;
  border-radius:999px;
  border:1px solid rgba(148,163,184,0.18);
  background:rgba(255,255,255,0.04);
  display:grid;
  grid-template-columns:1fr 1fr;
  overflow:hidden;
}
.segBtn{
  border:none;
  background:transparent;
  color: rgba(255,255,255,0.72);
  font-weight:950;
  cursor:pointer;
  z-index:2;
  transition: color .18s ease;
}
.segBtn.active{ color: rgba(209,250,229,0.98); }
.segIndicator{
  position:absolute;
  top:3px; bottom:3px;
  width: calc(50% - 6px);
  border-radius:999px;
  background: rgba(16,185,129,0.14);
  border: 1px solid rgba(52,211,153,0.35);
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  transition: transform .22s ease;
  z-index:1;
}
.segIndicator.left{ transform: translateX(3px); }
.segIndicator.right{ transform: translateX(calc(100% + 3px)); }

.ctrlBtn{
  width:46px; height:44px;
  border-radius:16px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(255,255,255,0.04);
  color:#fff;
  cursor:pointer;
  display:grid;
  place-items:center;
  box-shadow:0 12px 30px rgba(0,0,0,0.35);
  transition: transform .12s ease, border-color .18s ease, background .18s ease;
}
.ctrlBtn:active{ transform: scale(0.98); }
.ctrlActive{ border-color: rgba(52,211,153,0.45); background: rgba(16,185,129,0.12); }
.ctrlIcon{ font-size:18px; font-weight:900; opacity:0.92; }

.sublineRow{ padding-top: 6px; padding-bottom: 10px; }
.subTitle{
  font-size:13px;
  font-weight:950;
  opacity:0.92;
}
.muted{ opacity:0.6; font-weight:900; }
.errRow{
  color:#f87171;
  font-weight:900;
  padding-top: 0;
}

/* MAIN */
.main{ padding: 14px 12px 120px; }
.stack{ display:flex; flex-direction:column; gap:14px; }

.card{
  background: rgba(255,255,255,0.04);
  border-radius:18px;
  border: 1px solid rgba(148,163,184,0.15);
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  padding:14px;
}
.cardTop{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.cardTitle{ font-weight:950; letter-spacing:-0.2px; }
.cardHint{ font-size:12px; opacity:0.7; font-weight:900; }
.req{ color: rgba(209,250,229,0.92); font-weight:950; }

.input, .textarea, .select{
  width:100%;
  margin-top:10px;
  border-radius:14px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(0,0,0,0.22);
  color:#fff;
  padding:12px 12px;
  font-weight:900;
  outline:none;
}
.textarea{ line-height:1.35; resize: vertical; }
.input::placeholder, .textarea::placeholder{ color: rgba(255,255,255,0.45); font-weight:900; }

.grid2{
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap:10px;
  margin-top:10px;
}
@media (max-width: 420px){
  .grid2{ grid-template-columns: 1fr; }
}
.label{
  font-size:12px;
  opacity:0.72;
  font-weight:950;
  margin-bottom:6px;
}

/* DROP */
.drop{
  margin-top:10px;
  border-radius:18px;
  border: 1.5px dashed rgba(148,163,184,0.25);
  background: rgba(0,0,0,0.22);
  padding:12px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  transition: border-color .16s ease, background .16s ease;
}
.dropOn{
  border-color: rgba(52,211,153,0.55);
  background: rgba(16,185,129,0.10);
}
.dropHas{
  border-style: solid;
  border-color: rgba(52,211,153,0.28);
}
.dropLeft{ display:flex; align-items:center; gap:12px; min-width:0; }
.dropIcon{
  width:42px; height:42px;
  border-radius:14px;
  display:grid;
  place-items:center;
  background: rgba(16,185,129,0.14);
  border: 1px solid rgba(52,211,153,0.25);
  font-weight:950;
}
.dropTitle{ font-weight:950; }
.dropSub{ font-size:12px; opacity:0.7; font-weight:900; }
.dropBtns{ display:flex; gap:10px; flex:0 0 auto; }

.btn{
  border-radius:14px;
  padding:10px 12px;
  font-weight:950;
  cursor:pointer;
  border:1px solid rgba(148,163,184,0.25);
}
.ghost{
  background: rgba(255,255,255,0.03);
  color: rgba(255,255,255,0.86);
}
.danger{
  background: rgba(0,0,0,0.22);
  border:1px solid rgba(254,202,202,0.35);
  color:#fecaca;
}

.previewWrap{ margin-top:12px; }
.previewImg{
  width:100%;
  height:260px;
  object-fit:cover;
  border-radius:18px;
  border:1px solid rgba(148,163,184,0.18);
  box-shadow:0 16px 40px rgba(0,0,0,0.45);
  display:block;
}

/* OPTIONS SHEET CARD */
.sheetCard{
  border-radius:18px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(10,10,10,0.92);
  box-shadow:0 30px 80px rgba(0,0,0,0.65);
  overflow:hidden;
}
.sheetTop{
  padding:12px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  border-bottom:1px solid rgba(148,163,184,0.14);
}
.sheetTitle{ font-weight:950; font-size:14px; opacity:0.9; }
.sheetClose{
  width:38px; height:38px;
  border-radius:14px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(255,255,255,0.04);
  color:#fff;
  cursor:pointer;
  font-weight:950;
}
.sheetGrid{ padding:12px; display:grid; gap:12px; }
.sheetBlock{
  border:1px solid rgba(148,163,184,0.12);
  background: rgba(255,255,255,0.03);
  border-radius:16px;
  padding:12px;
}
.sheetLabel{ font-size:12px; font-weight:950; opacity:0.72; margin-bottom:10px; }
.sheetHint{ font-size:12px; opacity:0.7; font-weight:900; margin-top:8px; }
.togRow{ display:flex; gap:10px; flex-wrap:wrap; }
.tog{
  border-radius:999px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(0,0,0,0.22);
  color: rgba(255,255,255,0.84);
  padding:10px 12px;
  font-weight:950;
  cursor:pointer;
}
.togOn{
  border-color: rgba(52,211,153,0.45);
  background: rgba(16,185,129,0.14);
  color: rgba(209,250,229,0.95);
}

/* STICKY */
.sticky{
  position:fixed;
  left:0; right:0;
  bottom:${NAV_APPROX_HEIGHT}px;
  height:${STICKY_BAR_HEIGHT}px;
  background: rgba(0,0,0,0.92);
  border-top: 1px solid rgba(148,163,184,0.14);
  backdrop-filter: blur(14px);
  z-index: 50;
  display:flex;
  align-items:center;
  justify-content:center;
  padding: 10px 12px;
}
.stickyInner{
  width:min(860px, 100%);
  display:flex;
  align-items:center;
  gap:12px;
}
.stickyHint{
  flex:1;
  font-size:12px;
  opacity:0.72;
  font-weight:950;
}
.stickyBtn{
  min-width:160px;
  height:44px;
  border-radius:14px;
  border: 1px solid rgba(52,211,153,0.25);
  background: rgba(16,185,129,0.22);
  color:#fff;
  font-weight:950;
  cursor:pointer;
}
.stickyDisabled{
  opacity:0.55;
  cursor:not-allowed;
  border:1px solid rgba(148,163,184,0.20);
  background: rgba(255,255,255,0.03);
}

/* GATES */
.gate{
  min-height:100vh;
  display:flex;
  align-items:flex-start;
  justify-content:center;
  padding:24px 12px;
}
.gateCard{
  width:min(720px, 100%);
  border-radius:18px;
  border:1px solid rgba(148,163,184,0.18);
  background: rgba(255,255,255,0.04);
  box-shadow:0 12px 40px rgba(0,0,0,0.55);
  padding:16px;
}
.gateTitle{ font-size:18px; font-weight:950; }
.gateHint{ margin-top:8px; font-size:13px; opacity:0.75; font-weight:900; line-height:1.35; }
.gateErr{
  margin-top:12px;
  padding:10px 12px;
  border-radius:14px;
  border:1px solid rgba(254,202,202,0.35);
  background: rgba(244,63,94,0.10);
  color:#fecaca;
  font-weight:900;
}
.gateBtn{
  margin-top:14px;
  height:44px;
  border-radius:14px;
  border: 1px solid rgba(52,211,153,0.25);
  background: rgba(16,185,129,0.22);
  color:#fff;
  font-weight:950;
  cursor:pointer;
  padding:0 14px;
}
`;