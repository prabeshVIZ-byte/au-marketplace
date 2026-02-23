"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "student" | "faculty" | "";

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

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // profile
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // buyer selection
  const [accepted, setAccepted] = useState<AcceptedInterest | null>(null);
  const [confirming, setConfirming] = useState(false);

  const profileComplete =
    fullName.trim().length > 0 && (role === "student" || role === "faculty");

  const timeLeft = useMemo(
    () => formatTimeLeft(accepted?.accepted_expires_at ?? null),
    [accepted?.accepted_expires_at]
  );

  async function loadProfile(uid: string) {
    setProfileLoading(true);
    setProfileSaved(false);

    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,user_role")
      .eq("id", uid)
      .maybeSingle();

    setProfileLoading(false);

    if (error) {
      console.log("loadProfile:", error.message);
      return;
    }

    setFullName((data?.full_name ?? "") as string);
    setRole(((data?.user_role ?? "") as Role) || "");
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
      setProfileSaved(false);
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

    const e = email.trim().toLowerCase();
    if (!e.endsWith("@ashland.edu")) {
      setStatus("Use your @ashland.edu email.");
      return;
    }

    if (password.length < 8) {
      setStatus("Password must be at least 8 characters.");
      return;
    }

    setSending(true);

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email: e, password });
      setSending(false);

      if (error) {
        setStatus(error.message);
        return;
      }

      setStatus("Account created ✅ Now switch to Sign in.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: e,
      password,
    });

    setSending(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("Signed in ✅");
    router.refresh();
  }

  async function saveProfile() {
    setStatus(null);
    setProfileSaved(false);

    const name = fullName.trim();
    if (!name) {
      setStatus("Please enter your full name.");
      return;
    }
    if (role !== "student" && role !== "faculty") {
      setStatus("Please choose Student or Faculty.");
      return;
    }

    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) {
      setStatus("No session found. Please sign in again.");
      return;
    }

    setProfileLoading(true);

    const { error } = await supabase.from("profiles").upsert(
      [
        {
          id: uid,
          full_name: name,
          user_role: role,
        },
      ],
      { onConflict: "id" }
    );

    setProfileLoading(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    // ✅ important: reload from DB so UI doesn't "forget"
    await loadProfile(uid);

    setProfileSaved(true);
    setStatus("Profile saved ✅");
  }

  async function confirmPickup() {
    if (!accepted) return;

    if (timeLeft === "Expired") {
      setStatus("This selection expired. Ask the seller to select you again.");
      return;
    }

    setStatus(null);
    setConfirming(true);

    const { error } = await supabase.rpc("confirm_interest", {
      p_interest_id: accepted.id,
    });

    setConfirming(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("Confirmed ✅ Item is now reserved for you.");
    setAccepted(null);
    router.refresh();
  }

  async function signOut() {
    setStatus(null);

    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus(error.message);
      return;
    }

    setUserEmail(null);
    setUserId(null);
    setEmail("");
    setPassword("");
    setFullName("");
    setRole("");
    setProfileSaved(false);
    setAccepted(null);
    setStatus("Signed out.");

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
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, maxWidth: 520 }}>
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

      {userEmail ? (
        <div style={{ marginTop: 16, border: "1px solid #0f223f", borderRadius: 14, padding: 16, background: "#0b1730" }}>
          <div style={{ fontWeight: 900 }}>Logged in as</div>
          <div style={{ opacity: 0.85, marginTop: 6 }}>{userEmail}</div>

          {accepted && (
            <div
              style={{
                marginTop: 14,
                border: "1px solid #14532d",
                borderRadius: 14,
                padding: 14,
                background: "#052e16",
              }}
            >
              <div style={{ fontWeight: 900 }}>🎉 You were selected!</div>
              <div style={{ opacity: 0.9, marginTop: 6 }}>
                Confirm within: <b>{timeLeft ?? "—"}</b>
              </div>
              <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
                Item ID: {accepted.item_id.slice(0, 8)}…
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  confirmPickup();
                }}
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

          {!profileComplete && (
            <div style={{ marginTop: 14, border: "1px solid #334155", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Complete profile (required)</div>

              <label style={{ display: "block", marginBottom: 6, opacity: 0.9 }}>Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., Prabesh Sunar"
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
                  onClick={(e) => {
                    e.preventDefault();
                    setRole("student");
                  }}
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
                  onClick={(e) => {
                    e.preventDefault();
                    setRole("faculty");
                  }}
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
                onClick={(e) => {
                  e.preventDefault();
                  saveProfile();
                }}
                disabled={profileLoading}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: profileLoading ? "#1f2937" : "#16a34a",
                  color: "white",
                  fontWeight: 900,
                  cursor: profileLoading ? "not-allowed" : "pointer",
                  opacity: profileLoading ? 0.85 : 1,
                }}
              >
                {profileLoading ? "Saving..." : "Save profile"}
              </button>

              {profileSaved && <div style={{ marginTop: 10, opacity: 0.85 }}>Saved ✅</div>}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => router.push("/create")}
              disabled={!profileComplete}
              title={!profileComplete ? "Complete your profile first" : "Post an item"}
              style={{
                background: !profileComplete ? "#14532d" : "#16a34a",
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                color: "white",
                cursor: !profileComplete ? "not-allowed" : "pointer",
                fontWeight: 900,
                opacity: !profileComplete ? 0.6 : 1,
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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

      {status && <p style={{ marginTop: 14, color: "#f87171" }}>{status}</p>}
    </div>
  );
}