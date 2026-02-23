"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const items = [
    { href: "/feed", label: "Feed", icon: "🏠" },
    { href: "/create", label: "List", icon: "➕" },
    { href: "/my-items", label: "My", icon: "📦" },
    { href: "/me", label: "Account", icon: "👤" },
  ];

  return (
    <div
      // wrapper prevents weird layout shifts + keeps it truly fixed
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        pointerEvents: "none", // IMPORTANT: only the inner nav receives clicks
      }}
    >
      <footer
        style={{
          pointerEvents: "auto",
          width: "100%",
          background: "rgba(2,6,23,0.92)",
          borderTop: "1px solid #0f223f",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          padding: "10px 12px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            maxWidth: 760,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            alignItems: "center",
          }}
        >
          {items.map((it) => {
            const active = pathname === it.href;

            return (
              <Link
                key={it.href}
                href={it.href}
                style={{
                  height: 56,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                  textDecoration: "none",
                  color: "white",
                  border: active ? "1px solid #16a34a" : "1px solid #334155",
                  background: active ? "rgba(22,163,74,0.18)" : "transparent",
                  fontWeight: 900,
                  gap: 8,
                  userSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 18 }}>{it.icon}</span>
                <span style={{ fontSize: 14 }}>{it.label}</span>
              </Link>
            );
          })}
        </div>
      </footer>
    </div>
  );
}