// /app/me/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "student" | "faculty" | "";
type StatusType = "error" | "success" | "info";
type UiStatus = { text: string; type: StatusType } | null;

type MyRequest = {
  id: string;
  item_id: string;
  status: string | null;
  created_at: string | null;
  item_title?: string | null;
};

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 8)}…`;
}

function statusPill(status: string | null) {
  const s = (status ?? "pending").toLowerCase();
  const label =
    s === "accepted" ? "Accepted" : s === "reserved" ? "Reserved" : s === "confirmed" ? "Confirmed" : s === "rejected" ? "Rejected" : "Pending";

  const bg =
    s === "accepted" || s === "reserved" || s === "confirmed"
      ? "#052e16"
      : s === "rejected"
      ? "#3f1d1d"
      : "#0b1730";

  const border =
    s === "accepted" || s === "reserved" || s === "confirmed"
      ? "#14532d"
      : s === "rejected"
      ? "#7f1d1d"
      : "#334155";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${border}`,
        background: bg,
        color: "white",
        fontWeight: 900,
        fontSize: 12,
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export default function MePage() {
  const router = useRouter();

  // auth UI
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");

  // session
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // profile (draft inputs)
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("");

  // profile (DB truth)
  const [profileLoading, setProfileLoading] = useState(false);
  const [dbProfileComplete, setDbProfileComplete] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // requests
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [reqLoading, setReqLoading] = useState(false);

  // section toggles (clean UI)
  const [showProfile, setShowProfile] = useState(false);
  const [showRequests, setShowRequests] = useState(true);

  // status
  const [status, setStatus] = useState<UiStatus>(null);

  const draftComplete = useMemo(() => {
    return fullName.trim().length > 0 && (role === "student" || role === "faculty");
  }, [fullName, role]);

  const statusColor =
    status?.type === "error" ? "#f87171" : status?.type === "success" ? "#4ade80" : "#93c5fd";

  async function loadProfile(uid: string) {
    setProfileLoading(true);
    setDbProfileComplete(false);

    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,user_role,email")
      .eq("id", uid)
      .maybeSingle();

    setProfileLoading(false);

    if (error) {
      console.log("loadProfile:", error.message);
      setStatus({ text: `Profile load failed: ${error.message}`, type: "error" });
      return;
    }

    const dbName = (data?.full_name ?? "").trim();
    const dbRole = (data?.user_role ?? "") as Role;

    setFullName(dbName);
    setRole(dbRole || "");

    const complete = dbName.length > 0 && (dbRole === "student" || dbRole === "faculty");
    setDbProfileComplete(complete);

    // if incomplete, open profile section automatically
    if (!complete) setShowProfile(true);
  }

  async function loadMyRequests(uid: string) {
    setReqLoading(true);

    // Pull minimal info from interests; optionally join item title if you have a view later.
    const { data, error } = await supabase
      .from("interests")
      .select("id,item_id,status,created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(20);

    setReqLoading(false);

    if (error) {
      console.log("loadMyRequests:", error.message);
      setRequests([]);
      return;
    }

    setRequests(((data as any[]) || []).map((r) => ({ ...r })));
  }

  async function refreshUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) console.log("getUser:", error.message);

    const e = data.user?.email ?? null;
    const uid = data.user?.id ?? null;

    setUserEmail(e);
    setUserId(uid);

    if (uid) {
      await loadProfile(uid);
      await loadMyRequests(uid);
    } else {
      setFullName("");
      setRole("");
      setDbProfileComplete(false);
      setRequests([]);
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      await refreshUser();
      if (!alive) return;
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refreshUser();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleAuth() {
    setStatus(null);

    const e = emailInput.trim().toLowerCase();
    if (!e.endsWith("@ashland.edu")) {
      setStatus({ text: "Use your @ashland.edu email.", type: "error" });
      return;
    }
    if (password.length < 8) {
      setStatus({ text: "Password must be at least 8 characters.", type: "error" });
      return;
    }

    setSending(true);

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email: e, password });
      setSending(false);

      if (error) {
        setStatus({ text: error.message, type: "error" });
        return;
      }

      setStatus({ text: "Account created ✅ Now switch to Sign in.", type: "success" });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    setSending(false);

    if (error) {
      setStatus({ text: error.message, type: "error" });
      return;
    }

    setStatus({ text: "Signed in ✅", type: "success" });
    router.refresh();
  }

  async function saveProfile() {
    setStatus(null);

    if (!draftComplete) {
      setStatus({ text: "Enter full name and choose Student/Faculty.", type: "error" });
      return;
    }

    const { data: sess, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      setStatus({ text: sessErr.message, type: "error" });
      return;
    }

    const uid = sess.session?.user?.id;
    const email = sess.session?.user?.email;

    if (!uid) {
      setStatus({ text: "No session found. Please sign in again.", type: "error" });
      return;
    }

    setProfileSaving(true);

    const { error } = await supabase
      .from("profiles")
      .upsert([{ id: uid, email: email ?? null, full_name: fullName.trim(), user_role: role }], {
        onConflict: "id",
      });

    setProfileSaving(false);

    if (error) {
      setStatus({ text: `Profile save failed: ${error.message}`, type: "error" });
      return;
    }

    await loadProfile(uid);
    setStatus({ text: "Profile saved ✅", type: "success" });
    setShowProfile(false);
  }

  async function signOut() {
    setStatus(null);

    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus({ text: error.message, type: "error" });
      return;
    }

    setUserEmail(null);
    setUserId(null);
    setEmailInput("");
    setPassword("");
    setFullName("");
    setRole("");
    setDbProfileComplete(false);
    setRequests([]);

    router.replace("/feed");
    router.refresh();
  }

  const canPost = !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu") && dbProfileComplete;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Loading…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        padding: 24,
        paddingBottom: 120,
        maxWidth: 920,
        margin: "0 auto",
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/feed")}
        style={{
          marginBottom: 16,
          background: "transparent",
          color: "white",
          border: "1px solid #334155",
          padding: "8px 12px",
          borderRadius: 12,
          cursor: "pointer",
          fontWeight: 900,
        }}
      >
        ← Back to feed
      </button>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 950, margin: 0 }}>Account</h1>
          <p style={{ opacity: 0.75, marginTop: 8, marginBottom: 0 }}>
            {userEmail ? (
              <>
                Logged in as <b>{userEmail}</b>
              </>
            ) : (
              <>
                Login is restricted to <b>@ashland.edu</b>.
              </>
            )}
          </p>
        </div>

        {/* Primary actions (minimal) */}
        {userEmail ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => router.push("/create")}
              disabled={!canPost}
              title={!canPost ? "Complete your profile first" : "Post an item"}
              style={{
                background: !canPost ? "#14532d" : "#16a34a",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #14532d",
                color: "white",
                cursor: !canPost ? "not-allowed" : "pointer",
                fontWeight: 950,
                opacity: !canPost ? 0.55 : 1,
              }}
            >
              Post an item
            </button>

            <button
              type="button"
              onClick={signOut}
              style={{
                background: "transparent",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #334155",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>

      {/* Logged out: keep clean */}
      {!userEmail ? (
        <div style={{ marginTop: 18, maxWidth: 520, border: "1px solid #0f223f", borderRadius: 16, padding: 16, background: "#0b1730" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setMode("signin")}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: mode === "signin" ? "1px solid #16a34a" : "1px solid #334155",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 950,
              }}
            >
              Sign in
            </button>

            <button
              type="button"
              onClick={() => setMode("signup")}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: mode === "signup" ? "1px solid #16a34a" : "1px solid #334155",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 950,
              }}
            >
              Sign up
            </button>
          </div>

          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@ashland.edu"
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #334155",
              background: "black",
              color: "white",
              marginBottom: 10,
            }}
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            type="password"
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #334155",
              background: "black",
              color: "white",
            }}
          />

          <button
            type="button"
            onClick={handleAuth}
            disabled={sending}
            style={{
              marginTop: 12,
              width: "100%",
              background: sending ? "#14532d" : "#16a34a",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #14532d",
              color: "white",
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 950,
              opacity: sending ? 0.85 : 1,
            }}
          >
            {sending ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          {status && <p style={{ marginTop: 14, color: statusColor }}>{status.text}</p>}
        </div>
      ) : (
        // Logged in: clean 2-column layout
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Left: Profile card */}
          <div style={{ border: "1px solid #0f223f", borderRadius: 16, background: "#0b1730", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Profile</div>

              <button
                type="button"
                onClick={() => setShowProfile((v) => !v)}
                style={{
                  background: "transparent",
                  border: "1px solid #334155",
                  color: "white",
                  padding: "8px 10px",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                {showProfile ? "Hide" : "Edit"}
              </button>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #334155",
                  background: "#020617",
                  fontWeight: 900,
                  fontSize: 12,
                  opacity: 0.95,
                }}
              >
                Name: {fullName.trim().length ? fullName.trim() : "Not set"}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #334155",
                  background: "#020617",
                  fontWeight: 900,
                  fontSize: 12,
                  opacity: 0.95,
                }}
              >
                Role: {role ? role : "Not set"}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${dbProfileComplete ? "#14532d" : "#7f1d1d"}`,
                  background: dbProfileComplete ? "#052e16" : "#3f1d1d",
                  fontWeight: 950,
                  fontSize: 12,
                }}
              >
                {dbProfileComplete ? "Complete" : "Incomplete"}
              </span>
            </div>

            {showProfile && (
              <div style={{ marginTop: 14, borderTop: "1px solid #0f223f", paddingTop: 14 }}>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>
                  Update profile{" "}
                  {profileLoading && <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}>loading…</span>}
                </div>

                <label style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>Full name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g., Tom Sudow"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #334155",
                    background: "black",
                    color: "white",
                    marginBottom: 12,
                  }}
                />

                <label style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>You are</label>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() => setRole("student")}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #334155",
                      background: role === "student" ? "#052e16" : "transparent",
                      color: "white",
                      fontWeight: 950,
                      cursor: "pointer",
                    }}
                  >
                    Student
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole("faculty")}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #334155",
                      background: role === "faculty" ? "#052e16" : "transparent",
                      color: "white",
                      fontWeight: 950,
                      cursor: "pointer",
                    }}
                  >
                    Faculty
                  </button>
                </div>

                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileSaving || !draftComplete}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #14532d",
                    background: profileSaving ? "#1f2937" : draftComplete ? "#16a34a" : "#14532d",
                    color: "white",
                    fontWeight: 950,
                    cursor: profileSaving ? "not-allowed" : draftComplete ? "pointer" : "not-allowed",
                    opacity: profileSaving ? 0.85 : 1,
                  }}
                >
                  {profileSaving ? "Saving..." : "Save"}
                </button>
              </div>
            )}

            {status && <p style={{ marginTop: 12, color: statusColor }}>{status.text}</p>}
          </div>

          {/* Right: My requests */}
          <div style={{ border: "1px solid #0f223f", borderRadius: 16, background: "#0b1730", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>My requests</div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowRequests((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "1px solid #334155",
                    color: "white",
                    padding: "8px 10px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  {showRequests ? "Collapse" : "Expand"}
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (!userId) return;
                    await loadMyRequests(userId);
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid #334155",
                    color: "white",
                    padding: "8px 10px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>

            <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
              If a seller accepts you, it will show here.
            </div>

            {showRequests && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {reqLoading ? (
                  <div style={{ opacity: 0.8 }}>Loading…</div>
                ) : requests.length === 0 ? (
                  <div style={{ opacity: 0.8 }}>No requests yet.</div>
                ) : (
                  requests.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        border: "1px solid #334155",
                        borderRadius: 14,
                        padding: 12,
                        background: "#020617",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 950, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          Item: {shortId(r.item_id)}
                        </div>
                        <button
                          type="button"
                          onClick={() => router.push(`/item/${r.item_id}`)}
                          style={{
                            marginTop: 8,
                            background: "transparent",
                            border: "1px solid #334155",
                            color: "white",
                            padding: "8px 10px",
                            borderRadius: 12,
                            cursor: "pointer",
                            fontWeight: 900,
                          }}
                        >
                          View item
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        {statusPill(r.status)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}