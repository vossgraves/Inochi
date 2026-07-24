import { BrandMark } from "../../components/brand-mark";

export default function DashboardLoading() {
  return <div className="route-state" role="status" aria-live="polite">
    <div className="route-state-mark"><BrandMark state="pending" /></div>
    <span className="eyebrow mono">Connecting to Discord</span>
    <h1>Finding your servers</h1>
    <p>Inochi is checking your manager permissions and loading the latest progression state.</p>
    <div className="route-skeleton" aria-hidden="true"><i /><i /><i /></div>
  </div>;
}
