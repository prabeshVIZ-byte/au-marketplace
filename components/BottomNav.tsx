"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/feed", label: "Feed", icon: "🏠" },
  { href: "/create", label: "List", icon: "➕" },
  { href: "/my-items", label: "My", icon: "📦" },
  { href: "/me", label: "Account", icon: "👤" },
];

export default function BottomNav() {
  const pathname = usePathname();

  // Hide nav on home "/" if you ever use it
  const hide = pathname === "/";

  if (hide) return null;

  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        padding: "10px 12px",
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(10px)",
        borderTop: "1px solid #0f223f",
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
        }}
      >
        {tabs.map((t) => {
          const active =
            pathname === t.href || (t.href !== "/feed" && pathname.startsWith(t.href));

          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                textDecoration: "none",
                color: "white",
                border: active ? "1px solid #16a34a" : "1px solid #334155",
                background: active ? "rgba(22,163,74,0.12)" : "transparent",
                borderRadius: 14,
                padding: "10px 10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 900,
              }}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span style={{ opacity: active ? 1 : 0.85 }}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}