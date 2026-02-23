"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  owner_id: string;
  reserved_interest_id: string | null;
};

type InterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: "pending" | "accepted" | "reserved" | "declined" | "expired" | "completed" | string;
  earliest_pickup: string | null;
  time_window: string | null;
  note: string | null;
  created_at: string;
  accepted_at: string | null;
  accepted_expires_at: string | null;
  reserved_at: string | null;
  completed_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null; // if you don't have email in profiles, this will just stay null
};

function formatTimeLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  const now = Date.now();
  const ms = end - now;
  if (ms <= 0) return "expired";

  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function ManageItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [item, setItem] = useState<Item | null>(null);
  const [interests, setInterests] = useState<InterestRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeAccepted = useMemo(() => {
    return interests.find((x) => x.status === "accepted");
  }, [interests]);

  async function loadOne() {
    if (!id) return;

    setLoading(true);
    setErr(null);

    try {
      const { data, error } = await supabase
        .from("items")
        .select("id,title,description,status,created_at,owner_id,reserved_interest_id")
        .eq("id", id)
        .single();

      if (error) throw new Error(error.message);
      setItem((data as Item) || null);

      // load interests for this item (owner can see via RLS policy we created)
      const { data: ints, error: iErr } = await supabase
        .from("interests")
        .select(
          "id,item_id,user_id,status,earliest_pickup,time_window,note,created_at,accepted_at,accepted_expires_at,reserved_at,completed_at"
        )
        .eq("item_id", id)
        .order("created_at", { ascending: true });

      if (iErr) throw new Error(iErr.message);

      const list = (ints as InterestRow[]) || [];
      setInterests(list);

      // OPTIONAL: try to load profiles for display names
      const uniqueUserIds = Array.from(new Set(list.map((x) => x.user_id)));
      if (uniqueUserIds.length > 0) {
        // if your profiles table does NOT have email, it's okay; we'll just show full_name or id
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", uniqueUserIds);

        const map: Record<string, ProfileRow> = {};
        (profs as ProfileRow[] | null)?.forEach((p) => (map[p.id] = p));
        setProfilesById(map);
      } else {
        setProfilesById({});
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load.");
      setItem(null);
      setInterests([]);
      setProfilesById({});
    } finally {
      setLoading(false);
    }
  }

  async function acceptInterest(interestId: string) {
    setErr(null);
    setBusy(true);
    try {
      const { error } = await supabase.rpc("accept_interest", { p_interest_id: interestId });
      if (error) throw new Error(error.message);
      await loadOne();
    } catch (e: any) {
      setErr(e?.message || "Could not accept.");
    } finally {
      setBusy(false);
    }
  }

  // live countdown refresh
  useEffect(() => {
    const t = setInterval(() => {
      // force re-render every second for countdown
      setInterests((prev) => [...prev]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (id) loadOne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Link
          href="/feed"
          style={{
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          ← Back to feed
        </Link>

        <button
          onClick={() => router.push(`/item/${id}`)}
          style={{
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          View item
        </button>
      </div>

      {err && <p style={{ color: "#f87171", marginTop: 14 }}>{err}</p>}
      {loading && <p style={{ marginTop: 14, opacity: 0.8 }}>Loading…</p>}

      {item && (
        <div style={{ marginTop: 16, maxWidth: 980 }}>
          {/* Item card */}
          <div style={{ background: "#0b1730", borderRadius: 14, padding: 16, border: "1px solid #0f223f" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>{item.title}</h1>
            <div style={{ marginTop: 10, opacity: 0.8 }}>{item.description || "—"}</div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill label={`Status: ${item.status ?? "available"}`} />
              <Pill label={`Posted: ${new Date(item.created_at).toLocaleString()}`} />
              <Pill label={`Requests: ${interests.length}`} />
            </div>

            {activeAccepted && (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid #334155",
                  borderRadius: 12,
                  padding: 12,
                  background: "#020617",
                }}
              >
                <div style={{ fontWeight: 900 }}>Someone is selected (awaiting confirm)</div>
                <div style={{ opacity: 0.85, marginTop: 6 }}>
                  Expires in: <b>{formatTimeLeft(activeAccepted.accepted_expires_at) ?? "—"}</b>
                </div>
                <div style={{ opacity: 0.75, marginTop: 4, fontSize: 12 }}>
                  If time hits 00:00 and they don’t confirm, you can accept another person.
                </div>
              </div>
            )}
          </div>

          {/* Requests list */}
          <div style={{ marginTop: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>Requests</h2>
            <div style={{ marginTop: 10, opacity: 0.75 }}>
              Choose one person. They’ll have <b>2 hours</b> to confirm.
            </div>

            {interests.length === 0 ? (
              <div style={{ marginTop: 12, opacity: 0.75 }}>No requests yet.</div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {interests.map((r) => {
                  const prof = profilesById[r.user_id];
                  const display =
                    prof?.full_name ||
                    prof?.email ||
                    `${r.user_id.slice(0, 8)}…`;

                  const canAccept =
                    r.status === "pending" &&
                    (item.status ?? "available") === "available" &&
                    !activeAccepted &&
                    !busy;

                  const timeLeft = r.status === "accepted" ? formatTimeLeft(r.accepted_expires_at) : null;

                  return (
                    <div
                      key={r.id}
                      style={{
                        border: "1px solid #0f223f",
                        background: "#071022",
                        borderRadius: 14,
                        padding: 14,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900 }}>{display}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Pill label={`Status: ${r.status}`} />
                          {r.status === "accepted" && <Pill label={`Expires: ${timeLeft ?? "—"}`} />}
                          {r.earliest_pickup && <Pill label={`Pickup: ${r.earliest_pickup}`} />}
                          {r.time_window && <Pill label={`Window: ${r.time_window}`} />}
                        </div>
                      </div>

                      {r.note ? (
                        <div style={{ marginTop: 10, opacity: 0.9, whiteSpace: "pre-wrap" }}>{r.note}</div>
                      ) : (
                        <div style={{ marginTop: 10, opacity: 0.55 }}>No note</div>
                      )}

                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          onClick={() => acceptInterest(r.id)}
                          disabled={!canAccept}
                          style={{
                            ...outlineBtn,
                            opacity: canAccept ? 1 : 0.5,
                            cursor: canAccept ? "pointer" : "not-allowed",
                            background: canAccept ? "#052e16" : "transparent",
                            borderColor: canAccept ? "#14532d" : "#334155",
                          }}
                          title={
                            canAccept
                              ? "Select this person"
                              : activeAccepted
                              ? "Someone is already selected"
                              : r.status !== "pending"
                              ? "Not pending"
                              : "Unavailable"
                          }
                        >
                          {busy && canAccept ? "Selecting..." : "Accept"}
                        </button>

                        <div style={{ opacity: 0.6, fontSize: 12, alignSelf: "center" }}>
                          Requested: {new Date(r.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 900,
        padding: "6px 10px",
        borderRadius: 999,
        background: "#071022",
        border: "1px solid #0f223f",
        opacity: 0.95,
      }}
    >
      {label}
    </span>
  );
}

const outlineBtn: React.CSSProperties = {
  border: "1px solid #334155",
  background: "transparent",
  color: "white",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 900,
};