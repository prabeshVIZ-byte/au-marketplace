"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  created_at?: string | null;
};

type AuthState = "checking" | "allowed" | "denied";

function isAshlandEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@ashland.edu");
}

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function fmtWhen(ts: string | null | undefined) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

function classifyPickup(
  interestStatusRaw: string | null | undefined,
  itemStatusRaw: string | null | undefined
): "active" | "completed" | "ignore" {
  const interestStatus = norm(interestStatusRaw);
  const itemStatus = norm(itemStatusRaw);

  const completedInterestStatuses = new Set(["claimed", "completed"]);
  const activeInterestStatuses = new Set(["accepted", "reserved"]);

  if (itemStatus === "claimed" || completedInterestStatuses.has(interestStatus)) {
    return "completed";
  }

  if (activeInterestStatuses.has(interestStatus)) {
    return "active";
  }

  return "ignore";
}

export default function PickupsPage() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const [authState, setAuthState] = useState<AuthState>("checking");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [rows, setRows] = useState<PickupInterestRow[]>([]);
  const [threadsByItem, setThreadsByItem] = useState<Record<string, string>>({});

  const safeSetState = useCallback((fn: () => void, requestId?: number) => {
    if (!mountedRef.current) return;
    if (typeof requestId === "number" && requestId !== requestIdRef.current) return;
    fn();
  }, []);

  const activePickups = useMemo(() => {
    return rows.filter((row) => classifyPickup(row.status, row.items?.status) === "active");
  }, [rows]);

  const completedPickups = useMemo(() => {
    return rows.filter((row) => classifyPickup(row.status, row.items?.status) === "completed");
  }, [rows]);

  const syncAuth = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message || "Failed to get session.");

    const session = data.session;
    const uid = session?.user?.id ?? null;
    const email = session?.user?.email ?? null;

    return { uid, email };
  }, []);

  const loadPickups = useCallback(
    async (uid: string, requestId: number) => {
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

      if (error) throw new Error(error.message || "Failed to load pickups.");

      const allRows = data ?? [];

      const filtered = allRows.filter((row) => {
        return classifyPickup(row.status, row.items?.status) !== "ignore";
      });

      safeSetState(() => {
        setRows(filtered);
      }, requestId);

      return filtered;
    },
    [safeSetState]
  );

  const loadThreadsForItems = useCallback(
    async (uid: string, itemIds: string[], requestId: number) => {
      const cleanItemIds = uniq(itemIds.filter(Boolean));

      if (cleanItemIds.length === 0) {
        safeSetState(() => {
          setThreadsByItem({});
        }, requestId);
        return;
      }

      const { data, error } = await supabase
        .from("threads")
        .select("id,item_id,created_at")
        .eq("requester_id", uid)
        .in("item_id", cleanItemIds)
        .returns<ThreadMini[]>();

      if (error) {
        safeSetState(() => {
          setThreadsByItem({});
        }, requestId);
        return;
      }

      const map: Record<string, string> = {};

      for (const thread of data ?? []) {
        if (!thread.item_id) continue;
        if (!map[thread.item_id]) {
          map[thread.item_id] = thread.id;
        }
      }

      safeSetState(() => {
        setThreadsByItem(map);
      }, requestId);
    },
    [safeSetState]
  );

  const loadAll = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    safeSetState(() => {
      setLoading(true);
      setErr(null);
    }, requestId);

    try {
      const { uid, email } = await syncAuth();

      if (!uid || !email || !isAshlandEmail(email)) {
        safeSetState(() => {
          setUserId(null);
          setUserEmail(null);
          setRows([]);
          setThreadsByItem({});
          setAuthState("denied");
          setLoading(false);
        }, requestId);
        return;
      }

      safeSetState(() => {
        setUserId(uid);
        setUserEmail(email);
        setAuthState("allowed");
      }, requestId);

      const pickupRows = await loadPickups(uid, requestId);
      const itemIds = pickupRows.map((row) => row.item_id);
      await loadThreadsForItems(uid, itemIds, requestId);

      safeSetState(() => {
        setLoading(false);
      }, requestId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong while loading pickups.";

      safeSetState(() => {
        setErr(message);
        setRows([]);
        setThreadsByItem({});
        setLoading(false);
      }, requestId);
    }
  }, [loadPickups, loadThreadsForItems, safeSetState, syncAuth]);

  useEffect(() => {
    mountedRef.current = true;
    loadAll();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadAll();
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [loadAll]);

  useEffect(() => {
    if (authState === "denied") {
      router.replace("/me");
    }
  }, [authState, router]);

  if (authState === "checking") {
    return (
      <PageShell>
        <TopNotice text="Checking access…" />
      </PageShell>
    );
  }

  if (authState === "denied") {
    return (
      <PageShell>
        <TopNotice text="Redirecting…" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={styles.stickyHeader}>
        <div style={styles.headerRow}>
          <button onClick={() => router.push("/me")} style={styles.ghostButton}>
            ← Account
          </button>

          <button
            onClick={() => router.push("/messages")}
            style={styles.ghostButton}
            aria-label="Open messages"
            title="Messages"
          >
            💬
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={styles.pageTitle}>My pickups</div>
          <div style={styles.pageSubtitle}>
            Items you’ve reserved, accepted, or already picked up.
          </div>
          {userEmail ? (
            <div style={styles.helperText}>Signed in as {userEmail}</div>
          ) : null}
        </div>

        {err ? <div style={styles.errorText}>{err}</div> : null}
        {loading ? <div style={styles.loadingText}>Loading…</div> : null}
      </div>

      <Section title="Active pickups" subtitle="Coordinate pickup details in chat.">
        {activePickups.length === 0 ? (
          <EmptyBox text="No active pickups right now." />
        ) : (
          <div style={styles.cardList}>
            {activePickups.map((row) => {
              const item = row.items;
              const threadId = threadsByItem[row.item_id] ?? null;
              const interestStatus = norm(row.status) || "—";
              const itemStatus = norm(item?.status) || "—";

              return (
                <PickupCard
                  key={row.id}
                  title={item?.title ?? "Unknown item"}
                  photoUrl={item?.photo_url ?? null}
                  meta={`Interest: ${interestStatus} • Item: ${itemStatus} • Requested: ${fmtWhen(
                    row.created_at
                  )}`}
                  location={item?.pickup_location ?? null}
                  onViewItem={() => router.push(`/item/${row.item_id}`)}
                  onChat={threadId ? () => router.push(`/messages/${threadId}`) : undefined}
                  chatDisabled={!threadId}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Completed pickups" subtitle="Items that were already claimed.">
        {completedPickups.length === 0 ? (
          <EmptyBox text="No completed pickups yet." />
        ) : (
          <div style={styles.cardList}>
            {completedPickups.map((row) => {
              const item = row.items;
              const itemStatus = norm(item?.status) || "claimed";

              return (
                <div key={row.id} style={styles.completedCard}>
                  <Thumb photoUrl={item?.photo_url ?? null} label={item?.title ?? "Item"} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.cardTitle}>{item?.title ?? "Unknown item"}</div>
                    <div style={styles.cardMeta}>
                      Status: <b>{itemStatus}</b> • Completed: {fmtWhen(row.created_at)}
                    </div>
                    {item?.pickup_location ? (
                      <div style={styles.cardMeta}>
                        Pickup spot: <b>{item.pickup_location}</b>
                      </div>
                    ) : null}
                  </div>

                  <div style={styles.completedBadge}>✅ Completed</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        padding: 16,
        paddingBottom: 120,
      }}
    >
      {children}
    </div>
  );
}

function TopNotice({ text }: { text: string }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.85,
        fontWeight: 900,
      }}
    >
      {text}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 1000, fontSize: 18 }}>{title}</div>
      <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>{subtitle}</div>
      {children}
    </section>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div style={styles.emptyBox}>
      <div style={{ fontWeight: 900 }}>{text}</div>
    </div>
  );
}

function Thumb({ photoUrl, label }: { photoUrl: string | null; label: string }) {
  return (
    <div style={styles.thumbWrap}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={label} style={styles.thumbImage} />
      ) : (
        <span aria-hidden="true">—</span>
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
  const isChatDisabled = !onChat || !!chatDisabled;

  return (
    <div style={styles.pickupCard}>
      <div style={styles.cardTop}>
        <Thumb photoUrl={photoUrl} label={title} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.cardTitle}>{title}</div>
          <div style={styles.cardMeta}>{meta}</div>
          {location ? (
            <div style={styles.cardMeta}>
              Pickup: <b>{location}</b>
            </div>
          ) : null}
        </div>
      </div>

      <div style={styles.actionRow}>
        <button onClick={onViewItem} style={styles.ghostButton}>
          View item
        </button>

        <button
          onClick={onChat}
          disabled={isChatDisabled}
          aria-label={isChatDisabled ? "Chat unavailable" : "Open chat"}
          title={isChatDisabled ? "Chat not found yet" : "Open chat"}
          style={{
            ...styles.chatButton,
            opacity: isChatDisabled ? 0.72 : 1,
            cursor: isChatDisabled ? "not-allowed" : "pointer",
            background: isChatDisabled ? "rgba(22,163,74,0.10)" : "rgba(22,163,74,0.18)",
          }}
        >
          Open chat 💬
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  stickyHeader: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    background: "rgba(0,0,0,0.92)",
    backdropFilter: "blur(8px)",
    paddingBottom: 12,
    borderBottom: "1px solid #0f223f",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 1000,
  },
  pageSubtitle: {
    opacity: 0.75,
    marginTop: 6,
    fontSize: 13,
  },
  helperText: {
    opacity: 0.6,
    marginTop: 6,
    fontSize: 12,
  },
  errorText: {
    marginTop: 10,
    color: "#f87171",
    fontWeight: 900,
  },
  loadingText: {
    marginTop: 10,
    opacity: 0.8,
  },
  cardList: {
    marginTop: 12,
    display: "grid",
    gap: 12,
  },
  pickupCard: {
    border: "1px solid #0f223f",
    background: "#0b1730",
    borderRadius: 16,
    padding: 14,
  },
  completedCard: {
    border: "1px solid #0f223f",
    background: "#0b1730",
    borderRadius: 16,
    padding: 14,
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  cardTop: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  cardTitle: {
    fontWeight: 1000,
    fontSize: 16,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    opacity: 0.75,
    marginTop: 4,
    fontSize: 12,
  },
  completedBadge: {
    opacity: 0.8,
    fontSize: 12,
    fontWeight: 900,
    flexShrink: 0,
  },
  actionRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 12,
  },
  ghostButton: {
    border: "1px solid #334155",
    background: "transparent",
    color: "white",
    padding: "10px 12px",
    borderRadius: 12,
    cursor: "pointer",
    fontWeight: 900,
  },
  chatButton: {
    border: "1px solid rgba(22,163,74,0.55)",
    color: "white",
    padding: "10px 12px",
    borderRadius: 12,
    fontWeight: 900,
  },
  emptyBox: {
    marginTop: 12,
    border: "1px solid #0f223f",
    background: "#0b1730",
    borderRadius: 16,
    padding: 14,
  },
  thumbWrap: {
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
  },
  thumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
};