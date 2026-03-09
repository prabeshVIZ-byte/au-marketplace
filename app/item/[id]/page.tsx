"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const LOVES_TABLE = "post_likes";

type PostType = "give" | "request";

type ItemRow = {
  id: string;
  title: string;
  description: string | null;

  category: string | null;
  pickup_location: string | null;

  post_type: PostType | null;
  request_group: string | null;
  request_timeframe: string | null;
  request_location: string | null;

  is_anonymous: boolean | null;
  expires_at: string | null;
  photo_url: string | null;
  status: string | null;
  owner_id: string | null;
  hide_interest_count?: boolean | null;
};

type OwnerProfile = {
  full_name: string | null;
  user_role: string | null;
};

function requestGroupLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "logistics") return "Logistics";
  if (k === "services") return "Services";
  if (k === "urgent") return "Urgent";
  if (k === "collaboration") return "Collaboration";
  if (k === "lost & found") return "Lost & Found";
  return "Request";
}

function requestTimeframeLabel(v: string | null) {
  const k = (v ?? "").toLowerCase();
  if (k === "today") return "Today";
  if (k === "this_week") return "This week";
  if (k === "flexible") return "Flexible";
  return "";
}

function giveCategoryLabel(v: string | null) {
  return (v ?? "")
    .split(" ")
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function formatDelist(expiresAt: string | null) {
  if (!expiresAt) return "Open-ended";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "Open-ended";

  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ownerNameLabel(item: ItemRow | null, owner: OwnerProfile | null) {
  if (!item) return "Ashland user";
  if (item.is_anonymous) return "Anonymous";
  const name = (owner?.full_name ?? "").trim();
  return name || "Ashland user";
}

function initials(name: string) {
  const clean = name.trim();
  if (!clean) return "A";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = (params?.id as string) || "";

  const [userId, setUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [item, setItem] = useState<ItemRow | null>(null);
  const [owner, setOwner] = useState<OwnerProfile | null>(null);

  const [loveCount, setLoveCount] = useState(0);
  const [myLoved, setMyLoved] = useState(false);

  const [interestCount, setInterestCount] = useState(0);
  const [offerCount, setOfferCount] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [openImg, setOpenImg] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postType: PostType = (item?.post_type ?? "give") as PostType;

  const isOwner = useMemo(() => {
    return !!userId && !!item?.owner_id && userId === item.owner_id;
  }, [userId, item?.owner_id]);

  const ownerLabel = useMemo(() => ownerNameLabel(item, owner), [item, owner]);

  const subtitle = useMemo(() => {
    if (!item) return "";
    if (postType === "request") {
      return [
        requestGroupLabel(item.request_group),
        item.request_timeframe ? requestTimeframeLabel(item.request_timeframe) : "",
        item.request_location?.trim() ? item.request_location : "",
      ]
        .filter(Boolean)
        .join(" • ");
    }

    return [
      item.category?.trim() ? giveCategoryLabel(item.category) : "",
      item.pickup_location?.trim() ? item.pickup_location : "",
    ]
      .filter(Boolean)
      .join(" • ");
  }, [item, postType]);

  const publicActivityHidden = !!item?.hide_interest_count && !isOwner;

  const activityLabel = useMemo(() => {
    if (!item) return "";
    if (publicActivityHidden) {
      return postType === "give" ? "Requests hidden" : "Offers hidden";
    }
    if (postType === "give") {
      return `${interestCount} request${interestCount === 1 ? "" : "s"}`;
    }
    return `${offerCount} offer${offerCount === 1 ? "" : "s"}`;
  }, [item, publicActivityHidden, postType, interestCount, offerCount]);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function loadEverything(uid: string | null) {
    if (!itemId) return;

    setLoading(true);
    setErr(null);

    try {
      const { data: it, error: itemErr } = await supabase
        .from("items")
        .select(
          "id,title,description,category,pickup_location,post_type,request_group,request_timeframe,request_location,is_anonymous,expires_at,photo_url,status,owner_id,hide_interest_count"
        )
        .eq("id", itemId)
        .single();

      if (itemErr) throw new Error(itemErr.message);

      const loaded = it as ItemRow;
      setItem(loaded);

      if (!loaded.is_anonymous && loaded.owner_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name,user_role")
          .eq("id", loaded.owner_id)
          .maybeSingle();

        setOwner((prof as OwnerProfile) ?? null);
      } else {
        setOwner(null);
      }

      const { count: lovesCount, error: loveCountErr } = await supabase
        .from(LOVES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("item_id", itemId);

      if (!loveCountErr) setLoveCount(lovesCount ?? 0);
      else setLoveCount(0);

      if (uid) {
        const { data: mineLove, error: mineLoveErr } = await supabase
          .from(LOVES_TABLE)
          .select("item_id")
          .eq("item_id", itemId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!mineLoveErr) setMyLoved(!!mineLove);
        else setMyLoved(false);
      } else {
        setMyLoved(false);
      }

      if ((loaded.post_type ?? "give") === "give") {
        const { count, error } = await supabase
          .from("interests")
          .select("*", { count: "exact", head: true })
          .eq("item_id", itemId);

        if (!error) setInterestCount(count ?? 0);
        else setInterestCount(0);

        setOfferCount(0);
      } else {
        const { count, error } = await supabase
          .from("request_offers")
          .select("*", { count: "exact", head: true })
          .eq("request_id", itemId);

        if (!error) setOfferCount(count ?? 0);
        else setOfferCount(0);

        setInterestCount(0);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load post.");
      setItem(null);
      setOwner(null);
      setLoveCount(0);
      setMyLoved(false);
      setInterestCount(0);
      setOfferCount(0);
    } finally {
      setLoading(false);
    }
  }

  async function syncAuthAndLoad() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    setUserId(uid);
    await loadEverything(uid);
  }

  async function toggleLove() {
    if (!item) return;
    if (!userId) {
      router.push("/me");
      return;
    }

    setBusy(true);
    try {
      if (myLoved) {
        const { error } = await supabase
          .from(LOVES_TABLE)
          .delete()
          .eq("item_id", item.id)
          .eq("user_id", userId);

        if (error) throw new Error(error.message);

        setMyLoved(false);
        setLoveCount((c) => Math.max(0, c - 1));
      } else {
        const { error } = await supabase.from(LOVES_TABLE).insert([
          {
            item_id: item.id,
            user_id: userId,
          },
        ]);

        if (error) throw new Error(error.message);

        setMyLoved(true);
        setLoveCount((c) => c + 1);
      }
    } catch (e: any) {
      showToast(e?.message || "Could not update love.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCountVisibility() {
    if (!item || !isOwner || !userId) return;

    const nextValue = !item.hide_interest_count;
    setBusy(true);
    setMenuOpen(false);

    try {
      const { error } = await supabase
        .from("items")
        .update({ hide_interest_count: nextValue })
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      setItem((prev) => (prev ? { ...prev, hide_interest_count: nextValue } : prev));
      showToast(nextValue ? "Count hidden ✅" : "Count shown ✅", "ok");
    } catch (e: any) {
      showToast(e?.message || "Could not update count visibility.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function deleteListing() {
    if (!item || !isOwner || !userId) return;

    setBusy(true);
    try {
      if (postType === "give") {
        await supabase.from("interests").delete().eq("item_id", item.id);
      } else {
        await supabase.from("request_offers").delete().eq("request_id", item.id);
      }

      await supabase.from(LOVES_TABLE).delete().eq("item_id", item.id);

      const { error } = await supabase
        .from("items")
        .delete()
        .eq("id", item.id)
        .eq("owner_id", userId);

      if (error) throw new Error(error.message);

      showToast("Listing deleted ✅", "ok");
      router.replace("/feed");
    } catch (e: any) {
      showToast(e?.message || "Could not delete listing.", "err");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  useEffect(() => {
    syncAuthAndLoad();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      await loadEverything(uid);
    });

    return () => sub.subscription.unsubscribe();
  }, [itemId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setOpenImg(null);
        setConfirmDelete(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="page">
      <div className="shell">
        <header className="topBar">
          <button className="iconBtn" onClick={() => router.back()} aria-label="Back">
            ←
          </button>

          <div className="topCenter">
            <div className="topTitle">Post</div>
            <div className="topSub">scholarswap</div>
          </div>

          <div className="topRightSpace" />
        </header>

        {err && <div className="alert err">{err}</div>}
        {loading && <div className="alert">Loading…</div>}

        {!loading && item && (
          <section className="card">
            <div className="cardTop">
              <div className="authorSide">
                <div className="avatar">{initials(ownerLabel)}</div>

                <div className="authorText">
                  <div className="authorName">{ownerLabel}</div>
                  {subtitle ? <div className="authorSub">{subtitle}</div> : null}
                </div>
              </div>

              {isOwner ? (
                <div className="menuWrap">
                  {menuOpen ? (
                    <button
                      className="menuBackdrop"
                      aria-label="Close menu"
                      onClick={() => setMenuOpen(false)}
                    />
                  ) : null}

                  <button
                    className="menuBtn"
                    type="button"
                    aria-label="Post options"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    ⋯
                  </button>

                  {menuOpen ? (
                    <div className="menuCard">
                      <button
                        className="menuItem"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          router.push(`/edit/${item.id}/edit`);
                        }}
                      >
                        Edit post
                      </button>

                      <button className="menuItem" type="button" onClick={toggleCountVisibility}>
                        {item.hide_interest_count ? "Show count" : "Hide count"}
                      </button>

                      <button
                        className="menuItem danger"
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDelete(true);
                        }}
                      >
                        Delete listing
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  className={`loveBtn ${myLoved ? "active" : ""}`}
                  type="button"
                  onClick={toggleLove}
                  disabled={busy}
                  aria-label="Love post"
                >
                  {myLoved ? "♥" : "♡"}
                </button>
              )}
            </div>

            <div className="mediaWrap">
              {item.photo_url ? (
                <button className="imgBtn" type="button" onClick={() => setOpenImg(item.photo_url!)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.photo_url} alt={item.title} className="heroImg" />
                </button>
              ) : (
                <div className="noPhoto">No image</div>
              )}
            </div>

            <div className="body">
              <div className="titleRow">
                <h1 className="title">{item.title}</h1>

                {!isOwner ? (
                  <button
                    className={`loveBtn small ${myLoved ? "active" : ""}`}
                    type="button"
                    onClick={toggleLove}
                    disabled={busy}
                    aria-label="Love post"
                  >
                    {myLoved ? "♥" : "♡"}
                  </button>
                ) : null}
              </div>

              <div className="statsRow">
                <span className="stat">
                  <span className="statIcon">♥</span> {loveCount}
                </span>

                <span className="dot">•</span>

                <span className="stat">{activityLabel}</span>

                <span className="dot">•</span>

                <span className="stat">Delists {formatDelist(item.expires_at)}</span>
              </div>

              {item.description?.trim() ? (
                <div className="caption">
                  <span className="captionName">{ownerLabel}</span> {item.description.trim()}
                </div>
              ) : null}

              {postType === "request" ? (
                <div className="requestInfo">
                  {item.request_timeframe ? (
                    <span className="infoPill">{requestTimeframeLabel(item.request_timeframe)}</span>
                  ) : null}
                  {item.request_location?.trim() ? (
                    <span className="infoPill">{item.request_location.trim()}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>

      {confirmDelete ? (
        <div className="modal" onClick={() => setConfirmDelete(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete listing?</div>
            <div className="modalText">This permanently removes the post.</div>

            <div className="modalActions">
              <button className="ghostBtn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="dangerBtn" onClick={deleteListing} disabled={busy}>
                {busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openImg && item ? (
        <div className="imgModal" onClick={() => setOpenImg(null)}>
          <div className="imgCard" onClick={(e) => e.stopPropagation()}>
            <div className="imgTop">
              <div className="imgTitle">{item.title}</div>
              <button className="iconGhost" onClick={() => setOpenImg(null)}>
                ✕
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openImg} alt={item.title} className="imgFull" />
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className={`toast ${toast.kind === "err" ? "err" : "ok"}`}>{toast.msg}</div>
      ) : null}

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f6f7fb;
          color: #0f172a;
          padding: 12px 12px 28px;
        }

        .shell {
          max-width: 760px;
          margin: 0 auto;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          grid-template-columns: 42px 1fr 42px;
          align-items: center;
          gap: 10px;
          padding: 6px 0 12px;
          background: rgba(246, 247, 251, 0.9);
          backdrop-filter: blur(12px);
        }

        .iconBtn,
        .iconGhost {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
        }

        .topCenter {
          text-align: center;
          min-width: 0;
        }

        .topTitle {
          font-size: 16px;
          font-weight: 1000;
          line-height: 1.1;
        }

        .topSub {
          margin-top: 2px;
          font-size: 12px;
          color: #64748b;
          font-weight: 700;
        }

        .topRightSpace {
          width: 42px;
          height: 42px;
        }

        .alert {
          margin: 8px 0 0;
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 11px 13px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
        }

        .alert.err {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #9f1239;
        }

        .card {
          margin-top: 8px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.05);
        }

        .cardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px;
          border-bottom: 1px solid #eef2f7;
        }

        .authorSide {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .avatar {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          border: 1px solid #dbe3f0;
          background: linear-gradient(135deg, #e0e7ff 0%, #dbeafe 100%);
          font-size: 12px;
          font-weight: 1000;
          flex: 0 0 auto;
        }

        .authorText {
          min-width: 0;
        }

        .authorName {
          font-size: 13px;
          font-weight: 1000;
          line-height: 1.1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .authorSub {
          margin-top: 4px;
          font-size: 11px;
          color: #64748b;
          font-weight: 700;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .menuWrap {
          position: relative;
          flex: 0 0 auto;
        }

        .menuBtn,
        .loveBtn {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
          font-size: 22px;
          line-height: 1;
          font-weight: 900;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .loveBtn.active {
          color: #dc2626;
          border-color: #fecaca;
          background: #fff5f5;
        }

        .loveBtn.small {
          width: 34px;
          height: 34px;
          font-size: 19px;
        }

        .menuBackdrop {
          position: fixed;
          inset: 0;
          background: transparent;
          border: 0;
          padding: 0;
          margin: 0;
        }

        .menuCard {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 190px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.14);
          z-index: 30;
        }

        .menuItem {
          width: 100%;
          border: 0;
          background: #fff;
          text-align: left;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 900;
          color: #0f172a;
          cursor: pointer;
        }

        .menuItem + .menuItem {
          border-top: 1px solid #eef2f7;
        }

        .menuItem.danger {
          color: #b91c1c;
        }

        .mediaWrap {
          background: #f8fafc;
        }

        .imgBtn {
          display: block;
          width: 100%;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: zoom-in;
        }

        .heroImg {
          width: 100%;
          height: 420px;
          object-fit: cover;
          display: block;
        }

        .noPhoto {
          height: 220px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }

        .body {
          padding: 14px 14px 16px;
        }

        .titleRow {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .title {
          margin: 0;
          font-size: 22px;
          line-height: 1.08;
          font-weight: 1000;
          letter-spacing: -0.04em;
          overflow-wrap: anywhere;
          flex: 1;
          min-width: 0;
        }

        .statsRow {
          margin-top: 10px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          color: #475569;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.4;
        }

        .stat {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .statIcon {
          color: #dc2626;
        }

        .dot {
          color: #cbd5e1;
        }

        .caption {
          margin-top: 12px;
          font-size: 13px;
          line-height: 1.58;
          color: #334155;
          white-space: pre-wrap;
        }

        .captionName {
          color: #0f172a;
          font-weight: 1000;
        }

        .requestInfo {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .infoPill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 900;
        }

        .modal,
        .imgModal {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(15, 23, 42, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .modalCard,
        .imgCard {
          width: 100%;
          max-width: 520px;
          border-radius: 22px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 30px 80px rgba(15, 23, 42, 0.18);
        }

        .modalCard {
          padding: 16px;
        }

        .modalTitle {
          font-size: 16px;
          font-weight: 1000;
          color: #0f172a;
        }

        .modalText {
          margin-top: 8px;
          font-size: 13px;
          color: #475569;
          font-weight: 700;
          line-height: 1.45;
        }

        .modalActions {
          margin-top: 14px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .ghostBtn,
        .dangerBtn {
          border-radius: 14px;
          padding: 10px 13px;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .ghostBtn {
          border: 1px solid #e5e7eb;
          background: #fff;
          color: #0f172a;
        }

        .dangerBtn {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
        }

        .imgTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .imgTitle {
          font-size: 13px;
          font-weight: 1000;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .imgFull {
          display: block;
          width: 100%;
          max-height: 80vh;
          object-fit: contain;
          background: #111827;
        }

        .toast {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 120;
          max-width: calc(100vw - 24px);
          padding: 10px 13px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.14);
        }

        .toast.ok {
          border-color: #bbf7d0;
        }

        .toast.err {
          border-color: #fecdd3;
        }

        @media (max-width: 560px) {
          .heroImg {
            height: 320px;
          }

          .title {
            font-size: 20px;
          }

          .authorSub {
            white-space: normal;
          }

          .statsRow {
            gap: 6px;
          }

          .dot {
            display: none;
          }

          .stat {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}