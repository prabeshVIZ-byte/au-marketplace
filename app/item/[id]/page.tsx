"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ensureThread, insertSystemMessage } from "@/lib/ensureThread";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  // give fields
  category: string | null;
  pickup_location: string | null;

  // request fields
  post_type: PostType;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  // shared
  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
};

type SellerProfile = {
  full_name: string | null;
  user_role: string | null;
};

type MyInterestRow = {
  id: string;
  status: string | null;
};

type OfferStatus = "pending" | "hold" | "accepted" | "completed" | "declined" | "withdrawn";

type OfferRow = {
  id: string;
  request_id: string;
  helper_id: string;
  status: OfferStatus | string;
  availability: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  helper?: { id: string; full_name: string | null; user_role: string | null } | null;
};

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "Until delisted";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Until delisted";

  const now = new Date();
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "Expired";

  const oneDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const dayDiff = Math.round((startOfEnd - startOfToday) / oneDay);

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff < 7) return `in ${dayDiff} days`;

  return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function requestGroupLabel(g: string | null) {
  const k = (g ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  return "Request";
}
function requestTimeframeLabel(t: string | null) {
  const k = (t ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

function offerStatusLabel(s: string | null) {
  const k = (s ?? "pending").toLowerCase();
  if (k === "pending") return "Pending";
  if (k === "hold") return "On hold";
  if (k === "accepted") return "Accepted";
  if (k === "completed") return "Completed";
  if (k === "declined") return "Declined";
  if (k === "withdrawn") return "Withdrawn";
  return k;
}

function statusPillClass(status: string | null) {
  const k = (status ?? "pending").toLowerCase();
  if (k === "accepted") return "pill pillGreen";
  if (k === "hold") return "pill pillBlue";
  if (k === "completed") return "pill pillAmber";
  if (k === "declined" || k === "withdrawn") return "pill pillRed";
  return "pill";
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [seller, setSeller] = useState<SellerProfile | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // GIVE only
  const [interestCount, setInterestCount] = useState(0);
  const [myInterest, setMyInterest] = useState<MyInterestRow | null>(null);

  // REQUEST only
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [myOffer, setMyOffer] = useState<OfferRow | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // GIVE modal
  const [showInterest, setShowInterest] = useState(false);
  const [earliestPickup, setEarliestPickup] = useState<"today" | "tomorrow" | "weekend">("today");
  const [timeWindow, setTimeWindow] = useState<"morning" | "afternoon" | "evening">("afternoon");
  const [note, setNote] = useState("");

  // REQUEST modal
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerAvailability, setOfferAvailability] = useState<"today" | "tomorrow" | "this_week" | "flexible">("today");
  const [offerNote, setOfferNote] = useState("");

  // photo modal
  const [openImg, setOpenImg] = useState<string | null>(null);

  const isLoggedIn = useMemo(() => {
    return !!userId && !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");
  }, [userId, userEmail]);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isMinePost = useMemo(() => {
    return !!userId && !!item?.owner_id && item.owner_id === userId;
  }, [userId, item?.owner_id]);

  const expiryText = formatExpiry(item?.expires_at ?? null);
  const showName = item && !item.is_anonymous && seller?.full_name;

  // derived give
  const myInterestStatus = (myInterest?.status ?? "").toLowerCase();
  const mineInterested = !!myInterest?.id;
  const isAccepted = myInterestStatus === "accepted";
  const isReserved = myInterestStatus === "reserved";

  // derived request
  const myOfferStatus = (myOffer?.status ?? "").toLowerCase();
  const myOfferAccepted = myOfferStatus === "accepted" || myOfferStatus === "completed";

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    setUserId(session?.user?.id ?? null);
    setUserEmail(session?.user?.email ?? null);
  }

  async function loadOffersForRequest(loaded: ItemRow, uid: string | null) {
    if (loaded.post_type !== "request") return;

    // my offer (if logged in)
    if (uid) {
      const { data: mine } = await supabase
        .from("request_offers")
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .eq("request_id", loaded.id)
        .eq("helper_id", uid)
        .maybeSingle();

      setMyOffer((mine as any) ?? null);
    } else {
      setMyOffer(null);
    }

    // requester sees all offers
    if (uid && loaded.owner_id === uid) {
      const { data: all, error } = await supabase
        .from("request_offers")
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .eq("request_id", loaded.id)
        .order("created_at", { ascending: false });

      if (error) {
        setOffers([]);
        return;
      }

      const rows = (all as OfferRow[]) || [];
      const helperIds = Array.from(new Set(rows.map((r) => r.helper_id).filter(Boolean)));

      let profileMap = new Map<string, any>();
      if (helperIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id,full_name,user_role").in("id", helperIds);
        for (const p of (profs as any[]) || []) profileMap.set(p.id, p);
      }

      const merged = rows.map((r) => ({ ...r, helper: profileMap.get(r.helper_id) ?? null }));
      setOffers(merged);
    } else {
      setOffers([]);
    }
  }

  async function loadItem() {
    if (!itemId) return;
    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,is_anonymous,expires_at,photo_url,status,owner_id,post_type,request_group,request_timeframe,request_location"
        )
        .eq("id", itemId)
        .single();

      if (itErr) throw new Error(itErr.message);

      const loaded = it as ItemRow;
      loaded.post_type = (loaded.post_type ?? "give") as PostType;
      setItem(loaded);

      // profile
      const ownerId = loaded.owner_id ?? null;
      const anon = !!loaded.is_anonymous;

      if (!anon && ownerId) {
        const { data: prof } = await supabase.from("profiles").select("full_name,user_role").eq("id", ownerId).single();
        setSeller((prof as SellerProfile) || null);
      } else {
        setSeller(null);
      }

      // auth uid
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;

      if (loaded.post_type === "give") {
        const { count } = await supabase.from("interests").select("*", { count: "exact", head: true }).eq("item_id", itemId);
        setInterestCount(count ?? 0);

        if (uid) {
          const { data: mine, error: mineErr } = await supabase
            .from("interests")
            .select("id,status")
            .eq("item_id", itemId)
            .eq("user_id", uid)
            .maybeSingle();

          if (!mineErr && mine) setMyInterest({ id: (mine as any).id, status: (mine as any).status ?? null });
          else setMyInterest(null);
        } else {
          setMyInterest(null);
        }

        setOffers([]);
        setMyOffer(null);
      } else {
        setInterestCount(0);
        setMyInterest(null);
        await loadOffersForRequest(loaded, uid);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load.");
      setItem(null);
      setSeller(null);
      setMyInterest(null);
      setOffers([]);
      setMyOffer(null);
    } finally {
      setLoading(false);
    }
  }

  // -------------------
  // GIVE FLOW
  // -------------------
  async function submitInterest() {
    if (!item || postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return setMsg("This is your listing.");

    setSaving(true);
    setMsg(null);

    try {
      const { data, error } = await supabase
        .from("interests")
        .insert([
          {
            item_id: item.id,
            user_id: userId,
            status: "pending",
            earliest_pickup: earliestPickup,
            time_window: timeWindow,
            note: note.trim() || null,
          },
        ])
        .select("id,status")
        .single();

      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("duplicate") || m.includes("unique")) {
          setMsg("You already requested this item.");
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyInterest({ id: (data as any).id, status: (data as any).status ?? "pending" });
      setInterestCount((c) => c + 1);
      setMsg("✅ Request sent.");
      setNote("");
      setShowInterest(false);
    } catch (e: any) {
      setMsg(e?.message || "Could not send request.");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawInterest() {
    if (!item || postType !== "give") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest?.status ?? "").toLowerCase();
    if (st === "accepted" || st === "reserved") {
      setMsg("Already accepted/reserved. You can’t withdraw here.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("interests").delete().eq("item_id", item.id).eq("user_id", userId);
      if (error) throw new Error(error.message);

      setMyInterest(null);
      setInterestCount((c) => Math.max(0, c - 1));
      setShowInterest(false);
      setMsg("Removed ✅");
    } catch (e: any) {
      setMsg(e?.message || "Could not remove.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPickupAndChat() {
    if (!item || !userId || !myInterest?.id || postType !== "give") return;
    if (!isLoggedIn) return router.push("/me");
    if (isMinePost) return;

    const st = (myInterest.status ?? "").toLowerCase();
    if (st !== "accepted") return setMsg("Confirm only after seller accepts.");
    if (!item.owner_id) return setMsg("Missing seller id.");

    setSaving(true);
    setMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("confirm_pickup", { p_interest_id: myInterest.id });
      if (rpcErr) throw new Error(rpcErr.message);

      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id,
        requesterId: userId,
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Buyer confirmed pickup. Coordinate a time and place here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setMsg(e?.message || "Could not confirm pickup.");
    } finally {
      setSaving(false);
    }
  }

  // -------------------
  // REQUEST FLOW
  // -------------------
  async function submitOffer() {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (isMinePost) return setMsg("This is your request.");

    setSaving(true);
    setMsg(null);

    try {
      const { data, error } = await supabase
        .from("request_offers")
        .insert([
          {
            request_id: item.id,
            helper_id: userId,
            status: "pending",
            availability: offerAvailability,
            note: offerNote.trim() || null,
          },
        ])
        .select("id,request_id,helper_id,status,availability,note,created_at,updated_at")
        .single();

      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes("duplicate") || m.includes("unique")) {
          setMsg("You already offered help.");
          await loadItem();
          return;
        }
        throw new Error(error.message);
      }

      setMyOffer(data as any);
      setShowOfferModal(false);
      setOfferNote("");
      setMsg("✅ Offer sent.");
    } catch (e: any) {
      setMsg(e?.message || "Could not send offer.");
    } finally {
      setSaving(false);
    }
  }

  async function withdrawOffer() {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!myOffer?.id) return;

    const st = (myOffer.status ?? "").toLowerCase();
    if (st === "accepted" || st === "completed") {
      setMsg("You can’t withdraw after acceptance.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("request_offers").delete().eq("id", myOffer.id).eq("helper_id", userId);
      if (error) throw new Error(error.message);

      setMyOffer(null);
      setMsg("Removed ✅");
      await loadItem();
    } catch (e: any) {
      setMsg(e?.message || "Could not withdraw.");
    } finally {
      setSaving(false);
    }
  }

  async function acceptOfferAsRequester(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("accept_request_offer_keep_others", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadItem();
      setMsg("✅ Accepted. Chat unlocked.");
    } catch (e: any) {
      setMsg(e?.message || "Could not accept.");
    } finally {
      setSaving(false);
    }
  }

  async function setOfferStatusAsRequester(offer: OfferRow, status: OfferStatus) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("request_offers").update({ status }).eq("id", offer.id);
      if (error) throw new Error(error.message);

      await loadItem();
    } catch (e: any) {
      setMsg(e?.message || "Could not update.");
    } finally {
      setSaving(false);
    }
  }

  async function completeOfferAsRequester(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");
    if (!isMinePost) return;

    setSaving(true);
    setMsg(null);

    try {
      const { error: rpcErr } = await supabase.rpc("complete_request_offer", { p_offer_id: offer.id });
      if (rpcErr) throw new Error(rpcErr.message);

      await loadItem();
      setMsg("✅ Marked completed.");
    } catch (e: any) {
      setMsg(e?.message || "Could not complete.");
    } finally {
      setSaving(false);
    }
  }

  async function openChatForOffer(offer: OfferRow) {
    if (!item || postType !== "request") return;
    if (!isLoggedIn || !userId) return router.push("/me");

    const st = (offer.status ?? "").toLowerCase();
    if (st !== "accepted" && st !== "completed") {
      setMsg("Chat unlocks only after acceptance.");
      return;
    }

    if (!item.owner_id) return setMsg("Missing requester id.");

    setSaving(true);
    setMsg(null);

    try {
      const threadId = await ensureThread({
        itemId: item.id,
        ownerId: item.owner_id, // request poster
        requesterId: offer.helper_id, // helper
      });

      await insertSystemMessage({
        threadId,
        senderId: userId,
        body: "✅ Chat opened for an accepted offer. Coordinate details here.",
      });

      router.push(`/messages/${threadId}`);
    } catch (e: any) {
      setMsg(e?.message || "Could not open chat.");
    } finally {
      setSaving(false);
    }
  }

  // initial load + auth
  useEffect(() => {
    (async () => {
      await syncAuth();
      await loadItem();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncAuth();
      loadItem();
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // realtime (give interests)
  useEffect(() => {
    if (!itemId || !userId) return;
    if (postType !== "give") return;

    const channel = supabase
      .channel(`interest-${itemId}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interests", filter: `item_id=eq.${itemId}` }, (payload) => {
        const row: any = payload.new;
        if (row?.user_id === userId) setMyInterest({ id: row.id, status: row.status ?? null });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId, postType]);

  // realtime (request offers)
  useEffect(() => {
    if (!itemId || !userId) return;
    if (postType !== "request") return;

    const channel = supabase
      .channel(`offers-${itemId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "request_offers", filter: `request_id=eq.${itemId}` }, () => {
        loadItem();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [itemId, userId, postType]);

  // esc closes image
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenImg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page">
      <header className="top">
        <button className="back" onClick={() => router.back()}>
          ← Back
        </button>
        <div className="right">
          <button className="ghost" onClick={() => router.push("/feed")}>
            Feed
          </button>
          <button className="ghost" onClick={() => router.push("/me")}>
            Account
          </button>
        </div>
      </header>

      {err && <div className="err">{err}</div>}
      {loading && <div className="loading">Loading…</div>}

      {!loading && item && (
        <main className="wrap">
          <div className="titleRow">
            <h1 className="h1">{item.title}</h1>
            <span className={`tag ${postType === "request" ? "tagReq" : "tagItem"}`}>{postType === "request" ? "REQUEST" : "ITEM"}</span>
          </div>

          <div className="chips">
            {postType === "give" && item.category ? <Chip>Category: {item.category}</Chip> : null}
            {postType === "give" && item.pickup_location ? <Chip>Pickup: {item.pickup_location}</Chip> : null}

            {postType === "request" ? (
              <>
                <Chip>Type: {requestGroupLabel(item.request_group)}</Chip>
                {item.request_timeframe ? <Chip>Timeframe: {requestTimeframeLabel(item.request_timeframe)}</Chip> : null}
                {item.request_location ? <Chip>Location: {item.request_location}</Chip> : null}
              </>
            ) : null}

            <Chip>
              {postType === "give" ? "Lister" : "Poster"}:{" "}
              {item.is_anonymous ? "Anonymous" : showName ? seller!.full_name : "Ashland user"}
              {!item.is_anonymous && seller?.user_role ? ` (${seller.user_role})` : ""}
            </Chip>

            {postType === "give" ? <Chip>{interestCount} requests</Chip> : null}

            <Chip>
              {item.expires_at ? `Auto-archives • ${new Date(item.expires_at).toLocaleDateString()}` : "Active • until delisted"}{" "}
              <span className="muted">({expiryText})</span>
            </Chip>
          </div>

          {/* Media / Request hero */}
          <section className="mediaBlock">
            {postType === "give" ? (
              item.photo_url ? (
                <button className="mediaBtn" onClick={() => setOpenImg(item.photo_url!)} aria-label="Open photo" type="button">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.photo_url} alt={item.title} className="mediaImg" />
                </button>
              ) : (
                <div className="noPhoto">No photo</div>
              )
            ) : (
              <div className="reqHero">
                <div className="reqLine">
                  {requestGroupLabel(item.request_group)}
                  {item.request_timeframe ? ` • ${requestTimeframeLabel(item.request_timeframe)}` : ""}
                  {item.request_location ? ` • ${item.request_location}` : ""}
                </div>
                <div className="reqBody">{item.description || "No extra details provided."}</div>
              </div>
            )}
          </section>

          {/* Description (give only, requests already show in hero) */}
          {postType === "give" && (
            <section className="panel">
              <div className="panelTitle">Description</div>
              <div className="panelBody">{item.description?.trim() ? item.description : "—"}</div>
            </section>
          )}

          {/* REQUEST: offers panel for requester */}
          {postType === "request" && isMinePost && (
            <section className="panel">
              <div className="panelTop">
                <div className="panelTitle">Offers</div>
                <div className="smallMuted">{offers.length} total</div>
              </div>

              {offers.length === 0 ? (
                <div className="smallMuted">No offers yet.</div>
              ) : (
                <div className="offerList">
                  {offers.map((o) => {
                    const st = (o.status ?? "pending").toLowerCase();
                    const helperName = o.helper?.full_name || "Ashland user";
                    const helperRole = o.helper?.user_role ? ` (${o.helper.user_role})` : "";

                    return (
                      <div key={o.id} className="offerCard">
                        <div className="offerTop">
                          <div className="offerName">
                            {helperName}
                            <span className="muted">{helperRole}</span>
                          </div>
                          <span className={statusPillClass(o.status)}>{offerStatusLabel(o.status)}</span>
                        </div>

                        <div className="offerMeta">
                          {o.availability ? `Availability: ${o.availability}` : "Availability: —"}
                        </div>

                        <div className="offerNote">{o.note ? o.note : <span className="muted">No note.</span>}</div>

                        <div className="offerActions">
                          {(st === "pending" || st === "hold") && (
                            <button className="btn primary" onClick={() => acceptOfferAsRequester(o)} disabled={saving}>
                              Accept
                            </button>
                          )}

                          {st === "pending" && (
                            <button className="btn blue" onClick={() => setOfferStatusAsRequester(o, "hold")} disabled={saving}>
                              Hold
                            </button>
                          )}

                          {st === "hold" && (
                            <button className="btn ghost" onClick={() => setOfferStatusAsRequester(o, "pending")} disabled={saving}>
                              Move to pending
                            </button>
                          )}

                          {(st === "accepted" || st === "completed") && (
                            <button className="btn teal" onClick={() => openChatForOffer(o)} disabled={saving}>
                              Open chat
                            </button>
                          )}

                          {st === "accepted" && (
                            <button className="btn amber" onClick={() => completeOfferAsRequester(o)} disabled={saving}>
                              Mark completed
                            </button>
                          )}

                          {(st === "pending" || st === "hold") && (
                            <button className="btn danger" onClick={() => setOfferStatusAsRequester(o, "declined")} disabled={saving}>
                              Decline
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Actions */}
          <section className="actions">
            {postType === "give" ? (
              <>
                <button
                  className={`btn ${isMinePost ? "disabled" : "primary"}`}
                  onClick={() => {
                    if (!isLoggedIn) return router.push("/me");
                    if (isMinePost) return;
                    if (mineInterested) return;
                    setMsg(null);
                    setShowInterest(true);
                  }}
                  disabled={saving || mineInterested || isMinePost || (item.status ?? "available") !== "available"}
                >
                  {isMinePost
                    ? "Your listing"
                    : !isLoggedIn
                    ? "Request (login)"
                    : mineInterested
                    ? isReserved
                      ? "Reserved ✅"
                      : isAccepted
                      ? "Accepted ✅"
                      : "Request sent"
                    : "Request item"}
                </button>

                <button className={`btn ghost ${(!mineInterested || isAccepted || isReserved || isMinePost) ? "disabled" : ""}`}
                  onClick={withdrawInterest}
                  disabled={saving || !mineInterested || isAccepted || isReserved || isMinePost}
                >
                  Withdraw
                </button>

                {isAccepted && !isMinePost && (
                  <button className="btn teal" onClick={confirmPickupAndChat} disabled={saving}>
                    Confirm pickup & chat
                  </button>
                )}
              </>
            ) : (
              <>
                {!isMinePost && (
                  <>
                    <button
                      className={`btn ${myOffer?.id ? "disabled" : "green"}`}
                      onClick={() => {
                        if (!isLoggedIn) return router.push("/me");
                        if (myOffer?.id) return;
                        setMsg(null);
                        setShowOfferModal(true);
                      }}
                      disabled={saving || !!myOffer?.id}
                    >
                      {!isLoggedIn
                        ? "Offer help (login)"
                        : myOffer?.id
                        ? `Offer sent • ${offerStatusLabel(myOffer.status)}`
                        : "Offer help"}
                    </button>

                    {myOffer?.id && (
                      <>
                        {myOfferAccepted ? (
                          <button className="btn teal" onClick={() => openChatForOffer(myOffer)} disabled={saving}>
                            Start chat
                          </button>
                        ) : (
                          <button className="btn ghost" onClick={withdrawOffer} disabled={saving}>
                            Withdraw offer
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {isMinePost && (
                  <button className="btn ghost" onClick={() => router.push("/messages")}>
                    Messages
                  </button>
                )}
              </>
            )}

            <button className="btn ghost" onClick={() => router.push("/me")}>
              Account
            </button>
          </section>

          {msg && !showInterest && !showOfferModal && <div className="toast">{msg}</div>}

          {/* GIVE: Interest modal */}
          {postType === "give" && showInterest && (
            <div className="modal" onClick={() => setShowInterest(false)}>
              <div className="modalInner" onClick={(e) => e.stopPropagation()}>
                <div className="modalTop">
                  <div className="modalTitle">Request this item</div>
                  <button className="x" onClick={() => setShowInterest(false)}>✕</button>
                </div>

                <div className="modalHint">Tell the lister when you can pick up.</div>

                <div className="field">
                  <label>Earliest pickup</label>
                  <select value={earliestPickup} onChange={(e) => setEarliestPickup(e.target.value as any)}>
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="weekend">Weekend</option>
                  </select>
                </div>

                <div className="field">
                  <label>Time window</label>
                  <select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value as any)}>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                </div>

                <div className="field">
                  <label>Optional note</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Example: I can meet at the library after 3pm."
                  />
                </div>

                {msg && <div className="toast">{msg}</div>}

                <div className="modalActions">
                  <button className="btn ghost" onClick={() => setShowInterest(false)}>Cancel</button>
                  <button className="btn teal" onClick={submitInterest} disabled={saving}>
                    {saving ? "Sending…" : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* REQUEST: Offer modal */}
          {postType === "request" && showOfferModal && (
            <div className="modal" onClick={() => setShowOfferModal(false)}>
              <div className="modalInner modalReq" onClick={(e) => e.stopPropagation()}>
                <div className="modalTop">
                  <div className="modalTitle">Offer help</div>
                  <button className="x" onClick={() => setShowOfferModal(false)}>✕</button>
                </div>

                <div className="modalHint">Your offer appears in the requester’s list. Chat unlocks only if accepted.</div>

                <div className="field">
                  <label>Availability</label>
                  <select value={offerAvailability} onChange={(e) => setOfferAvailability(e.target.value as any)}>
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="this_week">This week</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </div>

                <div className="field">
                  <label>Optional note</label>
                  <textarea
                    value={offerNote}
                    onChange={(e) => setOfferNote(e.target.value)}
                    placeholder="Example: I can drive after 5pm. I have room for 2 bags."
                  />
                </div>

                {msg && <div className="toast">{msg}</div>}

                <div className="modalActions">
                  <button className="btn ghost" onClick={() => setShowOfferModal(false)}>Cancel</button>
                  <button className="btn green" onClick={submitOffer} disabled={saving}>
                    {saving ? "Sending…" : "Send offer"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Image modal */}
          {openImg && (
            <div className="imgModal" onClick={() => setOpenImg(null)}>
              <div className="imgInner" onClick={(e) => e.stopPropagation()}>
                <div className="imgTop">
                  <div className="imgTitle">{item.title}</div>
                  <button className="x" onClick={() => setOpenImg(null)}>✕</button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={openImg} alt={item.title} className="imgFull" />
              </div>
            </div>
          )}
        </main>
      )}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #000;
          color: #fff;
          padding: 18px 16px 96px;
        }

        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
          position: sticky;
          top: 0;
          padding: 10px 0;
          background: rgba(0,0,0,0.9);
          backdrop-filter: blur(14px);
          z-index: 20;
          border-bottom: 1px solid rgba(148,163,184,0.12);
        }

        .back {
          background: transparent;
          color: #fff;
          border: 1px solid rgba(148,163,184,0.25);
          padding: 8px 12px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 900;
        }

        .right {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .ghost {
          background: rgba(255,255,255,0.03);
          color: rgba(255,255,255,0.86);
          border: 1px solid rgba(148,163,184,0.25);
          padding: 8px 12px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 900;
        }

        .wrap {
          max-width: 920px;
          margin: 0 auto;
        }

        .err { color: #f87171; font-weight: 800; margin: 10px 0; }
        .loading { opacity: 0.8; font-weight: 800; margin: 10px 0; }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .h1 {
          margin: 0;
          font-size: 36px;
          font-weight: 950;
          letter-spacing: -0.4px;
          line-height: 1.05;
        }

        .tag {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 950;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.86);
          white-space: nowrap;
          margin-top: 6px;
        }
        .tagItem {
          border: 1px solid rgba(52,211,153,0.25);
          background: rgba(16,185,129,0.14);
          color: rgba(209,250,229,0.92);
        }
        .tagReq {
          border: 1px solid rgba(34,197,94,0.25);
          background: rgba(34,197,94,0.12);
          color: rgba(209,250,229,0.92);
        }

        .chips {
          margin-top: 12px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.20);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.88);
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .muted { opacity: 0.75; }

        .mediaBlock {
          margin-top: 14px;
        }

        .mediaBtn {
          padding: 0;
          border: none;
          background: transparent;
          cursor: pointer;
          width: 100%;
        }

        .mediaImg {
          width: 100%;
          height: 420px;
          object-fit: cover;
          border-radius: 16px;
          border: 1px solid rgba(148,163,184,0.18);
          display: block;
        }

        .noPhoto {
          width: 100%;
          height: 240px;
          border-radius: 16px;
          border: 1px dashed rgba(148,163,184,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(148,163,184,0.9);
          font-weight: 900;
        }

        .reqHero {
          width: 100%;
          min-height: 220px;
          border-radius: 16px;
          border: 1px solid rgba(34,197,94,0.22);
          background: linear-gradient(180deg, rgba(34,197,94,0.10), rgba(0,0,0,0.25));
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }

        .reqLine {
          font-weight: 950;
          font-size: 14px;
          opacity: 0.92;
        }

        .reqBody {
          margin-top: 10px;
          opacity: 0.88;
          line-height: 1.55;
          white-space: pre-wrap;
        }

        .panel {
          margin-top: 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(148,163,184,0.16);
          border-radius: 16px;
          padding: 14px;
        }

        .panelTop {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }

        .panelTitle {
          font-weight: 950;
        }

        .panelBody {
          opacity: 0.9;
          line-height: 1.55;
          white-space: pre-wrap;
        }

        .smallMuted {
          font-size: 13px;
          opacity: 0.7;
          font-weight: 900;
        }

        .actions {
          margin-top: 14px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn {
          border-radius: 12px;
          padding: 10px 14px;
          cursor: pointer;
          font-weight: 950;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(255,255,255,0.03);
          color: #fff;
        }

        .btn.disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .btn.primary {
          border: 1px solid rgba(52,211,153,0.25);
          background: rgba(16,185,129,0.18);
        }

        .btn.teal {
          border: 1px solid rgba(16,185,129,0.30);
          background: rgba(16,185,129,0.22);
        }

        .btn.green {
          border: 1px solid rgba(34,197,94,0.30);
          background: rgba(34,197,94,0.18);
        }

        .btn.blue {
          border: 1px solid rgba(59,130,246,0.25);
          background: rgba(59,130,246,0.12);
        }

        .btn.amber {
          border: 1px solid rgba(234,179,8,0.25);
          background: rgba(234,179,8,0.14);
        }

        .btn.danger {
          border: 1px solid rgba(248,113,113,0.30);
          background: rgba(239,68,68,0.08);
          color: rgba(254,202,202,0.95);
        }

        .btn.ghost {
          background: rgba(255,255,255,0.03);
        }

        .toast {
          margin-top: 12px;
          border: 1px solid rgba(148,163,184,0.22);
          border-radius: 12px;
          padding: 10px;
          opacity: 0.92;
          background: rgba(0,0,0,0.35);
        }

        /* Offers */
        .offerList {
          display: grid;
          gap: 10px;
        }

        .offerCard {
          border: 1px solid rgba(148,163,184,0.18);
          border-radius: 14px;
          padding: 12px;
          background: rgba(0,0,0,0.22);
        }

        .offerTop {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .offerName {
          font-weight: 950;
        }

        .offerMeta {
          margin-top: 8px;
          opacity: 0.85;
          font-size: 13px;
          font-weight: 900;
        }

        .offerNote {
          margin-top: 8px;
          opacity: 0.9;
          white-space: pre-wrap;
        }

        .offerActions {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .pill {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 950;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.85);
        }
        .pillGreen { border-color: rgba(34,197,94,0.35); background: rgba(34,197,94,0.14); color: rgba(209,250,229,0.95); }
        .pillBlue { border-color: rgba(59,130,246,0.35); background: rgba(59,130,246,0.14); color: rgba(191,219,254,0.95); }
        .pillAmber { border-color: rgba(234,179,8,0.35); background: rgba(234,179,8,0.12); color: rgba(254,249,195,0.95); }
        .pillRed { border-color: rgba(248,113,113,0.35); background: rgba(239,68,68,0.10); color: rgba(254,202,202,0.95); }

        /* Modals */
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 50;
        }

        .modalInner {
          width: 100%;
          max-width: 520px;
          border-radius: 18px;
          border: 1px solid rgba(148,163,184,0.22);
          background: rgba(2,6,23,1);
          padding: 16px;
        }

        .modalReq {
          border-color: rgba(34,197,94,0.22);
        }

        .modalTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .modalTitle {
          font-size: 18px;
          font-weight: 950;
        }

        .x {
          background: transparent;
          border: 1px solid rgba(148,163,184,0.22);
          color: #fff;
          padding: 6px 10px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 950;
        }

        .modalHint {
          margin-top: 12px;
          opacity: 0.85;
          line-height: 1.45;
        }

        .field {
          margin-top: 12px;
        }

        .field label {
          display: block;
          font-weight: 900;
          margin-bottom: 6px;
        }

        .field select,
        .field textarea {
          width: 100%;
          background: #000;
          color: #fff;
          border: 1px solid rgba(148,163,184,0.22);
          padding: 10px 12px;
          border-radius: 12px;
          outline: none;
        }

        .field textarea {
          min-height: 90px;
          resize: vertical;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        /* Image modal */
        .imgModal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9999;
        }

        .imgInner {
          width: min(1000px, 95vw);
          max-height: 90vh;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(148,163,184,0.18);
          border-radius: 16px;
          overflow: hidden;
        }

        .imgTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(148,163,184,0.15);
        }

        .imgTitle {
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imgFull {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #000;
        }

        @media (max-width: 520px) {
          .h1 { font-size: 28px; }
          .mediaImg { height: 300px; }
        }
      `}</style>
    </div>
  );
}