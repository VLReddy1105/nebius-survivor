import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { REPORTS_ROOT, RUNS_ROOT } from "@/lib/clawbio/paths";
import { validateRunId } from "@/lib/clawbio/validate";
import type { AnalysisRun, CancerOption, PipelineStage } from "@/types/analysis";

export const CLAWBIO_DISCLAIMER =
  "ClawBio is a research and educational tool. It is not a medical device and does not provide clinical diagnoses. Consult a healthcare professional before making any medical decisions.";

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "expression", label: "1. TCGA Expression", status: "pending" },
  { id: "survival", label: "2. TCGA Survival", status: "pending" },
  { id: "ranking", label: "3. Candidate Ranking", status: "pending" },
  { id: "evidence", label: "4. Target Evidence", status: "pending" },
  { id: "literature", label: "5. Literature / Clinical Evidence", status: "pending" },
  { id: "red_team", label: "6. Red-Team Analysis", status: "pending" },
  { id: "validation", label: "7. Target Validation", status: "pending" },
  { id: "decision", label: "8. Final Decision", status: "pending" },
];

export function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

export function runDirectory(runId: string): string {
  return path.join(RUNS_ROOT, validateRunId(runId));
}

async function atomicJson(pathname: string, value: unknown): Promise<void> {
  const temporary = `${pathname}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, pathname);
}

export async function initializeRun(
  cancer: CancerOption,
  genes: string[],
): Promise<AnalysisRun> {
  const runId = createRunId();
  const now = new Date().toISOString();
  const directory = runDirectory(runId);
  await mkdir(directory, { recursive: false });
  const state: AnalysisRun = {
    schemaVersion: "1.0",
    runId,
    status: "running",
    createdAt: now,
    updatedAt: now,
    config: { cancer, genes },
    health: null,
    stages: PIPELINE_STAGES.map((stage) => ({ ...stage })),
    candidates: genes.map((gene) => ({
      gene,
      status: "pending",
      errors: [],
      artifacts: {},
    })),
    shortlist: [],
    targets: [],
    decisions: [],
    killedTarget: null,
    commands: [],
    errors: [],
    disclaimer: CLAWBIO_DISCLAIMER,
  };
  await atomicJson(path.join(directory, "config.json"), {
    runId,
    createdAt: now,
    cancer,
    genes,
  });
  await saveRun(state);
  return state;
}

export async function saveRun(state: AnalysisRun): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await atomicJson(path.join(runDirectory(state.runId), "state.json"), state);
}

export async function finalizeRunFiles(state: AnalysisRun): Promise<void> {
  const directory = runDirectory(state.runId);
  await atomicJson(path.join(directory, "final.json"), state);
  await atomicJson(path.join(directory, "errors.json"), state.errors);
  await atomicJson(path.join(directory, "commands.json"), state.commands);
}

export async function readRun(runId: string): Promise<AnalysisRun | null> {
  try {
    const content = await readFile(path.join(runDirectory(runId), "state.json"), "utf8");
    return JSON.parse(content) as AnalysisRun;
  } catch {
    return null;
  }
}

export async function getLatestRun(): Promise<AnalysisRun | null> {
  try {
    const entries = (await readdir(RUNS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const runId of entries) {
      const run = await readRun(runId);
      if (run) return run;
    }
  } catch {
    return null;
  }
  return null;
}

export function reportFile(runId: string): string {
  return path.join(REPORTS_ROOT, `${validateRunId(runId)}.md`);
}
