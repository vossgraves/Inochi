import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { MotionController } from "../components/motion-controller";
import "./globals.css";

const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.woff2",
  variable: "--font-satoshi",
  display: "swap",
  weight: "300 900",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
  fallback: ["ui-monospace", "monospace"],
});

// Subset to the single codepoint U+547D. 992 bytes, so 命 can be set at display
// size without shipping a CJK font.
const notoSerifJp = localFont({
  src: "./fonts/NotoSerifJP-Inochi-Subset.woff2",
  variable: "--font-noto-serif-jp",
  display: "swap",
  weight: "600",
  fallback: ["serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Inochi / Discord progression", template: "%s / Inochi" },
  description:
    "A self-hosted Discord leveling system. Configure the curve, keep the data, and take it with you.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "Inochi / Discord progression",
    description: "Levels your server owns. One curve, one database, no lock-in.",
    type: "website",
    siteName: "Inochi",
  },
  twitter: {
    card: "summary_large_image",
    title: "Inochi / Discord progression",
    description: "Levels your server owns. One curve, one database, no lock-in.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#14110f" },
  ],
  width: "device-width",
  initialScale: 1,
};

/*
  Runs before first paint. Dark is the default, so :root already holds the ink
  values and this only ever adds .light. An explicit stored choice wins over the
  system preference; with neither stored, the product follows the system and
  falls back to dark.
*/
const themeInit = `(function(){try{var s=localStorage.getItem("inochi-theme");var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");if(t==="light")document.documentElement.classList.add("light");}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satoshi.variable} ${jetbrainsMono.variable} ${notoSerifJp.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        {children}
        <MotionController />
      </body>
    </html>
  );
}
