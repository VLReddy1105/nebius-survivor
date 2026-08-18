import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPythonTool, ToolExecutionError } from "./runner";
import { skillScript } from "./paths";
import type { CommandRecord, TrialEvidence, ValidationResult } from "@/types/analysis";

const VALIDATION_SCRIPT = skillScript(
  "target-validation-scorer",
  "target_validation_scorer.py",
);

function phaseNumber(phase: string): number {
  const numbers = phase.match(/\d/g)?.map(Number) ?? [];
  return numbers.length ? Math.max(...numbers) : 0;
}

function validationInput(gene: string, disease: string, trials: TrialEvidence[]) {
  const maxPhase = trials.reduce((maximum, trial) => Math.max(maximum, phaseNumber(trial.phase)), 0);
  const completed = trials.filter((trial) => trial.status === "COMPLETED").length;
  const active = trials.filter((trial) =>
    ["RECRUITING", "ACTIVE_NOT_RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION"].includes(
      trial.status,
    ),
  ).length;
  const clinicalPrecedent = trials.length
    ? {
        source: "ClinicalTrials.gov",
        max_phase: maxPhase,
        trials_active: active,
        trials_completed: completed,
        detail: `${trials.length} records returned by clinical-trial-finder; highest parsed phase ${maxPhase || "not reported"}. Trial status is not interpreted as efficacy or safety.`,
        tier: maxPhase >= 1 ? "T1" : "T2",
      }
    : null;

  return {
    target: gene,
    disease,
    evidence: {
      disease_association: null,
      druggability: null,
      chemical_matter: null,
      clinical_precedent: clinicalPrecedent,
      structural_data: null,
      safety_signals: [],
    },
    evidence_coverage_note:
      "Only fields directly supported by upstream ClawBio outputs are populated. Missing dimensions remain null.",
  };
}

export async function validateTarget(
  gene: string,
  disease: string,
  trials: TrialEvidence[],
  outputDirectory: string,
): Promise<{ result: ValidationResult; record: CommandRecord; inputPath: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const inputPath = path.join(outputDirectory, "validation_input.json");
  await writeFile(inputPath, JSON.stringify(validationInput(gene, disease, trials), null, 2), "utf8");

  const record = await runPythonTool({
    skill: "target-validation-scorer",
    script: VALIDATION_SCRIPT,
    args: ["--input", inputPath, "--output", outputDirectory],
    outputDirectory,
    timeoutMs: 180_000,
  });
  if (record.exitCode !== 0) {
    throw new ToolExecutionError(
      `Target validation failed for ${gene}: ${record.stderr.trim() || `exit code ${record.exitCode}`}`,
      record,
    );
  }
  try {
    const result = JSON.parse(
      await readFile(path.join(outputDirectory, "validation_report.json"), "utf8"),
    ) as ValidationResult;
    return { result, record, inputPath };
  } catch (error) {
    throw new ToolExecutionError(
      `Could not read target validation for ${gene}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      record,
    );
  }
}
