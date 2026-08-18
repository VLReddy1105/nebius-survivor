import { getCancerOptions } from "@/lib/clawbio/cancers";
import { validateAnalysisConfig } from "@/lib/clawbio/validate";
import { runAnalysis } from "@/lib/runs/pipeline";
import type { AnalysisEvent } from "@/types/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request): Promise<Response> {
  let config;
  try {
    const [body, cancers] = await Promise.all([request.json(), getCancerOptions()]);
    config = validateAnalysisConfig(body, cancers);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid analysis request." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let activeRunId = "pending";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: AnalysisEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void runAnalysis(config, (state) => {
        activeRunId = state.runId;
        send({ type: "state", runId: state.runId, state });
      })
        .then((state) => {
          send({ type: "complete", runId: state.runId, state });
        })
        .catch((error) => {
          send({
            type: "error",
            runId: activeRunId,
            message: error instanceof Error ? error.message : "Analysis failed unexpectedly.",
          });
        })
        .finally(() => {
          if (open) controller.close();
          open = false;
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
