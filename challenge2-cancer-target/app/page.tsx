import { Dashboard } from "@/components/dashboard";
import { getCancerOptions } from "@/lib/clawbio/cancers";
import { getLatestRun } from "@/lib/runs/persistence";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [cancers, latestRun] = await Promise.all([getCancerOptions(), getLatestRun()]);
  return <Dashboard cancers={cancers} initialRun={latestRun} />;
}
