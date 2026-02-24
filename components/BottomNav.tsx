"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const items = [
    { href: "/feed", label: "Feed", icon: "🏠" },
    { href: "/create", label: "List", icon: "➕" },
    { href: "/messages", label: "Messages", icon: "💬" },
    { href: "/my-items", label: "My", icon: "📦" },
    { href: "/me", label: "Account", icon: "👤" },
  ];

  const NAV_HEIGHT = 84;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        height: NAV_HEIGHT,
        pointerEvents: "none",
      }}
    >
      <footer
        style={{
          pointerEvents: "auto",
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          background: "rgba(2,6,23,0.92)",
          borderTop: "1px solid #0f223f",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          padding: "10px 10px",
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            width: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
            alignItems: "center",
          }}
        >
          {items.map((it) => {
            const active = pathname === it.href;

            return (
              <Link
                key={it.href}
                href={it.href}
                aria-label={it.label}
                style={{
                  height: 54,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                  textDecoration: "none",
                  color: "white",
                  border: active ? "1px solid #16a34a" : "1px solid #334155",
                  background: active ? "rgba(22,163,74,0.18)" : "transparent",
                  fontWeight: 900,
                  userSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                  touchAction: "manipulation",
                  padding: "0 10px",
                  minWidth: 0,
                }}
              >
                {/* icon */}
                <span style={{ fontSize: 18, lineHeight: 1 }}>{it.icon}</span>

                {/* label: desktop shows always, mobile shows only for active */}
                <span className={`navLabel ${active ? "showOnMobile" : ""}`}>{it.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Inline CSS so you don't need to touch global files */}
        <style jsx>{`
          .navLabel {
            margin-left: 8px;
            font-size: 13px;
            white-space: nowrap;
          }

          /* Mobile: hide labels by default */
          @media (max-width: 480px) {
            .navLabel {
              display: none;
              margin-left: 0;
            }
            /* Only show label for active tab */
            .showOnMobile {
              display: inline;
              margin-left: 6px;
              font-size: 12px;
              opacity: 0.95;
            }
          }
        `}</style>
      </footer>
    </div>
  );
}