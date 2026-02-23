import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AU Marketplace",
  description: "Campus-only free exchange marketplace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "black",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ✅ Content takes remaining height */}
        <main style={{ flex: 1 }}>
          {children}
        </main>

        {/* ✅ Sticky footer (no overlay) */}
        <BottomNav />
      </body>
    </html>
  );
}