import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inochi Discord Progression",
    short_name: "Inochi",
    description: "Leveling with a pulse. Own the curve, the data, and the experience.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#080a18",
    theme_color: "#7c5cff",
    icons: [
      { src: "/brand/inochi-app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/inochi-app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
