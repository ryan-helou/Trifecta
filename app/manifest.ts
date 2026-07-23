import type { MetadataRoute } from "next";

// Static content — force-static so it can be emitted during `output: 'export'`
// (the bundled app build) as well as served normally on Railway.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trifecta — First light to finish line",
    short_name: "Trifecta",
    description:
      "Train for the longest day — an adaptive, day-by-day plan of swim, bike, and run workouts for Olympic, 70.3, and the full Ironman 140.6.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
