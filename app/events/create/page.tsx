"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EventCategory = "club" | "sports" | "party" | "other";

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

function uuidSafe() {
  // @ts-ignore
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Convert <input type="datetime-local"> value to ISO string.
 * datetime-local gives "YYYY-MM-DDTHH:mm" (no timezone).
 * We treat it as user's local time and convert to ISO with timezone offset.
 */
function localDateTimeToISO(v: string) {
  // new Date("2026-03-04T16:30") parses as local time in browsers
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export default function EventCreatePage() {
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

  // form fields
  const [title, setTitle] = useState("");
  const [hostOrg, setHostOrg] = useState("");
  const [category, setCategory] = useState<EventCategory>("club");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const [startsLocal, setStartsLocal] = useState(""); // datetime-local string
  const [endsLocal, setEndsLocal] = useState(""); // optional

  const [hideName, setHideName] = useState(false);

  // optional flyer upload
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // submit
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isAllowed = useMemo(() => {
    return !!email && email.toLowerCase().endsWith("@ashland.edu");
  }, [email]);

  const cleanTitle = useMemo(() => title.trim(), [title]);
  const cleanHost = useMemo(() => hostOrg.trim(), [hostOrg]);
  const cleanLoc = useMemo(() => location.trim(), [location]);
  const cleanDesc = useMemo(() => description.trim(), [description]);
  const cleanLink = useMemo(() => linkUrl.trim(), [linkUrl]);

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

  function handleFilePicked(f: File | null) {
    setMsg(null);

    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_PHOTO_MB * 1024 * 1024) {
      setFile(null);
      setMsg(`Flyer too large (max ${MAX_PHOTO_MB}MB).`);
      return;
    }
    if (!isAllowedImage(f)) {
      setFile(null);
      setMsg("Upload JPG, PNG, or WEBP (HEIC not supported yet).");
      return;
    }
    setFile(f);
  }

  function validate(): string | null {
    if (!isAllowed || !userId) return "Log in with your @ashland.edu email to post events.";
    if (!profileComplete) return "Complete your profile first (name + student/faculty).";

    if (cleanTitle.length < 3) return "Title must be at least 3 characters.";
    if (cleanHost.length < 2) return "Host Club/Organisation is required.";
    if (cleanLoc.length < 2) return "Location is required.";
    if (cleanDesc.length < 5) return "Description is required (keep it short, but clear).";
    if (!startsLocal) return "Start time is required.";

    const startsISO = localDateTimeToISO(startsLocal);
    if (!startsISO) return "Start time looks invalid.";

    if (endsLocal) {
      const endsISO = localDateTimeToISO(endsLocal);
      if (!endsISO) return "End time looks invalid.";
      if (new Date(endsISO).getTime() <= new Date(startsISO).getTime()) return "End time must be after start time.";
    }

    if (file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `Flyer too large (max ${MAX_PHOTO_MB}MB).`;
      if (!isAllowedImage(file)) return "Upload JPG, PNG, or WEBP (HEIC not supported yet).";
    }

    // optional link: basic sanity
    if (cleanLink) {
      const ok = /^https?:\/\/.+/i.test(cleanLink);
      if (!ok) return "Link must start with http:// or https://";
    }

    return null;
  }

  const canSubmit = useMemo(() => {
    if (!isAllowed || !userId) return false;
    if (!profileComplete) return false;

    if (cleanTitle.length < 3) return false;
    if (cleanHost.length < 2) return false;
    if (cleanLoc.length < 2) return false;
    if (cleanDesc.length < 5) return false;
    if (!startsLocal) return false;

    const startsISO = localDateTimeToISO(startsLocal);
    if (!startsISO) return false;

    if (endsLocal) {
      const endsISO = localDateTimeToISO(endsLocal);
      if (!endsISO) return false;
      if (new Date(endsISO).getTime() <= new Date(startsISO).getTime()) return false;
    }

    if (file) {
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return false;
      if (!isAllowedImage(file)) return false;
    }

    if (cleanLink && !/^https?:\/\/.+/i.test(cleanLink)) return false;

    return true;
  }, [isAllowed, userId, profileComplete, cleanTitle, cleanHost, cleanLoc, cleanDesc, startsLocal, endsLocal, file, cleanLink]);

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
      const starts_at = localDateTimeToISO(startsLocal)!;
      const ends_at = endsLocal ? localDateTimeToISO(endsLocal) : null;

      const insertRow: any = {
        created_by: userId,
        title: cleanTitle,
        host_org: cleanHost,
        category,
        location: cleanLoc,
        description: cleanDesc,
        starts_at,
        ends_at,
        link_url: cleanLink ? cleanLink : null,
        photo_url: null,
        is_anonymous: hideName,
        is_cancelled: false,
      };

      const { data: created, error: createErr } = await supabase.from("events").insert([insertRow]).select("id").single();
      if (createErr || !created?.id) throw new Error(createErr?.message || "Failed to create event.");

      const eventId = created.id as string;

      // Optional flyer upload
      if (!file) {
        router.push("/events");
        router.refresh();
        return;
      }

      const ext = getExt(file.name);
      const path = `events/${userId}/${eventId}/${uuidSafe()}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("event-photos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

      if (uploadErr) {
        setMsg(`Event posted, but flyer upload failed: ${uploadErr.message}`);
        router.push("/events");
        router.refresh();
        return;
      }

      const { data: pub } = supabase.storage.from("event-photos").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updateErr } = await supabase.from("events").update({ photo_url: publicUrl }).eq("id", eventId);
      if (updateErr) {
        setMsg(`Flyer uploaded, but photo_url update failed: ${updateErr.message}`);
        router.push("/events");
        router.refresh();
        return;
      }

      router.push("/events");
      router.refresh();
    } catch (err: any) {
      setMsg(err?.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  // ---------- UI ----------
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
        minWidth: 180,
        fontWeight: 950,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        color: "white",
        background: disabled ? "#94a3b8" : "#10b981",
        boxShadow: disabled ? "none" : "0 14px 30px rgba(16,185,129,0.25)",
        transition: "transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease",
      }) as React.CSSProperties,
  };

  const stickyHint = !startsLocal
    ? "Pick a start time."
    : !cleanTitle || cleanTitle.length < 3
    ? "Add a clear title (3+ chars)."
    : !cleanHost
    ? "Add a Host Club/Organisation."
    : !cleanLoc
    ? "Add the location."
    : !cleanDesc || cleanDesc.length < 5
    ? "Add a short description."
    : "Ready to post.";

  // ---------- STATES ----------
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
              <h1 style={{ fontSize: 24, fontWeight: 950, margin: 0 }}>Post an Event</h1>
              <p style={{ color: "#4b5563", marginTop: 8, marginBottom: 0 }}>
                You must log in with your <b>@ashland.edu</b> email to post events.
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

  // ---------- MAIN ----------
  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.topRow}>
          <button onClick={() => router.push("/events")} style={ui.backBtn}>
            <span aria-hidden>←</span> Back
          </button>
          <div style={ui.pill}>
            Posting as <b>{email}</b>
          </div>
        </div>

        <div style={ui.hero}>
          <div style={ui.glow} />
          <div style={{ position: "relative" }}>
            <h1 style={ui.h1}>Create an event</h1>
            <p style={ui.sub}>Clear title + time + location. Add a flyer if you have one.</p>
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} style={ui.convo}>
          {/* Title + Host */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>Event Board</div>
              <div style={{ fontWeight: 950 }}>What’s the event?</div>

              <div style={{ marginTop: 10, ...ui.grid2 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Title *</div>
                  <input
                    type="text"
                    placeholder='Example: "Finance Club Guest Speaker"'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={ui.input}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>
                    Host Club/Organisation *
                  </div>
                  <input
                    type="text"
                    placeholder='Example: "Finance Club"'
                    value={hostOrg}
                    onChange={(e) => setHostOrg(e.target.value)}
                    style={ui.input}
                  />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Category *</div>
                <select value={category} onChange={(e) => setCategory(e.target.value as EventCategory)} style={ui.select}>
                  <option value="club">Club</option>
                  <option value="sports">Sports</option>
                  <option value="party">Party</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Time + Location */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>Event Board</div>
              <div style={{ fontWeight: 950 }}>When and where?</div>

              <div style={{ marginTop: 10, ...ui.grid2 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Start *</div>
                  <input type="datetime-local" value={startsLocal} onChange={(e) => setStartsLocal(e.target.value)} style={ui.input} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>End (optional)</div>
                  <input type="datetime-local" value={endsLocal} onChange={(e) => setEndsLocal(e.target.value)} style={ui.input} />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Location *</div>
                <input
                  type="text"
                  placeholder='Example: "Dauch Hall 102" or "Quad"'
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  style={ui.input}
                />
              </div>
            </div>
          </div>

          {/* Description + Link */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>Event Board</div>
              <div style={{ fontWeight: 950 }}>Details</div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Description *</div>
                <textarea
                  placeholder="Keep it short: what is it, who is it for, any cost, any notes."
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={ui.textarea}
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "#6b7280", marginBottom: 6 }}>Link (optional)</div>
                <input
                  type="url"
                  placeholder='https://instagram.com/p/...'
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  style={ui.input}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Must start with http:// or https://</div>
              </div>
            </div>
          </div>

          {/* Optional flyer upload */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>Event Board</div>
              <div style={{ fontWeight: 950 }}>Flyer photo (optional)</div>

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
                  if (dropped) handleFilePicked(dropped);
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
                        {previewUrl ? "Flyer attached" : dragOver ? "Drop it here" : "Drag & drop a flyer"}
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
                      onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
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

          {/* Options */}
          <div style={ui.row("left")}>
            <div style={ui.bubble("left")}>
              <div style={ui.mini}>Event Board</div>
              <div style={{ fontWeight: 950 }}>Privacy</div>

              <div style={{ marginTop: 10 }}>
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
                  {hideName ? "Hide my name: ON" : "Hide my name: OFF"}
                </button>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  When ON, the event will show the Host Club/Organisation, but not your personal name.
                </div>
              </div>
            </div>
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
            {saving ? "Posting…" : "Post event"}
          </button>
        </div>
      </div>
    </div>
  );
}