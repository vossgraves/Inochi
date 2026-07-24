"use client";

import { BrandMark } from "../../components/brand-mark";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="route-state route-state-error">
    <div className="route-state-mark"><BrandMark state="error" /></div>
    <span className="eyebrow mono">Signal interrupted</span>
    <h1>Dashboard connection lost</h1>
    <p>Your configuration was not changed. Retry the Discord and database connection when you are ready.</p>
    <button type="button" className="primary" onClick={reset}>Retry connection</button>
  </div>;
}
