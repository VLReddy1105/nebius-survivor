import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { runPythonTool, ToolExecutionError } from "./runner";
import { skillScript } from "./paths";
import type { CommandRecord, PaperEvidence, TrialEvidence } from "@/types/analysis";

const EVIDENCE_SCRIPT = skillScript(
  "omics-target-evidence-mapper",
  "omics_target_evidence_mapper.py",
);

export interface MapperOutput {
  evidence: Record<string, unknown>;
  papers: PaperEvidence[];
  trials: TrialEvidence[];
  record: CommandRecord;
}

function mapperPapers(evidence: Record<string, unknown>): PaperEvidence[] {
  const literature = Array.isArray(evidence.literature) ? evidence.literature : [];
  return literature.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const pmid = String(item.pmid ?? "");
    const title = String(item.title ?? "").trim();
    if (!/^\d+$/.test(pmid) || !title) return [];
    return [
      {
        pmid,
        title,
        source: String(item.source ?? "PubMed"),
        publicationDate: typeof item.pubdate === "string" ? item.pubdate : undefined,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        verified: true,
      },
    ];
  });
}

function mapperTrials(evidence: Record<string, unknown>): TrialEvidence[] {
  const trials = Array.isArray(evidence.trials) ? evidence.trials : [];
  return trials.flatMap((value) => {
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
        interventions: [],
        conditions: [],
        url: `https://clinicaltrials.gov/study/${nctId}`,
      },
    ];
  });
}

export async function queryTargetEvidence(
  gene: string,
  disease: string,
  outputDirectory: string,
): Promise<MapperOutput> {
  const record = await runPythonTool({
    skill: "omics-target-evidence-mapper",
    script: EVIDENCE_SCRIPT,
    args: [
      "--gene",
      gene,
      "--disease",
      disease,
      "--max-papers",
      "5",
      "--max-trials",
      "5",
      "--output",
      outputDirectory,
    ],
    outputDirectory,
    timeoutMs: 150_000,
  });
  if (record.exitCode !== 0) {
    throw new ToolExecutionError(
      `Target evidence failed for ${gene}: ${record.stderr.trim() || `exit code ${record.exitCode}`}`,
      record,
    );
  }

  try {
    const evidence = JSON.parse(
      await readFile(path.join(outputDirectory, "evidence.json"), "utf8"),
    ) as Record<string, unknown>;
    return { evidence, papers: mapperPapers(evidence), trials: mapperTrials(evidence), record };
  } catch (error) {
    throw new ToolExecutionError(
      `Could not read target evidence for ${gene}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      record,
    );
  }
}
