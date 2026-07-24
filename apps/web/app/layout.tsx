import type { Metadata, Viewport } from "next";
import { MotionController } from "../components/motion-controller";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Inochi / Discord progression", template: "%s / Inochi" },
  description: "A precise, expressive, self-hosted Discord leveling system with configurable curves, rank cards, games, rewards, and portable data.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  openGraph: { title: "Inochi / Discord progression", description: "Leveling with a pulse. Own the curve, the data, and the experience.", type: "website", siteName: "Inochi" },
  twitter: { card: "summary_large_image", title: "Inochi / Discord progression", description: "Leveling with a pulse. Own the curve, the data, and the experience." },
};

export const viewport: Viewport = { themeColor: "#080a18", colorScheme: "dark", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<MotionController /></body></html>;
}
