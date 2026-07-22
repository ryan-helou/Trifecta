import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";

// Fraunces — an editorial high-contrast serif with optical sizing. It carries the
// "chronograph" identity: dial numerals, headlines, the wordmark. Used with
// restraint. opsz + wght are variable, so no weight list is needed.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Geist — a crisp neo-grotesque for body and data. Not Inter; has quiet character.
const body = Geist({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "AmaTri",
  title: "AmaTri — First light to finish line",
  description:
    "Train for the longest day. An adaptive, day-by-day triathlon plan for Olympic, 70.3, and the full Ironman 140.6 — built around your race, your level, and your PRs.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AmaTri",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-icon.png?v=2", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
