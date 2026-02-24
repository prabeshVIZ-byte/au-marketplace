"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: string | null; // available | reserved | claimed
  created_at: string;
  owner_id: string;
  reserved_interest_id: string | null;
  reserved_at?: string | null;
  claimed_at?: string | null;
};

type InterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: string;
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

  const [busyAcceptId, setBusyAcceptId] = useState<string | null>(null);
  const [busyPickup, setBusyPickup] = useState(false);

  const activeAccepted = useMemo(() => interests.find((x) => x.status === "accepted"), [interests]);
  const activeReserved = useMemo(() => interests.find((x) => x.status === "reserved"), [interests]);
  const itemStatus = item?.status ?? "available";

  async function loadAll() {
    if (!id) return;

    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select("id,title,description,status,created_at,owner_id,reserved_interest_id,reserved_at,claimed_at")
        .eq("id", id)
        .single();

      if (itErr) throw new Error(itErr.message);
      setItem((it as Item) || null);

      const { data: ints, error: iErr } = await supabase
        .from("interests")
        .select("id,item_id,user_id,status,earliest_pickup,time_window,note,created_at,accepted_at,accepted_expires_at,reserved_at,completed_at")
        .eq("item_id", id)
        .order("created_at", { ascending: true });

      if (iErr) throw new Error(iErr.message);

      const list = (ints as InterestRow[]) || [];
      setInterests(list);

      const uniqueUserIds = Array.from(new Set(list.map((x) => x.user_id)));
      if (uniqueUserIds.length > 0) {
        const { data: profs, error: pErr } = await supabase
          .from("profiles")
          .select("id,full_name")
          .in("id", uniqueUserIds);

        if (pErr) {
          setProfilesById({});
        } else {
          const map: Record<string, ProfileRow> = {};
          (profs as ProfileRow[] | null)?.forEach((p) => (map[p.id] = p));
          setProfilesById(map);
        }
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

  // ✅ ACCEPT: accept_interest RPC + ensure thread + system msg + redirect seller to thread
  async function acceptInterest(interestId: string) {
    if (!item) return;

    setErr(null);
    setBusyAcceptId(interestId);

    try {
      const acceptedInterest = interests.find((x) => x.id === interestId);
      if (!acceptedInterest) throw new Error("Could not find the selected request.");

      // 1) accept in DB
      const { error } = await supabase.rpc("accept_interest", { p_interest_id: interestId });
      if (error) throw new Error(error.message);

      // 2) create/find thread for seller(owner_id) & buyer(user_id)
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: acceptedInterest.user_id,
      });

      // 3) notify buyer inside chat (system message)
      await insertSystemMessage({
        threadId,
        senderId: item.owner_id, // seller
        body: "✅ Seller accepted your request. Please confirm pickup on the item page, then coordinate here.",
      });

      // 4) redirect seller to thread now
      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setErr(e?.message || "Could not accept.");
    } finally {
      setBusyAcceptId(null);
    }
  }

  async function markPickedUp() {
    if (!item) return;

    setErr(null);
    setBusyPickup(true);

    try {
      const { error } = await supabase.rpc("mark_picked_up", { p_item_id: item.id });
      if (error) throw new Error(error.message);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || "Could not mark picked up.");
    } finally {
      setBusyPickup(false);
    }
  }

  useEffect(() => {
    const t = setInterval(() => {
      setInterests((prev) => [...prev]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (id) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canMarkPickedUp = itemStatus === "reserved" && !!item?.reserved_interest_id && !busyPickup;

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
          <div style={{ background: "#0b1730", borderRadius: 14, padding: 16, border: "1px solid #0f223f" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>{item.title}</h1>
            <div style={{ marginTop: 10, opacity: 0.8 }}>{item.description || "—"}</div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill label={`Status: ${itemStatus}`} />
              <Pill label={`Requests: ${interests.length}`} />
              <Pill label={`Posted: ${new Date(item.created_at).toLocaleString()}`} />
            </div>

            {activeAccepted && itemStatus === "available" && (
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

            {itemStatus === "reserved" && (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid #14532d",
                  borderRadius: 12,
                  padding: 12,
                  background: "#052e16",
                }}
              >
                <div style={{ fontWeight: 900 }}>Reserved ✅</div>
                <div style={{ opacity: 0.9, marginTop: 6 }}>
                  The selected person confirmed. After pickup, mark it as picked up.
                </div>

                <button
                  onClick={markPickedUp}
                  disabled={!canMarkPickedUp}
                  style={{
                    marginTop: 12,
                    border: "1px solid #16a34a",
                    background: canMarkPickedUp ? "#16a34a" : "transparent",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 12,
                    cursor: canMarkPickedUp ? "pointer" : "not-allowed",
                    fontWeight: 900,
                    opacity: canMarkPickedUp ? 1 : 0.5,
                  }}
                >
                  {busyPickup ? "Marking..." : "Mark picked up"}
                </button>
              </div>
            )}

            {itemStatus === "claimed" && <div style={{ marginTop: 14, opacity: 0.85 }}>✅ This item is claimed.</div>}
          </div>

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
                  const display = prof?.full_name || `${r.user_id.slice(0, 8)}…`;
                  const timeLeft = r.status === "accepted" ? formatTimeLeft(r.accepted_expires_at) : null;

                  const alreadyLocked = itemStatus !== "available" || !!activeReserved || !!activeAccepted;
                  const canAccept =
                    r.status === "pending" &&
                    itemStatus === "available" &&
                    !activeAccepted &&
                    !activeReserved &&
                    busyAcceptId === null;

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
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                          disabled={!canAccept || busyAcceptId !== null}
                          style={{
                            ...outlineBtn,
                            opacity: canAccept ? 1 : 0.5,
                            cursor: canAccept ? "pointer" : "not-allowed",
                            background: canAccept ? "#052e16" : "transparent",
                            borderColor: canAccept ? "#14532d" : "#334155",
                          }}
                        >
                          {busyAcceptId === r.id ? "Selecting..." : "Accept"}
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