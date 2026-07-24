import { ImageResponse } from "next/og";

export const alt = "Inochi, leveling with a pulse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f7f8ff", background: "radial-gradient(circle at 78% 15%, #3b2c82 0, transparent 38%), radial-gradient(circle at 12% 90%, #0e5264 0, transparent 38%), #080a18", fontFamily: "sans-serif" }}>
    <div style={{ width: 1030, display: "flex", alignItems: "center", gap: 68 }}>
      <div style={{ width: 292, height: 292, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #7665c7", borderRadius: 72, background: "linear-gradient(145deg, #222958, #101426)", boxShadow: "0 30px 90px #0008" }}>
        <div style={{ position: "absolute", inset: 31, display: "flex", border: "9px solid #8d76ff", borderRightColor: "#25d0f5", borderBottomColor: "#ff77b2", borderRadius: 999 }} />
        <svg viewBox="0 0 109 109" width="165" height="165" style={{ color: "#f7f8ff" }}>
          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M51.75 10.25c.11 1-.06 2.67-.71 4.02-4.47 9.23-17.06 25.98-38.79 38.48"/><path d="M53.5 15c7.12 7 22.89 20.46 30.6 26.65 2.82 2.26 5.65 4.22 9.15 5.72"/><path d="M38.25 40.64c1.76.72 3.84.36 5.65.14 5.4-.66 13.08-1.76 18.48-2.24 1.88-.17 3.54-.23 5.37.21"/><path d="M21.2 54.29c1.01 1.01 1.59 2.26 1.67 3.43.9 3.88 1.77 10.12 2.4 15.89.16 1.43.3 2.79.42 4.04"/><path d="M23.92 56.51c10.83-1.76 15.42-2.18 20.28-2.65 1.78-.17 2.79 1.16 2.49 2.28-1.23 4.63-1.67 9.73-3.48 16.13"/><path d="M26.02 75.17c4.77-.44 9.31-1.17 15.25-1.89 1.17-.14 2.39-.28 3.68-.42"/><path d="M54 54c.61.15 3 1 4.21.87 3.29-.37 17.99-4.02 19.51-4.17 1.52-.15 4.28-.29 3.95 2.89-.43 4.17-2.68 16.92-6 23.84-1.89 3.94-3.18 3.45-6.23.46"/><path d="M57.38 55.38c.87.87 1.8 2 1.8 3.5 0 7.36-.04 24.53-.1 34.13-.02 3.3-.05 5.71-.08 6.51"/>
          </g>
        </svg>
        <span style={{ position: "absolute", left: 20, right: 20, top: 157, height: 10, borderRadius: 99, background: "linear-gradient(90deg, #7c5cff, #25d0f5, #ff77b2)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ color: "#91e9ff", fontSize: 24, letterSpacing: 7, textTransform: "uppercase" }}>Discord progression</span>
        <strong style={{ marginTop: 18, fontSize: 112, lineHeight: .9, letterSpacing: -7 }}>Inochi</strong>
        <span style={{ marginTop: 32, color: "#b9c0da", fontSize: 38 }}>Leveling with a pulse.</span>
      </div>
    </div>
  </div>, size);
}
