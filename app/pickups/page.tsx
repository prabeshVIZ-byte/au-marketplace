"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PickupInterestRow = {
  id: string;
  item_id: string;
  user_id: string;
  status: string | null;
  created_at: string | null;
  items: {
    id: string;
    title: string;
    photo_url: string | null;
    status: string | null;
    pickup_location?: string | null;
  } | null;
};

type ThreadMini = {
  id: string;
  item_id: string;
};

function isAshlandEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@ashland.edu");
}

function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function shortId(id: string) {
  if (!id) return "";
  return id.slice(0, 6) + "…" + id.slice(-4);
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

/**
 * What counts as "pickup" statuses?
 * - active: reserved (buyer confirmed) OR accepted (seller accepted, buyer maybe confirming)
 * - completed: item.status === claimed OR interest.status == claimed/completed
 *
 * This is intentionally tolerant so it still works even if your status naming changes slightly.
 */
function isActivePickup(interestStatus: string, itemStatus: string) {
  return ["reserved", "accepted"].includes(interestStatus) && !["claimed", "completed"].includes(interestStatus) && itemStatus !== "claimed";
}

function isCompletedPickup(interestStatus: string, itemStatus: string) {
  return itemStatus === "claimed" || ["claimed", "completed"].includes(interestStatus);
}

export default function PickupsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [rows, setRows] = useState<PickupInterestRow[]>([]);
  const [threadsByItem, setThreadsByItem] = useState<Record<string, string>>({}); // item_id -> thread_id

  const isLoggedInAshland = useMemo(() => {
    return !!userId && !!userEmail && isAshlandEmail(userEmail);
  }, [userId, userEmail]);

  const activePickups = useMemo(() => {
    return rows.filter((r) => {
      const iStatus = norm(r.status);
      const itemStatus = norm(r.items?.status);
      return isActivePickup(iStatus, itemStatus);
    });
  }, [rows]);

  const completedPickups = useMemo(() => {
    return rows.filter((r) => {
      const iStatus = norm(r.status);
      const itemStatus = norm(r.items?.status);
      return isCompletedPickup(iStatus, itemStatus);
    });
  }, [rows]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    const uid = s?.user?.id ?? null;
    const email = s?.user?.email ?? null;
    setUserId(uid);
    setUserEmail(email);
    return { uid, email };
  }

  async function loadPickups(uid: string) {
    setErr(null);

    // Pull YOUR interests + joined item
    // We fetch all interests and filter client-side because your status naming might vary.
    // (Keeps logic resilient.)
    const { data, error } = await supabase
      .from("interests")
      .select(
        `
        id,
        item_id,
        user_id,
        status,
        created_at,
        items:items(id,title,photo_url,status,pickup_location)
      `
      )
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .returns<PickupInterestRow[]>();

    if (error) {
      setRows([]);
      setErr(error.message);
      return [];
    }

    const all = data ?? [];

    // Keep only pickup-like interests (reserved/accepted/claimed/completed OR item.status claimed)
    const pickupish = all.filter((r) => {
      const iStatus = norm(r.status);
      const itemStatus = norm(r.items?.status);
      return ["accepted", "reserved", "claimed", "completed"].includes(iStatus) || itemStatus === "claimed";
    });

    setRows(pickupish);
    return pickupish;
  }

  async function loadThreadsForItems(uid: string, itemIds: string[]) {
    if (itemIds.length === 0) {
      setThreadsByItem({});
      return;
    }

    // Find the thread for each item where YOU are the requester
    const { data, error } = await supabase
      .from("threads")
      .select("id,item_id")
      .eq("requester_id", uid)
      .in("item_id", itemIds)
      .returns<ThreadMini[]>();

    if (error) {
      // Not fatal — pickups page still works without chat links
      console.warn("threads load:", error.message);
      setThreadsByItem({});
      return;
    }

    const map: Record<string, string> = {};
    (data ?? []).forEach((t) => {
      map[t.item_id] = t.id;
    });
    setThreadsByItem(map);
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    const { uid, email } = await syncAuth();

    if (!uid || !email || !isAshlandEmail(email)) {
      router.push("/me");
      return;
    }

    const pickupRows = await loadPickups(uid);
    const itemIds = pickupRows.map((r) => r.item_id).filter(Boolean);
    await loadThreadsForItems(uid, itemIds);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadAll();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoggedInAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 16 }}>
        Checking access…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 16, paddingBottom: 120 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(0,0,0,0.90)", backdropFilter: "blur(8px)", paddingBottom: 12, borderBottom: "1px solid #0f223f" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button
            onClick={() => router.push("/me")}
            style={{
              border: "1px solid #334155",
              background: "transparent",
              color: "white",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            ← Account
          </button>

          <button
            onClick={() => router.push("/messages")}
            style={{
              border: "1px solid #334155",
              background: "transparent",
              color: "white",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
            title="Messages"
          >
            💬
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 1000 }}>My pickups</div>
          <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
            Items you’ve confirmed (reserved) or already picked up (claimed).
          </div>
        </div>

        {err && <div style={{ marginTop: 10, color: "#f87171", fontWeight: 900 }}>{err}</div>}
        {loading && <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div>}
      </div>

      {/* Active */}
      <Section title="Active pickups" subtitle="Coordinate pickup time/location in chat.">
        {activePickups.length === 0 ? (
          <EmptyBox text="No active pickups right now." />
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {activePickups.map((r) => {
              const item = r.items;
              const threadId = threadsByItem[r.item_id] || null;
              const iStatus = norm(r.status);
              const itemStatus = norm(item?.status);

              return (
                <PickupCard
                  key={r.id}
                  title={item?.title ?? "Unknown item"}
                  photoUrl={item?.photo_url ?? null}
                  meta={`Interest: ${iStatus || "—"} • Item: ${itemStatus || "—"} • Requested: ${fmtWhen(r.created_at) || "—"}`}
                  location={item?.pickup_location ?? null}
                  onViewItem={() => router.push(`/item/${r.item_id}`)}
                  onChat={
                    threadId
                      ? () => router.push(`/messages/${threadId}`)
                      : undefined
                  }
                  chatDisabled={!threadId}
                />
              );
            })}
          </div>
        )}
      </Section>

      {/* Completed */}
      <Section title="Completed pickups" subtitle="Already picked up (claimed). No actions needed.">
        {completedPickups.length === 0 ? (
          <EmptyBox text="No completed pickups yet." />
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {completedPickups.map((r) => {
              const item = r.items;
              const itemStatus = norm(item?.status);

              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid #0f223f",
                    background: "#0b1730",
                    borderRadius: 16,
                    padding: 14,
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <Thumb photoUrl={item?.photo_url ?? null} label={item?.title ?? "Item"} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item?.title ?? "Unknown item"}
                    </div>
                    <div style={{ opacity: 0.75, marginTop: 4, fontSize: 12 }}>
                      Status: <b>{itemStatus || "claimed"}</b> • Item: <span style={{ fontWeight: 900 }}>{shortId(r.item_id)}</span>
                    </div>
                  </div>

                  <div style={{ opacity: 0.8, fontSize: 12, fontWeight: 900 }}>✅ Completed</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------------- small UI helpers ---------------- */

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 1000, fontSize: 18 }}>{title}</div>
      <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>{subtitle}</div>
      {children}
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 12, border: "1px solid #0f223f", background: "#0b1730", borderRadius: 16, padding: 14 }}>
      <div style={{ fontWeight: 900 }}>{text}</div>
    </div>
  );
}

