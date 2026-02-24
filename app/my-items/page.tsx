"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MyItem = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  photo_url: string | null;
};

type InterestRow = {
  item_id: string;
  user_id: string; // requester
  status: string | null; // requested/accepted/...
  accepted_at: string | null;
  thread_id: string | null;
  created_at: string;
};

export default function MyItemsPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [items, setItems] = useState<MyItem[]>([]);
  const [requestsByItem, setRequestsByItem] = useState<Record<string, InterestRow[]>>({});

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null); // `${itemId}:${requesterId}`

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadMyItemsAndRequests() {
    setLoading(true);
    setErr(null);

    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id ?? null;
    const email = s.session?.user?.email ?? null;

    if (!uid || !email || !email.toLowerCase().endsWith("@ashland.edu")) {
      router.push("/me");
      return;
    }

    // 1) load my items
    const { data: itemsData, error: itemsErr } = await supabase
      .from("items")
      .select("id,title,description,status,created_at,photo_url")
      .eq("owner_id", uid)
      .order("created_at", { ascending: false });

    if (itemsErr) {
      setErr(itemsErr.message);
      setItems([]);
      setRequestsByItem({});
      setLoading(false);
      return;
    }

    const myItems = (itemsData as MyItem[]) || [];
    setItems(myItems);

    // 2) load requests for my items from interests
    const itemIds = myItems.map((x) => x.id);
    if (itemIds.length === 0) {
      setRequestsByItem({});
      setLoading(false);
      return;
    }

    const { data: reqData, error: reqErr } = await supabase
      .from("interests")
      .select("item_id,user_id,status,accepted_at,thread_id,created_at")
      .in("item_id", itemIds)
      .order("created_at", { ascending: false });

    if (reqErr) {
      // requests are secondary; still show listings even if requests fail
      setRequestsByItem({});
      setLoading(false);
      return;
    }

    const grouped: Record<string, InterestRow[]> = {};
    for (const r of ((reqData as InterestRow[]) || []) as InterestRow[]) {
      const k = String(r.item_id);
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(r);
    }
    setRequestsByItem(grouped);

    setLoading(false);
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this listing? This cannot be undone.")) return;

    setDeletingId(id);

    const { error } = await supabase.from("items").delete().eq("id", id);

    setDeletingId(null);

    if (error) {
      alert(error.message);
      return;
    }

    setItems((prev) => prev.filter((x) => x.id !== id));
    setRequestsByItem((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  async function acceptRequest(itemId: string, requesterId: string) {
    if (!userId) return;

    const key = `${itemId}:${requesterId}`;
    setAcceptingKey(key);

    try {
      // 1) find existing thread (if already accepted earlier)
      const { data: existing, error: findErr } = await supabase
        .from("threads")
        .select("id")
        .eq("item_id", itemId)
        .eq("owner_id", userId)
        .eq("requester_id", requesterId)
        .maybeSingle();

      if (findErr) throw findErr;

      let threadId = existing?.id as string | undefined;

      // 2) create thread if missing
      if (!threadId) {
        const { data: created, error: createErr } = await supabase
          .from("threads")
          .insert([{ item_id: itemId, owner_id: userId, requester_id: requesterId }])
          .select("id")
          .single();

        if (createErr) throw createErr;
        threadId = created.id as string;
      }

      // 3) update interest row -> accepted + thread_id
      const { error: upErr } = await supabase
        .from("interests")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          thread_id: threadId,
        })
        .eq("item_id", itemId)
        .eq("user_id", requesterId);

      if (upErr) throw upErr;

      // 4) set item reserved
      const { error: itemErr } = await supabase.from("items").update({ status: "reserved" }).eq("id", itemId);
      if (itemErr) throw itemErr;

      // 5) refresh local UI (cheap + safe)
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, status: "reserved" } : x)));
      setRequestsByItem((prev) => {
        const list = prev[itemId] || [];
        const next = list.map((r) => (r.user_id === requesterId ? { ...r, status: "accepted", accepted_at: new Date().toISOString(), thread_id: threadId! } : r));
        return { ...prev, [itemId]: next };
      });

      // 6) go to chat (page will be built next)
      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      alert(e?.message || "Failed to accept request.");
    } finally {
      setAcceptingKey(null);
    }
  }

  useEffect(() => {
    syncAuth();
    loadMyItemsAndRequests();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadMyItemsAndRequests();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isLoggedIn) {
    return <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>Checking access…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
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

        <Link
          href="/create"
          style={{
            border: "1px solid #334155",
            padding: "10px 12px",
            borderRadius: 12,
            color: "white",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          + List new item
        </Link>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        Logged in as <b>{userEmail}</b>
      </div>

      <h1 style={{ marginTop: 18, fontSize: 28, fontWeight: 900 }}>My Listings</h1>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ opacity: 0.8 }}>Loading…</p>}

      {!loading && items.length === 0 && <p style={{ opacity: 0.8, marginTop: 10 }}>You haven’t listed anything yet.</p>}

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {items.map((item) => {
          const reqs = requestsByItem[item.id] || [];
          const requested = reqs.filter((r) => (r.status ?? "requested") === "requested");
          const accepted = reqs.filter((r) => r.status === "accepted");

          return (
            <div
              key={item.id}
              style={{
                background: "#0b1730",
                padding: 16,
                borderRadius: 14,
                border: "1px solid #0f223f",
              }}
            >
              {item.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.photo_url}
                  alt={item.title}
                  style={{
                    width: "100%",
                    height: 160,
                    objectFit: "cover",
                    borderRadius: 12,
                    border: "1px solid #0f223f",
                    marginBottom: 12,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: 160,
                    borderRadius: 12,
                    border: "1px dashed #334155",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#94a3b8",
                    marginBottom: 12,
                  }}
                >
                  No photo
                </div>
              )}

              <div style={{ fontSize: 18, fontWeight: 900 }}>{item.title}</div>
              <div style={{ opacity: 0.75, marginTop: 6 }}>{item.description || "—"}</div>

              <div style={{ opacity: 0.75, marginTop: 10 }}>
                Status: <b>{item.status || "—"}</b>
              </div>

              {/* Requests panel */}
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.15)",
                  background: "rgba(255,255,255,0.03)",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 950 }}>Requests</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {requested.length} pending • {accepted.length} accepted
                  </div>
                </div>

                {reqs.length === 0 ? (
                  <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>No requests yet.</div>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {reqs.map((r) => {
                      const st = r.status ?? "requested";
                      const key = `${item.id}:${r.user_id}`;
                      const busy = acceptingKey === key;

                      return (
                        <div
                          key={r.user_id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            border: "1px solid rgba(148,163,184,0.12)",
                            borderRadius: 12,
                            padding: "10px 10px",
                            background: "rgba(0,0,0,0.18)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900, fontSize: 13, opacity: 0.9 }}>Requester</div>
                            <div style={{ fontSize: 12, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.user_id}
                            </div>
                            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                              Status:{" "}
                              <b style={{ color: st === "accepted" ? "#22c55e" : "#eab308" }}>
                                {st}
                              </b>
                            </div>
                          </div>

                          {st === "accepted" && r.thread_id ? (
                            <button
                              onClick={() => router.push(`/messages/${r.thread_id}`)}
                              style={{
                                borderRadius: 12,
                                border: "1px solid rgba(148,163,184,0.25)",
                                background: "transparent",
                                color: "white",
                                padding: "10px 12px",
                                cursor: "pointer",
                                fontWeight: 950,
                                whiteSpace: "nowrap",
                              }}
                            >
                              Open chat
                            </button>
                          ) : (
                            <button
                              onClick={() => acceptRequest(item.id, r.user_id)}
                              disabled={busy}
                              style={{
                                borderRadius: 12,
                                border: "1px solid #16a34a",
                                background: busy ? "rgba(22,163,74,0.18)" : "#052e16",
                                color: "white",
                                padding: "10px 12px",
                                cursor: busy ? "not-allowed" : "pointer",
                                fontWeight: 950,
                                opacity: busy ? 0.75 : 1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {busy ? "Accepting…" : "Accept"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={() => router.push(`/manage/${item.id}`)}
                  style={{
                    flex: 1,
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  Edit
                </button>

                <button
                  onClick={() => deleteItem(item.id)}
                  disabled={deletingId === item.id}
                  style={{
                    flex: 1,
                    border: "1px solid #7f1d1d",
                    background: deletingId === item.id ? "#7f1d1d" : "transparent",
                    color: "white",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: deletingId === item.id ? "not-allowed" : "pointer",
                    fontWeight: 900,
                    opacity: deletingId === item.id ? 0.8 : 1,
                  }}
                >
                  {deletingId === item.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}