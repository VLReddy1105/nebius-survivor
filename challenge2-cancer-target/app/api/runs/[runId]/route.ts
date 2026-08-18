import { readRun } from "@/lib/runs/persistence";
import { validateRunId } from "@/lib/clawbio/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const runId = validateRunId((await context.params).runId);
    const run = await readRun(runId);
    return run
      ? Response.json(run, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Run not found." }, { status: 404 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid run ID." },
      { status: 400 },
    );
  }
}
