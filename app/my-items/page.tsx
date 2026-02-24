"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MyItemsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/me");
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", background: "black", color: "white", padding: 24 }}>
      Redirecting…
    </div>
  );
}