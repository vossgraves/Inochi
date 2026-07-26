import { ImageResponse } from "next/og";

export const alt = "Inochi, self-hosted Discord progression";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
  Ink field, one vermilion rule, the seal mark on the left. The previous card
  was a violet-to-cyan-to-pink composition with a gradient bar under the mark.

  next/og has no access to the app's webfonts here, so this stays on the system
  sans rather than shipping a font fetch into image generation.
*/
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14110f",
          color: "#f4f1ea",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ width: 1000, display: "flex", alignItems: "center", gap: 72 }}>
          <div
            style={{
              width: 260,
              height: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "4px solid #d9401f",
              borderRadius: 8,
            }}
          >
            <svg viewBox="0 0 109 109" width="170" height="170">
              <g
                fill="none"
                stroke="#f4f1ea"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M51.75 10.25c.11 1-.06 2.67-.71 4.02-4.47 9.23-17.06 25.98-38.79 38.48" />
                <path d="M53.5 15c7.12 7 22.89 20.46 30.6 26.65 2.82 2.26 5.65 4.22 9.15 5.72" />
                <path d="M38.25 40.64c1.76.72 3.84.36 5.65.14 5.4-.66 13.08-1.76 18.48-2.24 1.88-.17 3.54-.23 5.37.21" />
                <path d="M21.2 54.29c1.01 1.01 1.59 2.26 1.67 3.43.9 3.88 1.77 10.12 2.4 15.89.16 1.43.3 2.79.42 4.04" />
                <path d="M23.92 56.51c10.83-1.76 15.42-2.18 20.28-2.65 1.78-.17 2.79 1.16 2.49 2.28-1.23 4.63-1.67 9.73-3.48 16.13" />
                <path d="M26.02 75.17c4.77-.44 9.31-1.17 15.25-1.89 1.17-.14 2.39-.28 3.68-.42" />
                <path d="M54 54c.61.15 3 1 4.21.87 3.29-.37 17.99-4.02 19.51-4.17 1.52-.15 4.28-.29 3.95 2.89-.43 4.17-2.68 16.92-6 23.84-1.89 3.94-3.18 3.45-6.23.46" />
                <path d="M57.38 55.38c.87.87 1.8 2 1.8 3.5 0 7.36-.04 24.53-.1 34.13-.02 3.3-.05 5.71-.08 6.51" />
              </g>
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ color: "#a8a199", fontSize: 22, letterSpacing: 6, textTransform: "uppercase" }}>
              Self-hosted Discord progression
            </span>
            <strong style={{ marginTop: 20, fontSize: 118, lineHeight: 1, letterSpacing: -5 }}>
              Inochi
            </strong>
            <span style={{ display: "flex", width: 120, height: 5, marginTop: 30, background: "#d9401f" }} />
            <span style={{ marginTop: 30, color: "#cfc9c0", fontSize: 34 }}>
              Levels your server owns.
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
