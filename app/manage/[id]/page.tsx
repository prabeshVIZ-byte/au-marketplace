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
  is_claimed?: boolean | null;
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
  requester_confirmed_at: string | null;
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

function timeAgo(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return "—";

  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

function normStatus(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function toneForStatus(
  status: string | null | undefined
): "green" | "amber" | "red" | "gray" | "blue" {
  const s = normStatus(status);
  if (["completed", "claimed"].includes(s)) return "green";
  if (["accepted"].includes(s)) return "blue";
  if (["pending", "hold", "available", "open"].includes(s)) return "amber";
  if (["declined", "expired", "closed", "cancelled"].includes(s)) return "red";
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

function initialsOf(name: string) {
  const clean = name.trim();
  if (!clean) return "AU";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "AU";
}

function postTypeLabel(postType: PostType | null | undefined) {
  if (postType === "request") return "Request";
  if (postType === "event") return "Event";
  return "Give";
}

function phaseForInterest(
  row: InterestRow
): "pending" | "awaiting_reply" | "talking" | "closed" | "completed" {
  const s = normStatus(row.status);

  if (s === "pending") return "pending";
  if (s === "accepted" && !row.requester_confirmed_at) return "awaiting_reply";
  if (s === "accepted" && row.requester_confirmed_at) return "talking";
  if (s === "completed") return "completed";
  return "closed";
}

function phaseLabel(phase: ReturnType<typeof phaseForInterest>) {
  if (phase === "pending") return "New request";
  if (phase === "awaiting_reply") return "Invitation sent";
  if (phase === "talking") return "In conversation";
  if (phase === "completed") return "Item received";
  return "Closed";
}

function phaseTone(
  phase: ReturnType<typeof phaseForInterest>
): "green" | "amber" | "red" | "gray" | "blue" {
  if (phase === "pending") return "amber";
  if (phase === "awaiting_reply") return "blue";
  if (phase === "talking") return "green";
  if (phase === "completed") return "green";
  return "gray";
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
  const [busyDeclineId, setBusyDeclineId] = useState<string | null>(null);
  const [busyHandoffId, setBusyHandoffId] = useState<string | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  const [busyRequestClose, setBusyRequestClose] = useState<"completed" | "closed" | null>(null);

  const postType = (item?.post_type ?? "give") as PostType;
  const isGivePost = postType === "give";
  const isRequestPost = postType === "request";
  const itemStatus = normStatus(item?.status) || (isRequestPost ? "open" : "available");
  const itemFinished = ["claimed", "completed"].includes(itemStatus);

  const isRequestClosed = isRequestPost && ["completed", "closed", "cancelled"].includes(itemStatus);

  const pendingInterests = useMemo(
    () => interests.filter((x) => phaseForInterest(x) === "pending"),
    [interests]
  );

  const awaitingReplyInterests = useMemo(
    () => interests.filter((x) => phaseForInterest(x) === "awaiting_reply"),
    [interests]
  );

  const talkingInterests = useMemo(
    () => interests.filter((x) => phaseForInterest(x) === "talking"),
    [interests]
  );

  const closedInterests = useMemo(
    () => interests.filter((x) => ["closed", "completed"].includes(phaseForInterest(x))),
    [interests]
  );

  const pendingOffers = useMemo(
    () => offers.filter((x) => normStatus(x.status) === "pending" || normStatus(x.status) === "hold"),
    [offers]
  );

  const acceptedOffers = useMemo(
    () => offers.filter((x) => normStatus(x.status) === "accepted"),
    [offers]
  );

  const closedOffers = useMemo(
    () => offers.filter((x) => ["declined", "completed"].includes(normStatus(x.status))),
    [offers]
  );

  const pendingOfferCount = pendingOffers.length;
  const activeOfferCount = pendingOffers.length + acceptedOffers.length;
  const closedOfferCount = closedOffers.length;

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
            "id,title,description,status,created_at,owner_id,reserved_interest_id,reserved_at,claimed_at,photo_url,post_type,is_claimed"
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
            "id,item_id,user_id,status,earliest_pickup,time_window,note,created_at,accepted_at,accepted_expires_at,requester_confirmed_at,reserved_at,completed_at"
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
    if (!item || !isGivePost || itemFinished) return;

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
        body: `✅ The lister invited you to continue this conversation about "${item.title}". Please let them know whether you are still interested.`,
      });

      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || "Could not invite this requester.");
    } finally {
      setBusyAcceptId(null);
    }
  }

  async function declineInterest(interest: InterestRow) {
    if (!item || !isGivePost || itemFinished) return;

    const current = normStatus(interest.status);
    const ok = window.confirm(
      current === "accepted"
        ? "End consideration for this requester?"
        : "Decline this request?"
    );
    if (!ok) return;

    setErr(null);
    setBusyDeclineId(interest.id);

    try {
      const { error } = await supabase
        .from("interests")
        .update({ status: "declined" })
        .eq("id", interest.id)
        .in("status", ["pending", "accepted"]);

      if (error) throw new Error(error.message);

      try {
        const threadId = await ensureThread({
          itemId: item.id,
          ownerId: item.owner_id,
          requesterId: interest.user_id,
        });

        await insertSystemMessage({
          threadId,
          senderId: item.owner_id,
          body: `This conversation has been closed by the lister. "${item.title}" is no longer being coordinated here.`,
        });
      } catch {
        // best effort
      }

      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || "Could not update this requester.");
    } finally {
      setBusyDeclineId(null);
    }
  }

  async function openInterestChat(interest: InterestRow) {
    if (!item || !viewerId || !isGivePost) return;

    setErr(null);
    setBusyChatId(interest.id);

    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: interest.user_id,
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setErr(e?.message || "Could not open chat.");
    } finally {
      setBusyChatId(null);
    }
  }

  async function confirmHandoff(interest: InterestRow) {
    if (!item || !isGivePost || itemFinished) return;

    const ok = window.confirm(
      `Confirm handoff to this requester?\n\nThis will mark "${item.title}" as given, close the listing, and notify the other active requesters that it is no longer available.`
    );
    if (!ok) return;

    setErr(null);
    setBusyHandoffId(interest.id);

    try {
      const activeOthers = interests.filter(
        (x) => x.id !== interest.id && normStatus(x.status) === "accepted"
      );

      const { error } = await supabase.rpc("confirm_handoff", {
        p_interest_id: interest.id,
      });

      if (error) throw new Error(error.message);

      for (const other of activeOthers) {
        try {
          const threadId = await ensureThread({
            itemId: item.id,
            ownerId: item.owner_id,
            requesterId: other.user_id,
          });

          await insertSystemMessage({
            threadId,
            senderId: item.owner_id,
            body: `This item has already been given to someone else, so this conversation is now closed.`,
          });
        } catch {
          // best effort
        }
      }

      try {
        const winnerThreadId = await ensureThread({
          itemId: item.id,
          ownerId: item.owner_id,
          requesterId: interest.user_id,
        });

        await insertSystemMessage({
          threadId: winnerThreadId,
          senderId: item.owner_id,
          body: `✅ The handoff has been confirmed. This item has now been marked as given.`,
        });
      } catch {
        // best effort
      }

      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || "Could not confirm handoff.");
    } finally {
      setBusyHandoffId(null);
    }
  }

  async function updateOfferStatus(offer: OfferRow, next: OfferStatus) {
    if (!item || !isRequestPost || isRequestClosed) return;

    setErr(null);
    setBusyOfferId(offer.id);

    try {
      const current = normStatus(offer.status);
      const nowIso = new Date().toISOString();

      if (current === next) {
        await loadAll(true);
        return;
      }

      const { error } = await supabase
        .from("request_offers")
        .update({ status: next, updated_at: nowIso })
        .eq("id", offer.id);

      if (error) throw new Error(error.message);

      if (next === "accepted") {
        const normalizedItemStatus = normStatus(item.status) || "open";

        if (["closed", "completed", "cancelled"].includes(normalizedItemStatus)) {
          throw new Error("This request is already closed.");
        }

        if (!["open", "available", "accepted"].includes(normalizedItemStatus)) {
          const { error: itemErr } = await supabase
            .from("items")
            .update({ status: "open" })
            .eq("id", item.id)
            .eq("owner_id", viewerId);

          if (itemErr) throw new Error(itemErr.message);
        }

        const threadId = await ensureThread({
          itemId: item.id,
          ownerId: item.owner_id,
          requesterId: offer.helper_id,
        });

        await insertSystemMessage({
          threadId,
          senderId: item.owner_id,
          body: `✅ Your help offer was accepted for "${item.title}". You can coordinate here now.`,
        });

        router.push(`/messages/${threadId}`);
        return;
      }

      if (next === "declined") {
        try {
          const threadId = await ensureThread({
            itemId: item.id,
            ownerId: item.owner_id,
            requesterId: offer.helper_id,
          });

          await insertSystemMessage({
            threadId,
            senderId: item.owner_id,
            body: `This request is no longer being coordinated with you.`,
          });
        } catch {
          // best effort
        }
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

  async function closeRequest(nextStatus: "completed" | "closed") {
    if (!item || !isRequestPost || !viewerId || isRequestClosed) return;

    const label =
      nextStatus === "completed" ? "mark this request as fulfilled" : "de-list this request";

    const ok = window.confirm(
      `Are you sure you want to ${label}?\n\nThis will remove it from the active request flow.`
    );
    if (!ok) return;

    setErr(null);
    setBusyRequestClose(nextStatus);

    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("items")
        .update({ status: nextStatus })
        .eq("id", item.id)
        .eq("owner_id", viewerId);

      if (error) throw new Error(error.message);

      if (nextStatus === "closed") {
        const activeOffers = offers.filter((x) =>
          ["pending", "hold", "accepted"].includes(normStatus(x.status))
        );

        if (activeOffers.length > 0) {
          const { error: offersErr } = await supabase
            .from("request_offers")
            .update({
              status: "declined",
              updated_at: nowIso,
            })
            .eq("request_id", item.id)
            .in("status", ["pending", "hold", "accepted"]);

          if (offersErr) throw new Error(offersErr.message);
        }

        for (const offer of activeOffers) {
          try {
            const threadId = await ensureThread({
              itemId: item.id,
              ownerId: item.owner_id,
              requesterId: offer.helper_id,
            });

            await insertSystemMessage({
              threadId,
              senderId: item.owner_id,
              body: `This request has been de-listed by the requester, so this conversation is now closed.`,
            });
          } catch {
            // best effort
          }
        }
      }

      if (nextStatus === "completed") {
        const accepted = offers.filter((x) => normStatus(x.status) === "accepted");
        const otherActive = offers.filter((x) =>
          ["pending", "hold"].includes(normStatus(x.status))
        );

        if (accepted.length > 0) {
          const acceptedIds = accepted.map((x) => x.id);

          const { error: completeAcceptedErr } = await supabase
            .from("request_offers")
            .update({
              status: "completed",
              updated_at: nowIso,
            })
            .in("id", acceptedIds);

          if (completeAcceptedErr) throw new Error(completeAcceptedErr.message);
        }

        if (otherActive.length > 0) {
          const otherIds = otherActive.map((x) => x.id);

          const { error: declineOthersErr } = await supabase
            .from("request_offers")
            .update({
              status: "declined",
              updated_at: nowIso,
            })
            .in("id", otherIds);

          if (declineOthersErr) throw new Error(declineOthersErr.message);
        }

        for (const offer of accepted) {
          try {
            const threadId = await ensureThread({
              itemId: item.id,
              ownerId: item.owner_id,
              requesterId: offer.helper_id,
            });

            await insertSystemMessage({
              threadId,
              senderId: item.owner_id,
              body: `✅ This request has been marked as fulfilled.`,
            });
          } catch {
            // best effort
          }
        }

        for (const offer of otherActive) {
          try {
            const threadId = await ensureThread({
              itemId: item.id,
              ownerId: item.owner_id,
              requesterId: offer.helper_id,
            });

            await insertSystemMessage({
              threadId,
              senderId: item.owner_id,
              body: `This request has already been fulfilled, so this conversation is now closed.`,
            });
          } catch {
            // best effort
          }
        }
      }

      await loadAll(true);
    } catch (e: any) {
      setErr(e?.message || `Could not set request to ${nextStatus}.`);
    } finally {
      setBusyRequestClose(null);
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
            <div className="skel skel-grid" />
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
            ← Back
          </Link>

          <div className="topbar-actions">
            <button
              onClick={() => void loadAll(true)}
              className="ghost-btn"
              type="button"
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>

            <button
              onClick={() => router.push(`/item/${id}`)}
              className="ghost-btn"
              type="button"
            >
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
              <Hero item={item} />
            </section>

            <section className="card">
              <h2 className="section-title">No access</h2>
              <p className="muted">Only the owner of this post can manage it.</p>

              <div className="action-row">
                <button
                  onClick={() => router.push(`/item/${item.id}`)}
                  className="primary-btn"
                  type="button"
                >
                  Open post
                </button>
                <button
                  onClick={() => router.push("/feed")}
                  className="secondary-btn"
                  type="button"
                >
                  Go to feed
                </button>
              </div>
            </section>
          </div>
        ) : wrongPage ? (
          <div className="stack">
            <section className="hero-card">
              <Hero item={item} />
            </section>

            <section className="card">
              <h2 className="section-title">Use an event-specific manager</h2>
              <p className="muted">
                Event attendance and event actions should stay on an event-focused screen so this workflow remains clean.
              </p>

              <div className="action-row">
                <button
                  onClick={() => router.push("/me")}
                  className="primary-btn"
                  type="button"
                >
                  Go to profile
                </button>
                <button
                  onClick={() => router.push("/feed")}
                  className="secondary-btn"
                  type="button"
                >
                  Back to feed
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="stack">
            <section className="hero-card">
              <Hero item={item} />

              <div className="summary-grid">
                <MetricCard
                  label={isRequestPost ? "Request status" : "Post status"}
                  value={item.status ?? (isRequestPost ? "open" : "available")}
                  tone={toneForStatus(item.status)}
                />
                <MetricCard label="Posted" value={fmtShort(item.created_at)} tone="gray" />

                {isGivePost ? (
                  <>
                    <MetricCard
                      label="New requests"
                      value={String(pendingInterests.length)}
                      tone="amber"
                    />
                    <MetricCard
                      label="In conversation"
                      value={String(talkingInterests.length)}
                      tone="green"
                    />
                  </>
                ) : (
                  <>
                    <MetricCard
                      label="Accepted helpers"
                      value={String(acceptedOffers.length)}
                      tone={acceptedOffers.length ? "green" : "gray"}
                    />
                    <MetricCard
                      label="Active offers"
                      value={String(activeOfferCount)}
                      tone={activeOfferCount ? "blue" : "gray"}
                    />
                  </>
                )}
              </div>

              {isGivePost && !itemFinished ? (
                <div className="status-panel">
                  <div className="status-panel-copy">
                    <div className="status-panel-title">Conversation-first marketplace flow</div>
                    <div className="status-panel-text">
                      You can invite multiple requesters into conversation. Their “yes” only unlocks chat. The item stays live until you confirm the handoff.
                    </div>
                  </div>
                </div>
              ) : null}

              {isGivePost && itemFinished ? (
                <div className="status-panel done">
                  <div className="status-panel-copy">
                    <div className="status-panel-title">Handoff completed</div>
                    <div className="status-panel-text">
                      This item has already been marked as given. It should now appear as closed across the feed and your profile.
                    </div>
                  </div>
                </div>
              ) : null}

              {isRequestPost && !isRequestClosed ? (
                <div className="status-panel">
                  <div className="status-panel-copy">
                    <div className="status-panel-title">Request controls</div>
                    <div className="status-panel-text">
                      You can accept multiple helpers and talk to multiple people, just like the give flow. When the request is no longer needed, either mark it fulfilled or de-list it.
                    </div>
                  </div>

                  <div className="status-panel-actions">
                    <button
                      onClick={() => void closeRequest("completed")}
                      disabled={busyRequestClose !== null}
                      className="primary-btn"
                      type="button"
                    >
                      {busyRequestClose === "completed" ? "Updating…" : "Request fulfilled"}
                    </button>

                    <button
                      onClick={() => void closeRequest("closed")}
                      disabled={busyRequestClose !== null}
                      className="ghost-danger-btn"
                      type="button"
                    >
                      {busyRequestClose === "closed" ? "Updating…" : "De-list request"}
                    </button>
                  </div>
                </div>
              ) : null}

              {isRequestPost && isRequestClosed ? (
                <div className="status-panel done">
                  <div className="status-panel-copy">
                    <div className="status-panel-title">
                      {itemStatus === "completed" ? "Request fulfilled" : "Request de-listed"}
                    </div>
                    <div className="status-panel-text">
                      This request is no longer active. It should appear in archived/history instead of the active request lists.
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            {isGivePost ? (
              <>
                <section className="card">
                  <SectionHeader
                    title="New requests"
                    body="These people have requested the item but have not been invited into conversation yet."
                    pills={[
                      <Pill
                        key="pending"
                        label={`${pendingInterests.length} pending`}
                        tone={pendingInterests.length ? "amber" : "gray"}
                      />,
                    ]}
                  />

                  {pendingInterests.length === 0 ? (
                    <EmptyState
                      title="No new requests"
                      body="When someone requests this item, they will appear here."
                    />
                  ) : (
                    <div className="request-grid">
                      {pendingInterests.map((request) => {
                        const profile = profilesById[request.user_id];
                        const name = readableName(profile, request.user_id);

                        return (
                          <InterestCard
                            key={request.id}
                            name={name}
                            subtitle={`Requested ${timeAgo(request.created_at)}`}
                            phase={phaseForInterest(request)}
                            note={request.note}
                            pickup={request.earliest_pickup}
                            windowText={request.time_window}
                            actions={
                              <>
                                <button
                                  onClick={() => void acceptInterest(request.id)}
                                  disabled={itemFinished || busyAcceptId !== null}
                                  className="primary-btn"
                                  type="button"
                                >
                                  {busyAcceptId === request.id ? "Inviting…" : "Invite to chat"}
                                </button>

                                <button
                                  onClick={() => void declineInterest(request)}
                                  disabled={itemFinished || busyDeclineId === request.id}
                                  className="secondary-btn"
                                  type="button"
                                >
                                  {busyDeclineId === request.id ? "Updating…" : "Decline"}
                                </button>
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="Awaiting reply"
                    body="You have invited these requesters into conversation, but they have not yet confirmed they are still interested."
                    pills={[
                      <Pill
                        key="awaiting"
                        label={`${awaitingReplyInterests.length} awaiting`}
                        tone={awaitingReplyInterests.length ? "blue" : "gray"}
                      />,
                    ]}
                  />

                  {awaitingReplyInterests.length === 0 ? (
                    <EmptyState
                      title="No pending replies"
                      body="Once you invite someone to chat, they will appear here until they respond."
                    />
                  ) : (
                    <div className="request-grid">
                      {awaitingReplyInterests.map((request) => {
                        const profile = profilesById[request.user_id];
                        const name = readableName(profile, request.user_id);

                        return (
                          <InterestCard
                            key={request.id}
                            name={name}
                            subtitle={
                              request.accepted_at
                                ? `Invited ${timeAgo(request.accepted_at)}`
                                : "Invited recently"
                            }
                            phase={phaseForInterest(request)}
                            note={request.note}
                            pickup={request.earliest_pickup}
                            windowText={request.time_window}
                            actions={
                              <>
                                <button
                                  onClick={() => void openInterestChat(request)}
                                  disabled={busyChatId === request.id}
                                  className="secondary-btn"
                                  type="button"
                                >
                                  {busyChatId === request.id ? "Opening…" : "Open chat"}
                                </button>

                                <button
                                  onClick={() => void declineInterest(request)}
                                  disabled={itemFinished || busyDeclineId === request.id}
                                  className="ghost-danger-btn"
                                  type="button"
                                >
                                  {busyDeclineId === request.id ? "Updating…" : "End consideration"}
                                </button>
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="In conversation"
                    body="These requesters confirmed they are still interested. Continue in chat, then confirm the handoff when the item has actually been given."
                    pills={[
                      <Pill
                        key="talking"
                        label={`${talkingInterests.length} active`}
                        tone={talkingInterests.length ? "green" : "gray"}
                      />,
                    ]}
                  />

                  {talkingInterests.length === 0 ? (
                    <EmptyState
                      title="No active conversations"
                      body="Once a requester confirms they are still interested, they will appear here."
                    />
                  ) : (
                    <div className="request-grid">
                      {talkingInterests.map((request) => {
                        const profile = profilesById[request.user_id];
                        const name = readableName(profile, request.user_id);

                        return (
                          <InterestCard
                            key={request.id}
                            name={name}
                            subtitle={
                              request.requester_confirmed_at
                                ? `Confirmed interest ${timeAgo(request.requester_confirmed_at)}`
                                : "Confirmed interest"
                            }
                            phase={phaseForInterest(request)}
                            note={request.note}
                            pickup={request.earliest_pickup}
                            windowText={request.time_window}
                            highlight
                            actions={
                              <>
                                <button
                                  onClick={() => void openInterestChat(request)}
                                  disabled={busyChatId === request.id}
                                  className="secondary-btn"
                                  type="button"
                                >
                                  {busyChatId === request.id ? "Opening…" : "Open chat"}
                                </button>

                                <button
                                  onClick={() => void declineInterest(request)}
                                  disabled={itemFinished || busyDeclineId === request.id}
                                  className="ghost-danger-btn"
                                  type="button"
                                >
                                  {busyDeclineId === request.id ? "Updating…" : "End consideration"}
                                </button>

                                <button
                                  onClick={() => void confirmHandoff(request)}
                                  disabled={itemFinished || busyHandoffId !== null}
                                  className="primary-btn strong"
                                  type="button"
                                >
                                  {busyHandoffId === request.id ? "Confirming…" : "Confirm handoff"}
                                </button>
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="Closed activity"
                    body="Requests that were declined, expired, or completed are kept here for reference."
                    pills={[
                      <Pill
                        key="closed"
                        label={`${closedInterests.length} closed`}
                        tone="gray"
                      />,
                    ]}
                  />

                  {closedInterests.length === 0 ? (
                    <EmptyState
                      title="No closed activity"
                      body="Once requests are closed out, they will appear here."
                    />
                  ) : (
                    <div className="request-grid">
                      {closedInterests.map((request) => {
                        const profile = profilesById[request.user_id];
                        const name = readableName(profile, request.user_id);

                        return (
                          <InterestCard
                            key={request.id}
                            name={name}
                            subtitle={
                              request.completed_at
                                ? `Completed ${timeAgo(request.completed_at)}`
                                : `Last updated ${timeAgo(request.accepted_at ?? request.created_at)}`
                            }
                            phase={phaseForInterest(request)}
                            note={request.note}
                            pickup={request.earliest_pickup}
                            windowText={request.time_window}
                            actions={
                              <button
                                onClick={() => void openInterestChat(request)}
                                disabled={busyChatId === request.id}
                                className="secondary-btn"
                                type="button"
                              >
                                {busyChatId === request.id ? "Opening…" : "Open thread"}
                              </button>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            ) : null}

            {isRequestPost ? (
              <>
                <section className="card">
                  <SectionHeader
                    title="Accepted helpers"
                    body="These helpers are currently accepted for this request. You can coordinate with multiple people at the same time."
                    pills={[
                      <Pill
                        key="accepted"
                        label={`Accepted: ${acceptedOffers.length}`}
                        tone={acceptedOffers.length ? "green" : "gray"}
                      />,
                    ]}
                  />

                  {acceptedOffers.length === 0 ? (
                    <EmptyState
                      title="No accepted helpers yet"
                      body="Accept any helper offer below to start coordinating in chat."
                    />
                  ) : (
                    <div className="request-grid">
                      {acceptedOffers.map((offer) => {
                        const name = readableName(offer.helper, offer.helper_id);
                        const busy = busyOfferId === offer.id || busyChatId === offer.id;

                        return (
                          <div key={offer.id} className="request-card highlight">
                            <div className="request-card-top">
                              <div className="identity-block">
                                <div className="avatar-shell">{initialsOf(name)}</div>
                                <div>
                                  <div className="request-title">{name}</div>
                                  <div className="request-subtitle">
                                    Accepted helper
                                    {offer.availability ? ` • Availability: ${offer.availability}` : ""}
                                  </div>
                                </div>
                              </div>

                              <Pill label="accepted" tone="green" />
                            </div>

                            <div className="note-surface">
                              {offer.note?.trim() ? offer.note : "No note provided."}
                            </div>

                            <div className="action-row">
                              <button
                                onClick={() => void openHelperChat(offer)}
                                disabled={busy}
                                className="primary-btn"
                                type="button"
                              >
                                {busyChatId === offer.id ? "Opening…" : "Open chat"}
                              </button>

                              <button
                                onClick={() => void updateOfferStatus(offer, "declined")}
                                disabled={busy || isRequestClosed}
                                className="ghost-danger-btn"
                                type="button"
                              >
                                Remove helper
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="Incoming helper offers"
                    body="Accept as many helpers as you want. This request stays active until you mark it fulfilled or de-list it."
                    pills={[
                      <Pill
                        key="pending"
                        label={`Pending: ${pendingOfferCount}`}
                        tone={pendingOfferCount ? "amber" : "gray"}
                      />,
                      <Pill
                        key="total"
                        label={`Total: ${offers.length}`}
                        tone={offers.length ? "blue" : "gray"}
                      />,
                    ]}
                  />

                  {pendingOffers.length === 0 ? (
                    <EmptyState
                      title="No pending helper offers"
                      body="When someone offers help on this request post, they will appear here."
                    />
                  ) : (
                    <div className="request-grid">
                      {pendingOffers.map((offer) => {
                        const name = readableName(offer.helper, offer.helper_id);
                        const status = (offer.status ?? "pending") as OfferStatus;
                        const busy = busyOfferId === offer.id || busyChatId === offer.id;

                        return (
                          <div key={offer.id} className="request-card">
                            <div className="request-card-top">
                              <div className="identity-block">
                                <div className="avatar-shell">{initialsOf(name)}</div>
                                <div>
                                  <div className="request-title">{name}</div>
                                  <div className="request-subtitle">
                                    Offered {fmtWhen(offer.created_at)}
                                    {offer.availability ? ` • Availability: ${offer.availability}` : ""}
                                  </div>
                                </div>
                              </div>

                              <Pill label={status} tone={toneForStatus(status)} />
                            </div>

                            <div className="note-surface">
                              {offer.note?.trim() ? offer.note : "No note provided."}
                            </div>

                            <div className="action-row">
                              <button
                                onClick={() => void updateOfferStatus(offer, "accepted")}
                                disabled={busy || isRequestClosed}
                                className="primary-btn"
                                type="button"
                              >
                                {busyOfferId === offer.id ? "Working…" : "Accept helper"}
                              </button>

                              <button
                                onClick={() => void updateOfferStatus(offer, "declined")}
                                disabled={busy || isRequestClosed}
                                className="danger-btn"
                                type="button"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="Closed helper activity"
                    body="Declined or completed helper offers remain here for reference."
                    pills={[
                      <Pill
                        key="closed"
                        label={`Closed: ${closedOfferCount}`}
                        tone="gray"
                      />,
                    ]}
                  />

                  {closedOffers.length === 0 ? (
                    <EmptyState
                      title="No closed helper activity"
                      body="Declined and completed offers will show here."
                    />
                  ) : (
                    <div className="request-grid">
                      {closedOffers.map((offer) => {
                        const name = readableName(offer.helper, offer.helper_id);
                        const status = (offer.status ?? "declined") as OfferStatus;
                        const canOpen = status === "completed";

                        return (
                          <div key={offer.id} className="request-card">
                            <div className="request-card-top">
                              <div className="identity-block">
                                <div className="avatar-shell">{initialsOf(name)}</div>
                                <div>
                                  <div className="request-title">{name}</div>
                                  <div className="request-subtitle">
                                    Last updated {fmtWhen(offer.updated_at ?? offer.created_at)}
                                  </div>
                                </div>
                              </div>

                              <Pill label={status} tone={toneForStatus(status)} />
                            </div>

                            <div className="note-surface">
                              {offer.note?.trim() ? offer.note : "No note provided."}
                            </div>

                            {canOpen ? (
                              <div className="action-row">
                                <button
                                  onClick={() => void openHelperChat(offer)}
                                  disabled={busyChatId === offer.id}
                                  className="secondary-btn"
                                  type="button"
                                >
                                  {busyChatId === offer.id ? "Opening…" : "Open thread"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card">
                  <SectionHeader
                    title="Request guidance"
                    body="This request flow now mirrors the give flow more closely."
                  />

                  <div className="note-surface">
                    <strong>Request lifecycle:</strong> open/available → accept one or more helpers → fulfilled or de-listed.
                    {"\n\n"}
                    <strong>Request fulfilled</strong> means the help happened and the request should move to archived.
                    {"\n"}
                    <strong>De-list request</strong> means you no longer need help, so it should also leave the active feed.
                    {"\n\n"}
                    Accepted helpers can stay in parallel chats until you finish the request.
                  </div>
                </section>
              </>
            ) : null}
          </div>
        )}
      </div>

      <PageStyles />
    </div>
  );
}

function Hero({ item }: { item: Item }) {
  return (
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
          <Pill
            label={`Status: ${item.status ?? (item.post_type === "request" ? "open" : "—")}`}
            tone={toneForStatus(item.status)}
          />
          <Pill label={`Posted: ${fmtWhen(item.created_at)}`} tone="gray" />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  body,
  pills,
}: {
  title: string;
  body: string;
  pills?: React.ReactNode[];
}) {
  return (
    <div className="section-head">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="muted">{body}</p>
      </div>

      {pills?.length ? <div className="pill-row">{pills}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "red" | "gray" | "blue";
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function InterestCard({
  name,
  subtitle,
  phase,
  note,
  pickup,
  windowText,
  actions,
  highlight = false,
}: {
  name: string;
  subtitle: string;
  phase: ReturnType<typeof phaseForInterest>;
  note: string | null;
  pickup: string | null;
  windowText: string | null;
  actions: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`request-card ${highlight ? "highlight" : ""}`}>
      <div className="request-card-top">
        <div className="identity-block">
          <div className="avatar-shell">{initialsOf(name)}</div>
          <div>
            <div className="request-title">{name}</div>
            <div className="request-subtitle">{subtitle}</div>
          </div>
        </div>

        <div className="pill-row">
          <Pill label={phaseLabel(phase)} tone={phaseTone(phase)} />
          {pickup ? <Pill label={`Pickup: ${pickup}`} tone="gray" /> : null}
          {windowText ? <Pill label={`Window: ${windowText}`} tone="gray" /> : null}
        </div>
      </div>

      <div className="note-surface">{note?.trim() ? note : "No note provided."}</div>

      <div className="action-row">{actions}</div>
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
  tone?: "green" | "amber" | "red" | "gray" | "blue";
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
          radial-gradient(circle at top, rgba(16, 185, 129, 0.08), transparent 28%),
          linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        color: #0f172a;
      }

      .shell {
        width: 100%;
        max-width: 1180px;
        margin: 0 auto;
        padding: 14px;
        padding-bottom: calc(var(--bottom-nav-height, 86px) + env(safe-area-inset-bottom) + 28px);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }

      .topbar-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .stack {
        display: grid;
        gap: 16px;
      }

      .hero-card,
      .card,
      .request-card,
      .empty-box {
        min-width: 0;
        border-radius: 28px;
        border: 1px solid rgba(226, 232, 240, 0.9);
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(10px);
        box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
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
        height: 240px;
        border-radius: 22px;
        object-fit: cover;
        display: block;
        background: #e5e7eb;
      }

      .hero-image-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #475569;
        font-size: 22px;
        font-weight: 950;
      }

      .hero-copy {
        min-width: 0;
      }

      .eyebrow {
        font-size: 12px;
        font-weight: 950;
        text-transform: uppercase;
        letter-spacing: 0.32px;
        color: #047857;
      }

      .title {
        margin: 6px 0 0;
        font-size: clamp(26px, 6vw, 38px);
        line-height: 1.03;
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
        font-size: 21px;
        font-weight: 950;
        color: #0f172a;
      }

      .muted {
        margin: 8px 0 0;
        color: #64748b;
        line-height: 1.52;
        overflow-wrap: anywhere;
      }

      .section-head,
      .request-card-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 14px;
        flex-wrap: wrap;
      }

      .summary-grid {
        margin-top: 16px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .metric-card {
        border-radius: 20px;
        padding: 14px;
        border: 1px solid rgba(226, 232, 240, 0.9);
        background: #f8fafc;
      }

      .metric-card.green {
        border-color: rgba(16, 185, 129, 0.2);
        background: rgba(16, 185, 129, 0.08);
      }

      .metric-card.amber {
        border-color: rgba(245, 158, 11, 0.2);
        background: rgba(245, 158, 11, 0.08);
      }

      .metric-card.red {
        border-color: rgba(239, 68, 68, 0.2);
        background: rgba(239, 68, 68, 0.08);
      }

      .metric-card.blue {
        border-color: rgba(59, 130, 246, 0.2);
        background: rgba(59, 130, 246, 0.08);
      }

      .metric-label {
        font-size: 12px;
        font-weight: 900;
        color: #64748b;
      }

      .metric-value {
        margin-top: 6px;
        font-size: 17px;
        font-weight: 950;
        color: #0f172a;
        line-height: 1.2;
      }

      .status-panel {
        margin-top: 16px;
        border-radius: 22px;
        border: 1px solid rgba(16, 185, 129, 0.18);
        background: linear-gradient(180deg, rgba(236, 253, 245, 0.94), rgba(240, 253, 250, 0.9));
        padding: 16px;
        display: grid;
        gap: 12px;
      }

      .status-panel.done {
        border-color: rgba(148, 163, 184, 0.18);
        background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(241, 245, 249, 0.94));
      }

      .status-panel-title {
        font-size: 16px;
        font-weight: 950;
        color: #0f172a;
      }

      .status-panel-text {
        margin-top: 6px;
        color: #475569;
        line-height: 1.5;
      }

      .status-panel-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .request-grid {
        margin-top: 16px;
        display: grid;
        gap: 12px;
      }

      .request-card {
        padding: 14px;
      }

      .request-card.highlight {
        border-color: rgba(16, 185, 129, 0.24);
        box-shadow: 0 18px 42px rgba(16, 185, 129, 0.08);
      }

      .identity-block {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .avatar-shell {
        width: 44px;
        height: 44px;
        border-radius: 999px;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #10b981, #34d399);
        color: #ffffff;
        font-size: 13px;
        font-weight: 950;
        flex-shrink: 0;
        box-shadow: 0 10px 22px rgba(16, 185, 129, 0.18);
      }

      .request-title {
        font-size: 16px;
        font-weight: 950;
        color: #0f172a;
        line-height: 1.25;
      }

      .request-subtitle {
        margin-top: 4px;
        font-size: 13px;
        color: #64748b;
        line-height: 1.45;
      }

      .note-surface {
        margin-top: 12px;
        padding: 12px 13px;
        border-radius: 18px;
        border: 1px solid #eef2f7;
        background: linear-gradient(180deg, #f8fafc 0%, #f8fafc 100%);
        color: #334155;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
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
        padding: 0 11px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }

      .pill.green {
        color: #065f46;
        border: 1px solid rgba(16, 185, 129, 0.24);
        background: rgba(16, 185, 129, 0.1);
      }

      .pill.amber {
        color: #92400e;
        border: 1px solid rgba(245, 158, 11, 0.24);
        background: rgba(245, 158, 11, 0.1);
      }

      .pill.red {
        color: #991b1b;
        border: 1px solid rgba(239, 68, 68, 0.24);
        background: rgba(239, 68, 68, 0.1);
      }

      .pill.blue {
        color: #1d4ed8;
        border: 1px solid rgba(59, 130, 246, 0.22);
        background: rgba(59, 130, 246, 0.1);
      }

      .pill.gray {
        color: #334155;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
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
      .danger-btn,
      .ghost-danger-btn {
        appearance: none;
        border: none;
        outline: none;
        cursor: pointer;
        font-weight: 900;
        transition: 0.18s ease;
        min-height: 46px;
        padding: 0 14px;
        border-radius: 15px;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .ghost-btn:disabled,
      .primary-btn:disabled,
      .secondary-btn:disabled,
      .danger-btn:disabled,
      .ghost-danger-btn:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .ghost-btn {
        border: 1px solid #dbe2ea;
        background: #fff;
        color: #0f172a;
      }

      .primary-btn {
        border: 1px solid rgba(16, 185, 129, 0.28);
        background: linear-gradient(180deg, rgba(16, 185, 129, 0.18), rgba(16, 185, 129, 0.1));
        color: #065f46;
      }

      .primary-btn.strong {
        box-shadow: 0 12px 28px rgba(16, 185, 129, 0.12);
      }

      .secondary-btn {
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #0f172a;
      }

      .danger-btn {
        border: 1px solid rgba(239, 68, 68, 0.24);
        background: #fff;
        color: #991b1b;
      }

      .ghost-danger-btn {
        border: 1px solid rgba(239, 68, 68, 0.18);
        background: rgba(254, 242, 242, 0.6);
        color: #991b1b;
      }

      .empty-box {
        padding: 20px;
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
        border: 1px solid rgba(239, 68, 68, 0.2);
        background: rgba(254, 242, 242, 0.96);
        color: #991b1b;
        padding: 14px;
        font-weight: 800;
      }

      .skeleton {
        display: grid;
        gap: 12px;
      }

      .skel {
        border-radius: 16px;
        background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 37%, #e5e7eb 63%);
        background-size: 400% 100%;
        animation: shimmer 1.4s ease infinite;
      }

      .skel-lg {
        height: 34px;
        width: 52%;
      }

      .skel-md {
        height: 18px;
        width: 84%;
      }

      .skel-grid {
        height: 220px;
        width: 100%;
      }

      .top-gap {
        margin-top: 12px;
      }

      @keyframes shimmer {
        0% {
          background-position: 100% 0;
        }
        100% {
          background-position: 0 0;
        }
      }

      @media (min-width: 760px) {
        .shell {
          padding: 18px;
        }

        .hero-main {
          grid-template-columns: 320px minmax(0, 1fr);
          align-items: start;
        }

        .hero-image,
        .hero-image-fallback {
          height: 260px;
        }

        .summary-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .request-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 560px) {
        .shell {
          padding-left: 10px;
          padding-right: 10px;
        }

        .topbar-actions {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
        }

        .topbar-actions > * {
          width: 100%;
        }

        .action-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .action-row > * {
          width: 100%;
          min-width: 0;
        }

        .action-row > .primary-btn.strong {
          grid-column: 1 / -1;
        }

        .request-card-top,
        .section-head {
          flex-direction: column;
        }
      }
    `}</style>
  );
}
