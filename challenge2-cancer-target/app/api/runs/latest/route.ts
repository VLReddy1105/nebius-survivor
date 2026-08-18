import { getLatestRun } from "@/lib/runs/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const run = await getLatestRun();
  return run
    ? Response.json(run, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "No completed or in-progress runs found." }, { status: 404 });
}
