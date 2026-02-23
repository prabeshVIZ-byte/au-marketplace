import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AU Marketplace",
  description: "Campus exchange platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{
          margin: 0,
          background: "black",
          color: "white",
        }}
      >
        {/* FULL APP WRAPPER — this is the real fix */}
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Page content fills screen */}
          <main
            style={{
              flex: 1,
              paddingBottom: 120, // room for BottomNav
            }}
          >
            {children}
          </main>

          {/* Fixed bottom navigation */}
          <BottomNav />
        </div>
      </body>
    </html>
  );
}