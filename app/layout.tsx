import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/ServiceWorker";
import { StatusScrim } from "@/components/StatusScrim";

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

// og:image has to be an ABSOLUTE url — relative paths are silently dropped by every
// scraper. metadataBase is what lets Next resolve "/og.png" into one. Overridable so a
// preview deploy advertises its own card rather than production's.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://amatri-production.up.railway.app";

const TITLE = "Trifecta — First light to finish line";
const DESCRIPTION =
  "Train for the longest day. An adaptive, day-by-day triathlon plan for Olympic, 70.3, and the full Ironman 140.6 — built around your race, your level, and your PRs.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  applicationName: "Trifecta",
  title: TITLE,
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  // Without these, a link shared into iMessage/Slack/Discord/X is a bare grey URL.
  // `summary_large_image` is load-bearing: without it Discord renders an 80x80
  // thumbnail instead of the card. See scripts/gen-og.mjs for the artwork.
  openGraph: {
    type: "website",
    siteName: "Trifecta",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Trifecta — first light to finish line" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Trifecta",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-icon.png?v=3", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // per-scheme, so the iOS status bar and browser chrome follow the theme instead of
  // staying white above a dark app
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0e" },
  ],
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
        {/* masks the notch inset so scrolling content never collides with the clock.
            A component, not a bare div: it has to track the visual viewport, which iOS
            moves out from under fixed elements whenever the keyboard opens. */}
        <StatusScrim />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