function Thumb({ photoUrl, label }: { photoUrl: string | null; label: string }) {
  return (
    <div
      style={{
        width: 54,
        height: 54,
        borderRadius: 14,
        border: "1px solid #0f223f",
        background: "#020617",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#94a3b8",
        flexShrink: 0,
      }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        "—"
      )}
    </div>
  );
}

function PickupCard({
  title,
  photoUrl,
  meta,
  location,
  onViewItem,
  onChat,
  chatDisabled,
}: {
  title: string;
  photoUrl: string | null;
  meta: string;
  location: string | null;
  onViewItem: () => void;
  onChat?: () => void;
  chatDisabled?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #0f223f",
        background: "#0b1730",
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Thumb photoUrl={photoUrl} label={title} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 1000, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          <div style={{ opacity: 0.75, marginTop: 4, fontSize: 12 }}>{meta}</div>
          {location ? <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>Pickup: <b>{location}</b></div> : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button
          onClick={onViewItem}
          style={{
            border: "1px solid #334155",
            background: "transparent",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          View item
        </button>

        <button
          onClick={onChat}
          disabled={!onChat || !!chatDisabled}
          style={{
            border: "1px solid rgba(22,163,74,0.55)",
            background: (!onChat || chatDisabled) ? "rgba(22,163,74,0.10)" : "rgba(22,163,74,0.18)",
            color: "white",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: (!onChat || chatDisabled) ? "not-allowed" : "pointer",
            fontWeight: 900,
            opacity: (!onChat || chatDisabled) ? 0.75 : 1,
          }}
          title={(!onChat || chatDisabled) ? "Chat not found yet" : "Open chat"}
        >
          Open chat 💬
        </button>
      </div>
    </div>
  );
}