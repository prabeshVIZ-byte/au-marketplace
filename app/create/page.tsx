"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "student" | "faculty" | "";
type StatusType = "error" | "success" | "info";
type UiStatus = { text: string; type: StatusType } | null;

type AcceptedInterest = {
  id: string;
  item_id: string;
  status: string;
  accepted_expires_at: string | null;
};

function formatTimeLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  const now = Date.now();
  const ms = end - now;
  if (ms <= 0) return "Expired";

  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

  // accepted (buyer selection)
  const [accepted, setAccepted] = useState<AcceptedInterest | null>(null);
  const [confirming, setConfirming] = useState(false);

  // status
  const [status, setStatus] = useState<UiStatus>(null);

  const draftComplete = useMemo(() => {
    return fullName.trim().length > 0 && (role === "student" || role === "faculty");
  }, [fullName, role]);

  const timeLeft = useMemo(
    () => formatTimeLeft(accepted?.accepted_expires_at ?? null),
    [accepted?.accepted_expires_at]
  );

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

    // hydrate draft inputs from DB (nice UX)
    setFullName(dbName);
    setRole(dbRole || "");

    const complete = dbName.length > 0 && (dbRole === "student" || dbRole === "faculty");
    setDbProfileComplete(complete);
  }

  async function loadAcceptedInterest(uid: string) {
    const { data, error } = await supabase
      .from("interests")
      .select("id,item_id,status,accepted_expires_at")
      .eq("user_id", uid)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .maybeSingle();

    if (error) {
      console.log("loadAcceptedInterest:", error.message);
      setAccepted(null);
      return;
    }

    if (data) {
      setAccepted({
        id: (data as any).id,
        item_id: (data as any).item_id,
        status: (data as any).status,
        accepted_expires_at: (data as any).accepted_expires_at,
      });
    } else {
      setAccepted(null);
    }
  }

  async function refreshUser() {
    const { data } = await supabase.auth.getUser();
    const e = data.user?.email ?? null;
    const uid = data.user?.id ?? null;

    setUserEmail(e);
    setUserId(uid);

    if (uid) {
      await loadProfile(uid);
      await loadAcceptedInterest(uid);
    } else {
      setFullName("");
      setRole("");
      setDbProfileComplete(false);
      setAccepted(null);
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

    const t = setInterval(() => {
      setAccepted((prev) => (prev ? { ...prev } : prev));
    }, 1000);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      clearInterval(t);
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
  }

  async function confirmPickup() {
    if (!accepted) return;

    if (timeLeft === "Expired") {
      setStatus({ text: "This selection expired. Ask the seller to select you again.", type: "error" });
      return;
    }

    setStatus(null);
    setConfirming(true);

    const { error } = await supabase.rpc("confirm_interest", {
      p_interest_id: accepted.id,
    });

    setConfirming(false);

    if (error) {
      setStatus({ text: error.message, type: "error" });
      return;
    }

    setStatus({ text: "Confirmed ✅ Item is now reserved for you.", type: "success" });
    setAccepted(null);
    router.refresh();
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
    setAccepted(null);

    router.replace("/feed");
    router.refresh();
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 120, maxWidth: 520 }}>
      <button
        type="button"
        onClick={() => router.push("/feed")}
        style={{
          marginBottom: 16,
          background: "transparent",
          color: "white",
          border: "1px solid #333",
          padding: "8px 12px",
          borderRadius: 10,
          cursor: "pointer",
        }}
      >
        ← Back to feed
      </button>

      <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>Request Access</h1>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Login is restricted to <b>@ashland.edu</b>.
      </p>

      {/* SIGNED IN */}
      {userEmail ? (
        <div style={{ marginTop: 16, border: "1px solid #0f223f", borderRadius: 14, padding: 16, background: "#0b1730" }}>
          <div style={{ fontWeight: 900 }}>Logged in as</div>
          <div style={{ opacity: 0.85, marginTop: 6 }}>{userEmail}</div>

          {/* PROFILE REQUIRED (hide only when DB says complete) */}
          {!dbProfileComplete && (
            <div style={{ marginTop: 14, border: "1px solid #334155", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>
                Complete profile (required)
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
                  borderRadius: 10,
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
                    borderRadius: 10,
                    border: "1px solid #334155",
                    background: role === "student" ? "#052e16" : "transparent",
                    color: "white",
                    fontWeight: 900,
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
                    borderRadius: 10,
                    border: "1px solid #334155",
                    background: role === "faculty" ? "#052e16" : "transparent",
                    color: "white",
                    fontWeight: 900,
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
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: profileSaving ? "#1f2937" : draftComplete ? "#16a34a" : "#14532d",
                  color: "white",
                  fontWeight: 900,
                  cursor: profileSaving ? "not-allowed" : draftComplete ? "pointer" : "not-allowed",
                  opacity: profileSaving ? 0.85 : 1,
                }}
              >
                {profileSaving ? "Saving..." : "Save profile"}
              </button>

              <div style={{ opacity: 0.7, marginTop: 10, fontSize: 12 }}>
                After saving, your name will show to sellers when you request items.
              </div>
            </div>
          )}

          {/* ACCEPTED */}
          {accepted && (
            <div style={{ marginTop: 14, border: "1px solid #14532d", borderRadius: 14, padding: 14, background: "#052e16" }}>
              <div style={{ fontWeight: 900 }}>🎉 You were selected!</div>
              <div style={{ opacity: 0.9, marginTop: 6 }}>
                Confirm within: <b>{timeLeft ?? "—"}</b>
              </div>
              <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
                Item ID: {accepted.item_id.slice(0, 8)}…
              </div>

              <button
                type="button"
                onClick={confirmPickup}
                disabled={confirming || timeLeft === "Expired"}
                style={{
                  marginTop: 10,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: confirming ? "#14532d" : "#16a34a",
                  color: "white",
                  fontWeight: 900,
                  cursor: confirming ? "not-allowed" : "pointer",
                  opacity: confirming ? 0.85 : 1,
                }}
              >
                {confirming ? "Confirming..." : "Confirm pickup"}
              </button>
            </div>
          )}

          {/* ACTIONS */}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => router.push("/create")}
              disabled={!dbProfileComplete}
              title={!dbProfileComplete ? "Complete your profile first" : "Post an item"}
              style={{
                background: !dbProfileComplete ? "#14532d" : "#16a34a",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                color: "white",
                cursor: !dbProfileComplete ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: !dbProfileComplete ? 0.6 : 1,
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
                borderRadius: 10,
                border: "1px solid #334155",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        // LOGGED OUT
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setMode("signin")}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: mode === "signin" ? "1px solid #16a34a" : "1px solid #334155",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
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
                borderRadius: 10,
                border: mode === "signup" ? "1px solid #16a34a" : "1px solid #334155",
                background: "transparent",
                color: "white",
                cursor: "pointer",
                fontWeight: 900,
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
              padding: 10,
              borderRadius: 10,
              border: "1px solid #333",
              background: "#111",
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
              padding: 10,
              borderRadius: 10,
              border: "1px solid #333",
              background: "#111",
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
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              color: "white",
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 900,
              opacity: sending ? 0.85 : 1,
            }}
          >
            {sending ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </div>
      )}

      {status && <p style={{ marginTop: 14, color: statusColor }}>{status.text}</p>}
    </div>
  );
}