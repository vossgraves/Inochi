import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inochi / Discord leveling",
  description: "A configurable, self-hosted Discord leveling system.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
