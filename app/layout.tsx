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
  description: "Campus-only free exchange marketplace",
};

const NAV_H = 82;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* ✅ Content wrapper: reserves space for BottomNav */}
        <div style={{ minHeight: "100vh", paddingBottom: NAV_H }}>
          {children}
        </div>

        {/* ✅ Fixed bottom nav */}
        <BottomNav />
      </body>
    </html>
  );
}