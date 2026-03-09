"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type PostType = "give" | "request" | "event";
type OfferStatus = "pending" | "hold" | "accepted" | "declined" | "completed";

type Item = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  created_at: string;
  owner_id: string;
  reserved_interest_id: string | null;
  reserved_at?: string | null;
  claimed_at?: string | null;
  photo_url?: string | null;
  post_type?: PostType | null;
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
  email: string | null;
};

type OfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  helper: {
    full_name: string | null;
    email: string | null;
    user_role: string | null;
  } | null;
};

type OfferQueryRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | null;
  availability: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  helper:
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }
    | {
        full_name: string | null;
        email: string | null;
        user_role: string | null;
      }[]
    | null;
};

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtShort(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normStatus(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatTimeLeft(expiresAt: string | null, nowMs: number) {
  if (!expiresAt) return null;

  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;

  const diff = end - nowMs;
  if (diff <= 0) return "expired";

  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toneForStatus(status: string | null | undefined): "green" | "amber" | "red" | "gray" {
  const s = normStatus(status);
  if (["accepted", "reserved", "claimed", "completed"].includes(s)) return "green";
  if (["pending", "hold"].includes(s)) return "amber";
  if (["declined", "expired"].includes(s)) return "red";
  return "gray";
}

function readableName(
  profile: { full_name: string | null; email?: string | null } | null | undefined,
  fallbackId?: string | null
) {
  const name = (profile?.full_name ?? "").trim();
  if (name) return name;

  const email = (profile?.email ?? "").trim();
  if (email) return email.split("@")[0];

  if (fallbackId) return `${fallbackId.slice(0, 8)}…`;
  return "Unknown user";
}

function postTypeLabel(postType: PostType | null | undefined) {
  if (postType === "request") return "Request";
  if (postType === "event") return "Event";
  return "Give";
}

export default function ManageItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || "";

  const [viewerId, setViewerId] = useState<string | null>(null);

  const [item, setItem] = useState<Item | null>(null);
  const [interests, setInterests] = useState<InterestRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [offers, setOffers] = useState<OfferRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [wrongPage, setWrongPage] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [busyAcceptId, setBusyAcceptId] = useState<string | null>(null);
  const [busyPickup, setBusyPickup] = useState(false);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const postType = (item?.post_type ?? "give") as PostType;
  const isGivePost = postType === "give";
  const isRequestPost = postType === "request";
  const itemStatus = normStatus(item?.status) || "available";

  const activeAcceptedInterest = useMemo(
    () => interests.find((x) => normStatus(x.status) === "accepted"),
    [interests]
  );

  const activeReservedInterest = useMemo(
    () => interests.find((x) => normStatus(x.status) === "reserved"),
    [interests]
  );

  const acceptedOffer = useMemo(
    () => offers.find((x) => normStatus(x.status) === "accepted"),
    [offers]
  );

  const pendingInterestCount = useMemo(
    () => interests.filter((x) => normStatus(x.status) === "pending").length,
    [interests]
  );

  const pendingOfferCount = useMemo(
    () => offers.filter((x) => normStatus(x.status) === "pending").length,
    [offers]
  );

  const canMarkPickedUp =
    isGivePost &&
    itemStatus === "reserved" &&
    !!item?.reserved_interest_id &&
    !busyPickup;

  const loadAll = useCallback(
    async (showRefreshing = false) => {
      if (!id) return;

      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      setErr(null);
      setWrongPage(false);

      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr) throw new Error(userErr.message);

        const uid = user?.id ?? null;
        setViewerId(uid);

        if (!uid) {
          setAccessDenied(true);
          setItem(null);
          setInterests([]);
          setOffers([]);
          setProfilesById({});
          setErr("Sign in to manage this post.");
          return;
        }

        const { data: itemRow, error: itemErr } = await supabase
          .from("items")
          .select(
            "id,title,description,status,created_at,owner_id,reserved_interest_id,reserved_at,claimed_at,photo_url,post_type"
          )
          .eq("id", id)
          .maybeSingle();

        if (itemErr) throw new Error(itemErr.message);

        if (!itemRow) {
          setAccessDenied(false);
          setItem(null);
          setInterests([]);
          setOffers([]);
          setProfilesById({});
          setErr("Post not found.");
          return;
        }

        const loadedItem = itemRow as Item;
        setItem(loadedItem);

        if (loadedItem.owner_id !== uid) {
          setAccessDenied(true);
          setInterests([]);
          setOffers([]);
          setProfilesById({});
          setErr("You can only manage your own post.");
          return;
        }

        setAccessDenied(false);

        if ((loadedItem.post_type ?? "give") === "event") {
          setWrongPage(true);
          setInterests([]);
          setOffers([]);
          setProfilesById({});
          return;
        }

        if ((loadedItem.post_type ?? "give") === "request") {
          const { data: offerRows, error: offerErr } = await supabase
            .from("request_offers")
            .select(`
              id,
              request_id,
              helper_id,
              status,
              availability,
              note,
              created_at,
              updated_at,
              helper:profiles!request_offers_helper_id_fkey(full_name,email,user_role)
            `)
            .eq("request_id", loadedItem.id)
            .order("created_at", { ascending: false });

          if (offerErr) throw new Error(offerErr.message);

          const normalizedOffers: OfferRow[] = (((offerRows ?? []) as unknown) as OfferQueryRow[]).map((row) => ({
            id: row.id,
            request_id: row.request_id,
            helper_id: row.helper_id,
            status: row.status,
            availability: row.availability,
            note: row.note,
            created_at: row.created_at,
            updated_at: row.updated_at,
            helper: singleRelation(row.helper),
          }));

          setOffers(normalizedOffers);
          setInterests([]);
          setProfilesById({});
          return;
        }

        const { data: ints, error: interestErr } = await supabase
          .from("interests")
          .select(
            "id,item_id,user_id,status,earliest_pickup,time_window,note,created_at,accepted_at,accepted_expires_at,reserved_at,completed_at"
          )
          .eq("item_id", loadedItem.id)
          .order("created_at", { ascending: true });

        if (interestErr) throw new Error(interestErr.message);

        const interestList = (ints ?? []) as InterestRow[];
        setInterests(interestList);
        setOffers([]);

        const uniqueUserIds = Array.from(new Set(interestList.map((x) => x.user_id))).filter(Boolean);

        if (uniqueUserIds.length > 0) {
          const { data: profs, error: profErr } = await supabase
            .from("profiles")
            .select("id,full_name,email")
            .in("id", uniqueUserIds);

          if (profErr) {
            setProfilesById({});
          } else {
            const map: Record<string, ProfileRow> = {};
            ((profs ?? []) as ProfileRow[]).forEach((profile) => {
              map[profile.id] = profile;
            });
            setProfilesById(map);
          }
        } else {
          setProfilesById({});
        }
      } catch (e: any) {
        setErr(e?.message || "Failed to load.");
        setItem(null);
        setInterests([]);
        setOffers([]);
        setProfilesById({});
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id]
  );

  async function acceptInterest(interestId: string) {
    if (!item || !isGivePost) return;

    setErr(null);
    setBusyAcceptId(interestId);

    try {
      const selected = interests.find((x) => x.id === interestId);
      if (!selected) throw new Error("Could not find the selected request.");

      const { error } = await supabase.rpc("accept_interest", { p_interest_id: interestId });
      if (error) throw new Error(error.message);

      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: selected.user_id,
      });

      await insertSystemMessage({
        threadId,
        senderId: item.owner_id,
        body: "✅ Seller accepted your request. Please confirm pickup on the item page, then coordinate here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setErr(e?.message || "Could not accept the request.");
    } finally {
      setBusyAcceptId(null);
    }
  }

  async function markPickedUp() {
    if (!item || !isGivePost) return;

    setErr(null);
    setBusyPickup(true);

    try {
      const { error } = await supabase.rpc("mark_picked_up", { p_item_id: item.id });
      if (error) throw new Error(error.message);
      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || "Could not mark picked up.");
    } finally {
      setBusyPickup(false);
    }
  }

  async function updateOfferStatus(offer: OfferRow, next: OfferStatus) {
    if (!item || !isRequestPost) return;

    setErr(null);
    setBusyOfferId(offer.id);

    try {
      const nowIso = new Date().toISOString();

      if (next === "accepted") {
        const { error: othersErr } = await supabase
          .from("request_offers")
          .update({ status: "declined", updated_at: nowIso })
          .eq("request_id", item.id)
          .neq("id", offer.id)
          .in("status", ["pending", "hold", "accepted"]);

        if (othersErr) throw new Error(othersErr.message);
      }

      const { error } = await supabase
        .from("request_offers")
        .update({ status: next, updated_at: nowIso })
        .eq("id", offer.id);

      if (error) throw new Error(error.message);

      if (next === "accepted") {
        const threadId = await ensureThread({
          itemId: item.id,
          ownerId: item.owner_id,
          requesterId: offer.helper_id,
        });

        await insertSystemMessage({
          threadId,
          senderId: item.owner_id,
          body: "✅ Your help offer was accepted. You can coordinate here.",
        });

        router.push(`/messages/${threadId}`);
        return;
      }

      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || `Could not set offer to ${next}.`);
    } finally {
      setBusyOfferId(null);
    }
  }

  async function openHelperChat(offer: OfferRow) {
    if (!item || !viewerId || !isRequestPost) return;

    if (normStatus(offer.status) !== "accepted") {
      setErr("Accept this helper first before opening chat.");
      return;
    }

    setErr(null);
    setBusyChatId(offer.id);

    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: offer.helper_id,
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setErr(e?.message || "Could not open chat.");
    } finally {
      setBusyChatId(null);
    }
  }

  useEffect(() => {
    if (id) void loadAll(false);
  }, [id, loadAll]);

  if (loading) {
    return (
      <div className="manage-page">
        <div className="shell">
          <div className="card skeleton">
            <div className="skel skel-lg" />
            <div className="skel skel-md" />
            <div className="skel skel-md" />
          </div>
        </div>
        <PageStyles />
      </div>
    );
  }

  return (
    <div className="manage-page">
      <div className="shell">
        <div className="topbar">
          <Link href="/feed" className="ghost-btn">
            ← Back to feed
          </Link>

          <div className="topbar-actions">
            <button onClick={() => void loadAll(true)} className="ghost-btn" type="button" disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>

            <button onClick={() => router.push(`/item/${id}`)} className="ghost-btn" type="button">
              View post
            </button>
          </div>
        </div>

        {err ? <div className="error-box">{err}</div> : null}

        {!item ? (
          <div className="card">
            <h1 className="title">Manage post</h1>
            <p className="muted">We could not load this post.</p>
          </div>
        ) : accessDenied ? (
          <div className="stack">
            <section className="hero-card">
              <div className="hero-main">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt={item.title} className="hero-image" />
                ) : (
                  <div className="hero-image-fallback">{postTypeLabel(item.post_type)}</div>
                )}

                <div className="hero-copy">
                  <div className="eyebrow">Manage post</div>
                  <h1 className="title clamp">{item.title}</h1>
                  <p className="muted">{item.description || "No description provided."}</p>

                  <div className="pill-row top-gap">
                    <Pill label={`Type: ${postTypeLabel(item.post_type)}`} tone="gray" />
                    <Pill label={`Status: ${item.status ?? "—"}`} tone="gray" />
                    <Pill label={`Posted: ${fmtWhen(item.created_at)}`} tone="gray" />
                  </div>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="section-title">No access</h2>
              <p className="muted">Only the owner of this post can manage it.</p>

              <div className="action-row">
                <button onClick={() => router.push(`/item/${item.id}`)} className="primary-btn" type="button">
                  Open post
                </button>
                <button onClick={() => router.push("/feed")} className="secondary-btn" type="button">
                  Go to feed
                </button>
              </div>
            </section>
          </div>
        ) : wrongPage ? (
          <div className="stack">
            <section className="hero-card">
              <div className="hero-main">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt={item.title} className="hero-image" />
                ) : (
                  <div className="hero-image-fallback">Event</div>
                )}

                <div className="hero-copy">
                  <div className="eyebrow">Event flow</div>
                  <h1 className="title clamp">{item.title}</h1>
                  <p className="muted">
                    This page should only manage give items and request posts. Keep events on their own screen so
                    this workflow stays simple.
                  </p>

                  <div className="pill-row top-gap">
                    <Pill label="Type: Event" tone="gray" />
                    <Pill label={`Posted: ${fmtWhen(item.created_at)}`} tone="gray" />
                  </div>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="section-title">Use a separate event manager</h2>
              <p className="muted">
                Put event attendance and event actions in an event-specific page, not here.
              </p>

              <div className="action-row">
                <button onClick={() => router.push("/me")} className="primary-btn" type="button">
                  Go to profile
                </button>
                <button onClick={() => router.push("/feed")} className="secondary-btn" type="button">
                  Back to feed
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="stack">
            <section className="hero-card">
              <div className="hero-main">
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.photo_url} alt={item.title} className="hero-image" />
                ) : (
                  <div className="hero-image-fallback">{postTypeLabel(item.post_type)}</div>
                )}

                <div className="hero-copy">
                  <div className="eyebrow">Manage post</div>
                  <h1 className="title clamp">{item.title}</h1>
                  <p className="muted">{item.description || "No description provided."}</p>

                  <div className="pill-row top-gap">
                    <Pill label={`Type: ${postTypeLabel(item.post_type)}`} tone="gray" />
                    <Pill label={`Status: ${item.status ?? "—"}`} tone={toneForStatus(item.status)} />
                    <Pill
                      label={isRequestPost ? `Offers: ${offers.length}` : `Requests: ${interests.length}`}
                      tone={isRequestPost ? "green" : "amber"}
                    />
                    <Pill label={`Posted: ${fmtShort(item.created_at)}`} tone="gray" />
                  </div>
                </div>
              </div>

              {isGivePost && activeAcceptedInterest && itemStatus === "available" ? (
                <div className="status-box amber-box">
                  <div className="status-title">Someone is selected and waiting to confirm</div>
                  <div className="status-text">
                    Expires in <b>{formatTimeLeft(activeAcceptedInterest.accepted_expires_at, nowMs) ?? "—"}</b>
                  </div>
                  <div className="fine-print">
                    Until that confirmation window ends, do not choose someone else.
                  </div>
                </div>
              ) : null}

              {isGivePost && itemStatus === "reserved" ? (
                <div className="status-box green-box">
                  <div className="status-title">Reserved ✅</div>
                  <div className="status-text">
                    The selected person confirmed pickup. Mark it as picked up after the handoff.
                  </div>

                  <div className="action-row top-gap">
                    <button
                      onClick={markPickedUp}
                      disabled={!canMarkPickedUp}
                      className="primary-btn"
                      type="button"
                    >
                      {busyPickup ? "Marking…" : "Mark picked up"}
                    </button>
                  </div>
                </div>
              ) : null}

              {(isGivePost && itemStatus === "claimed") || (isGivePost && itemStatus === "completed") ? (
                <div className="status-box gray-box">
                  <div className="status-title">Finished ✅</div>
                  <div className="status-text">This give-item workflow is already complete.</div>
                </div>
              ) : null}

              {isRequestPost && acceptedOffer ? (
                <div className="status-box green-box">
                  <div className="status-title">Helper selected ✅</div>
                  <div className="status-text">
                    One helper is already accepted. Continue the coordination in chat.
                  </div>

                  <div className="action-row top-gap">
                    <button
                      onClick={() => void openHelperChat(acceptedOffer)}
                      disabled={busyChatId === acceptedOffer.id}
                      className="primary-btn"
                      type="button"
                    >
                      {busyChatId === acceptedOffer.id ? "Opening…" : "Open accepted chat"}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            {isGivePost ? (
              <section className="card">
                <div className="section-head">
                  <div>
                    <h2 className="section-title">Incoming item requests</h2>
                    <p className="muted">
                      Accept only one person. They get a 2-hour confirmation window and a chat thread.
                    </p>
                  </div>

                  <div className="pill-row">
                    <Pill label={`Pending: ${pendingInterestCount}`} tone={pendingInterestCount ? "amber" : "gray"} />
                    <Pill label={`Total: ${interests.length}`} tone={interests.length ? "green" : "gray"} />
                  </div>
                </div>

                {interests.length === 0 ? (
                  <EmptyState
                    title="No requests yet"
                    body="When someone requests this item, it will appear here."
                  />
                ) : (
                  <div className="list">
                    {interests.map((request) => {
                      const profile = profilesById[request.user_id];
                      const name = readableName(profile, request.user_id);
                      const requestStatus = normStatus(request.status);

                      const anotherLocked =
                        (!!activeAcceptedInterest && activeAcceptedInterest.id !== request.id) ||
                        !!activeReservedInterest;

                      const canAccept =
                        requestStatus === "pending" &&
                        itemStatus === "available" &&
                        !anotherLocked &&
                        busyAcceptId === null;

                      return (
                        <div key={request.id} className="row-card">
                          <div className="row-top">
                            <div>
                              <div className="row-title">{name}</div>
                              <div className="row-meta">Requested {fmtWhen(request.created_at)}</div>
                            </div>

                            <div className="pill-row">
                              <Pill label={request.status} tone={toneForStatus(request.status)} />
                              {requestStatus === "accepted" ? (
                                <Pill
                                  label={`Expires: ${formatTimeLeft(request.accepted_expires_at, nowMs) ?? "—"}`}
                                  tone="amber"
                                />
                              ) : null}
                              {request.earliest_pickup ? (
                                <Pill label={`Pickup: ${request.earliest_pickup}`} tone="gray" />
                              ) : null}
                              {request.time_window ? (
                                <Pill label={`Window: ${request.time_window}`} tone="gray" />
                              ) : null}
                            </div>
                          </div>

                          <div className="note-box">
                            {request.note?.trim() ? request.note : "No note provided."}
                          </div>

                          <div className="action-row">
                            <button
                              onClick={() => void acceptInterest(request.id)}
                              disabled={!canAccept}
                              className="primary-btn"
                              type="button"
                            >
                              {busyAcceptId === request.id
                                ? "Selecting…"
                                : requestStatus === "accepted"
                                ? "Waiting"
                                : requestStatus === "reserved"
                                ? "Confirmed"
                                : requestStatus === "completed"
                                ? "Completed"
                                : anotherLocked
                                ? "Locked"
                                : "Accept"}
                            </button>

                            {(requestStatus === "accepted" || requestStatus === "reserved") && (
                              <button
                                onClick={async () => {
                                  const threadId = await ensureThread({
                                    itemId: item.id,
                                    ownerId: item.owner_id,
                                    requesterId: request.user_id,
                                  });
                                  router.push(`/messages/${threadId}`);
                                }}
                                className="secondary-btn"
                                type="button"
                              >
                                Open chat
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {isRequestPost ? (
              <section className="card">
                <div className="section-head">
                  <div>
                    <h2 className="section-title">Incoming helper offers</h2>
                    <p className="muted">
                      Pick one helper. Once accepted, the others should be treated as closed out.
                    </p>
                  </div>

                  <div className="pill-row">
                    <Pill label={`Pending: ${pendingOfferCount}`} tone={pendingOfferCount ? "amber" : "gray"} />
                    <Pill label={`Total: ${offers.length}`} tone={offers.length ? "green" : "gray"} />
                  </div>
                </div>

                {offers.length === 0 ? (
                  <EmptyState
                    title="No helper offers yet"
                    body="When someone offers help on this request post, it will appear here."
                  />
                ) : (
                  <div className="list">
                    {offers.map((offer) => {
                      const name = readableName(offer.helper, offer.helper_id);
                      const status = (offer.status ?? "pending") as OfferStatus;
                      const otherAcceptedExists = !!acceptedOffer && acceptedOffer.id !== offer.id;
                      const busy = busyOfferId === offer.id || busyChatId === offer.id;

                      return (
                        <div key={offer.id} className="row-card">
                          <div className="row-top">
                            <div>
                              <div className="row-title">{name}</div>
                              <div className="row-meta">
                                Offered {fmtWhen(offer.created_at)}
                                {offer.availability ? ` • Availability: ${offer.availability}` : ""}
                              </div>
                            </div>

                            <div className="pill-row">
                              <Pill label={status} tone={toneForStatus(status)} />
                            </div>
                          </div>

                          <div className="note-box">
                            {offer.note?.trim() ? offer.note : "No note provided."}
                          </div>

                          <div className="action-row">
                            <button
                              onClick={() => void updateOfferStatus(offer, "accepted")}
                              disabled={busy || status === "accepted" || status === "completed" || otherAcceptedExists}
                              className="primary-btn"
                              type="button"
                            >
                              {busyOfferId === offer.id ? "Working…" : "Accept"}
                            </button>

                            <button
                              onClick={() => void updateOfferStatus(offer, "declined")}
                              disabled={busy || status === "completed" || status === "declined"}
                              className="danger-btn"
                              type="button"
                            >
                              Decline
                            </button>

                            <button
                              onClick={() => void openHelperChat(offer)}
                              disabled={busy || status !== "accepted"}
                              className="secondary-btn"
                              type="button"
                            >
                              {busyChatId === offer.id ? "Opening…" : "Open chat"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </div>

      <PageStyles />
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-box">
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
    </div>
  );
}

function Pill({
  label,
  tone = "gray",
}: {
  label: string;
  tone?: "green" | "amber" | "red" | "gray";
}) {
  return <span className={`pill ${tone}`}>{label}</span>;
}

function PageStyles() {
  return (
    <style jsx global>{`
      * {
        box-sizing: border-box;
      }

      html,
      body {
        max-width: 100%;
        overflow-x: hidden;
      }

      .manage-page {
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(16, 185, 129, 0.08), transparent 30%),
          linear-gradient(180deg, #f8fafc 0%, #f3f4f6 100%);
        color: #0f172a;
      }

      .shell {
        width: 100%;
        max-width: 980px;
        margin: 0 auto;
        padding: 12px;
        padding-bottom: calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 24px);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }

      .topbar-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .stack {
        display: grid;
        gap: 14px;
      }

      .hero-card,
      .card,
      .row-card,
      .empty-box {
        min-width: 0;
        border-radius: 24px;
        border: 1px solid #e5e7eb;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 38px rgba(15, 23, 42, 0.06);
      }

      .hero-card,
      .card {
        padding: 16px;
      }

      .hero-main {
        display: grid;
        gap: 14px;
      }

      .hero-image,
      .hero-image-fallback {
        width: 100%;
        height: 220px;
        border-radius: 20px;
        object-fit: cover;
        display: block;
        background: #e5e7eb;
      }

      .hero-image-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #475569;
        font-size: 20px;
        font-weight: 900;
      }

      .hero-copy {
        min-width: 0;
      }

      .eyebrow {
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.35px;
        color: #047857;
      }

      .title {
        margin: 6px 0 0;
        font-size: clamp(24px, 7vw, 34px);
        line-height: 1.05;
        font-weight: 950;
        color: #0f172a;
      }

      .clamp {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .section-title {
        margin: 0;
        font-size: 20px;
        font-weight: 950;
        color: #0f172a;
      }

      .muted {
        margin: 8px 0 0;
        color: #64748b;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .fine-print {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.45;
        color: #64748b;
      }

      .section-head,
      .row-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
      }

      .row-title {
        font-size: 16px;
        font-weight: 950;
        color: #0f172a;
        line-height: 1.3;
      }

      .row-meta {
        margin-top: 4px;
        font-size: 13px;
        color: #64748b;
        line-height: 1.45;
      }

      .pill-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .pill.green {
        color: #065f46;
        border: 1px solid rgba(16, 185, 129, 0.25);
        background: rgba(16, 185, 129, 0.1);
      }

      .pill.amber {
        color: #92400e;
        border: 1px solid rgba(245, 158, 11, 0.25);
        background: rgba(245, 158, 11, 0.12);
      }

      .pill.red {
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.25);
        background: rgba(239, 68, 68, 0.1);
      }

      .pill.gray {
        color: #334155;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
      }

      .status-box {
        margin-top: 14px;
        padding: 14px;
        border-radius: 18px;
      }

      .green-box {
        border: 1px solid rgba(16, 185, 129, 0.28);
        background: rgba(16, 185, 129, 0.08);
      }

      .amber-box {
        border: 1px solid rgba(245, 158, 11, 0.28);
        background: rgba(245, 158, 11, 0.1);
      }

      .gray-box {
        border: 1px solid #e5e7eb;
        background: #f8fafc;
      }

      .status-title {
        font-weight: 950;
        color: #0f172a;
      }

      .status-text {
        margin-top: 6px;
        color: #475569;
        line-height: 1.45;
      }

      .list {
        margin-top: 14px;
        display: grid;
        gap: 12px;
      }

      .row-card {
        padding: 14px;
      }

      .note-box {
        margin-top: 12px;
        padding: 12px;
        border-radius: 16px;
        border: 1px solid #eef2f7;
        background: #f8fafc;
        color: #334155;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .action-row {
        margin-top: 14px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .ghost-btn,
      .primary-btn,
      .secondary-btn,
      .danger-btn {
        appearance: none;
        border: none;
        outline: none;
        cursor: pointer;
        font-weight: 900;
        transition: 0.18s ease;
        min-height: 46px;
        padding: 0 14px;
        border-radius: 14px;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .ghost-btn:disabled,
      .primary-btn:disabled,
      .secondary-btn:disabled,
      .danger-btn:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .ghost-btn {
        border: 1px solid #dbe2ea;
        background: #fff;
        color: #0f172a;
      }

      .primary-btn {
        border: 1px solid rgba(16, 185, 129, 0.32);
        background: linear-gradient(180deg, rgba(16, 185, 129, 0.18), rgba(16, 185, 129, 0.1));
        color: #065f46;
      }

      .secondary-btn {
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #0f172a;
      }

      .danger-btn {
        border: 1px solid rgba(239, 68, 68, 0.28);
        background: #fff;
        color: #991b1b;
      }

      .empty-box {
        padding: 18px;
        border-style: dashed;
      }

      .empty-title {
        font-size: 18px;
        font-weight: 950;
        color: #0f172a;
      }

      .empty-body {
        margin-top: 6px;
        color: #64748b;
        line-height: 1.5;
      }

      .error-box {
        margin-bottom: 12px;
        border-radius: 18px;
        border: 1px solid rgba(239, 68, 68, 0.22);
        background: rgba(254, 242, 242, 0.95);
        color: #991b1b;
        padding: 14px;
        font-weight: 800;
      }

      .skeleton {
        display: grid;
        gap: 12px;
      }

      .skel {
        border-radius: 14px;
        background: #e5e7eb;
      }

      .skel-lg {
        height: 34px;
        width: 60%;
      }

      .skel-md {
        height: 18px;
        width: 88%;
      }

      .top-gap {
        margin-top: 12px;
      }

      @media (min-width: 760px) {
        .shell {
          padding: 16px;
        }

        .hero-main {
          grid-template-columns: 280px minmax(0, 1fr);
          align-items: start;
        }

        .hero-image,
        .hero-image-fallback {
          height: 220px;
        }
      }

      @media (max-width: 560px) {
        .shell {
          padding-left: 10px;
          padding-right: 10px;
        }

        .action-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .action-row > * {
          width: 100%;
          min-width: 0;
        }

        .topbar-actions {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
        }

        .topbar-actions > * {
          width: 100%;
        }
      }
    `}</style>
  );
}