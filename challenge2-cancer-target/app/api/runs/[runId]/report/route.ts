import { readFile } from "node:fs/promises";

import { validateRunId } from "@/lib/clawbio/validate";
import { generateReport } from "@/lib/runs/report";
import { readRun, reportFile } from "@/lib/runs/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveRun(context: { params: Promise<{ runId: string }> }) {
  const runId = validateRunId((await context.params).runId);
  const run = await readRun(runId);
  if (!run) throw new Error("Run not found.");
  return run;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const run = await resolveRun(context);
    await generateReport(run);
    return Response.json({
      runId: run.runId,
      downloadUrl: `/api/runs/${run.runId}/report?download=1`,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not generate report." },
      { status: 404 },
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const run = await resolveRun(context);
    await generateReport(run);
    const markdown = await readFile(reportFile(run.runId), "utf8");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="target-defense-${run.runId}.md"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Report not found." },
      { status: 404 },
    );
  }
}
