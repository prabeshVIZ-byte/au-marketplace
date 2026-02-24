"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function MessagesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const isAshland = !!userEmail && userEmail.toLowerCase().endsWith("@ashland.edu");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      setUserEmail(email);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <div style={{ opacity: 0.8 }}>Loading…</div>
      </div>
    );
  }

  if (!isAshland) {
    return (
      <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Messages</h1>
        <p style={{ marginTop: 10, opacity: 0.75, maxWidth: 640 }}>
          Messaging is available after a seller accepts your request. Please log in with your <b>@ashland.edu</b> email to view conversations.
        </p>

        <button
          onClick={() => router.push("/me")}
          style={{
            marginTop: 12,
            borderRadius: 14,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Go to Account
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24, paddingBottom: 110 }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Messages</h1>
      <p style={{ marginTop: 10, opacity: 0.75, maxWidth: 740 }}>
        Conversations appear here only after a seller accepts your request.
      </p>

      <div
        style={{
          marginTop: 16,
          borderRadius: 18,
          border: "1px solid rgba(148,163,184,0.15)",
          background: "rgba(255,255,255,0.04)",
          padding: 14,
        }}
      >
        <div style={{ opacity: 0.7, fontWeight: 900, fontSize: 14 }}>Inbox (coming next)</div>
        <div style={{ marginTop: 8, opacity: 0.65, fontSize: 13 }}>
          Next step: we will load your accepted threads from <code>threads</code> and show item + last message preview.
        </div>
      </div>
    </div>
  );
}