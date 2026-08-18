import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { runPythonTool, ToolExecutionError } from "./runner";
import { skillScript } from "./paths";
import type { CommandRecord, TrialEvidence } from "@/types/analysis";

const TRIAL_SCRIPT = skillScript("clinical-trial-finder", "clinical_trial_finder.py");

export async function queryClinicalTrials(
  gene: string,
  disease: string,
  outputDirectory: string,
): Promise<{ trials: TrialEvidence[]; raw: Record<string, unknown>; record: CommandRecord }> {
  const query = `${gene} ${disease}`;
  const record = await runPythonTool({
    skill: "clinical-trial-finder",
    script: TRIAL_SCRIPT,
    args: ["--query", query, "--max-results", "10", "--output", outputDirectory],
    outputDirectory,
    timeoutMs: 180_000,
  });
  if (record.exitCode !== 0) {
    throw new ToolExecutionError(
      `Clinical trial retrieval failed for ${gene}: ${record.stderr.trim() || `exit code ${record.exitCode}`}`,
      record,
    );
  }

  try {
    const raw = JSON.parse(
      await readFile(path.join(outputDirectory, "summary.json"), "utf8"),
    ) as Record<string, unknown>;
    const values = Array.isArray(raw.trials) ? raw.trials : [];
    const trials = values.flatMap((value): TrialEvidence[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const nctId = String(item.nct_id ?? "");
      if (!/^NCT\d{8}$/.test(nctId)) return [];
      return [
        {
          nctId,
          title: String(item.title ?? "Untitled ClinicalTrials.gov record"),
          status: String(item.status ?? "UNKNOWN"),
          phase: String(item.phase ?? ""),
          studyType: typeof item.study_type === "string" ? item.study_type : undefined,
          interventions: Array.isArray(item.interventions)
            ? item.interventions.map(String)
            : [],
          conditions: Array.isArray(item.conditions) ? item.conditions.map(String) : [],
          url: `https://clinicaltrials.gov/study/${nctId}`,
        },
      ];
    });
    return { trials, raw, record };
  } catch (error) {
    throw new ToolExecutionError(
      `Could not read clinical trial output for ${gene}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      record,
    );
  }
}

export function mergeTrials(...collections: TrialEvidence[][]): TrialEvidence[] {
  const byId = new Map<string, TrialEvidence>();
  for (const trial of collections.flat()) {
    const previous = byId.get(trial.nctId);
    byId.set(trial.nctId, {
      ...previous,
      ...trial,
      interventions: trial.interventions.length ? trial.interventions : previous?.interventions ?? [],
      conditions: trial.conditions.length ? trial.conditions : previous?.conditions ?? [],
    });
  }
  return [...byId.values()];
}
