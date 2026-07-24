import Link from "next/link";
import { BrandMark } from "../components/brand-mark";

export default function NotFound() {
  return <main className="route-state">
    <div className="route-state-mark"><BrandMark state="paused" /></div>
    <span className="eyebrow mono">404 / pulse not found</span>
    <h1>This path went quiet</h1>
    <p>The page may have moved, but your progression data is untouched.</p>
    <Link className="button primary" href="/">Return to Inochi</Link>
  </main>;
}
