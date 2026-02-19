"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  const [isLoggedIn, setIsLoggedIn] = useState(false);

  async function syncAuth() {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const email = session?.user?.email ?? "";
    const ok = !!session && email.toLowerCase().endsWith("@ashland.edu");
    setIsLoggedIn(ok);
  }

  useEffect(() => {
    syncAuth();
    const { data: sub } = supabase.auth.onAuthStateChange(() => syncAuth());
    return () => sub.subscription.unsubscribe();
  }, []);

  function go(path: string) {
    router.push(path);
  }

  function handleListClick() {
    if (!isLoggedIn) {
      go("/me");       // ✅ logged out -> account/login
      return;
    }
    go("/create");     // ✅ logged in -> create listing
  }

  const activeStyle = (match: (p: string) => boolean) => ({
    background: match(pathname) ? "#052e16" : "transparent",
    border: "1px solid #334155",
    color: "white",
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 900,
    cursor: "pointer",
    width: 180,
  });

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        padding: 16,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(10px)",
        borderTop: "1px solid #0f223f",
        display: "flex",
        justifyContent: "center",
        gap: 12,
        zIndex: 50,
      }}
    >
      <button onClick={() => go("/feed")} style={activeStyle((p) => p === "/feed")}>
        🏠 Feed
      </button>

      <button onClick={handleListClick} style={activeStyle((p) => p === "/create")}>
        ➕ List
      </button>

      <button onClick={() => go("/my-items")} style={activeStyle((p) => p.startsWith("/my-items"))}>
        📦 My
      </button>

      <button onClick={() => go("/me")} style={activeStyle((p) => p.startsWith("/me"))}>
        👤 Account
      </button>
    </div>
  );
}