import "server-only";

import { access, mkdir, writeFile } from "node:fs/promises";

import { reportFile } from "./persistence";
import type { AnalysisRun, CandidateResult, TargetEvidence } from "@/types/analysis";

function format(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return "Unavailable";
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value.toFixed(digits)).toString();
}

function candidateSection(candidate: CandidateResult): string[] {
  const diff = candidate.diffExpression;
  const survival = candidate.survival;
  return [
    `### ${candidate.gene}`,
    "",
    `- Initial status: ${candidate.screening?.status ?? "Insufficient evidence"}`,
    `- Screening points: ${candidate.screening?.totalPoints ?? "Unavailable"}`,
    diff
      ? `- Expression: tumour n=${diff.tumorN}, normal n=${diff.normalN}, log2 difference=${format(diff.log2FoldChange)}, p=${format(diff.pValue)}, scale=${diff.expressionScale}`
      : "- Expression: Unavailable",
    survival
      ? `- Survival: ${survival.endpoints.map((endpoint) => `${endpoint.endpoint} median p=${format(endpoint.median.pValue)}`).join("; ")}`
      : "- Survival: Unavailable",
    "- Exploratory optimal-cutoff p-values are uncorrected for multiple cutoff testing and were not used for screening points.",
    ...(candidate.errors.length ? candidate.errors.map((error) => `- Error: ${error}`) : []),
    "",
  ];
}

function targetSection(target: TargetEvidence, run: AnalysisRun): string[] {
  const decision = run.decisions.find((item) => item.target === target.gene);
  const redTeam = target.redTeam;
  return [
    `## ${target.gene}`,
    "",
    "### Case For",
    "",
    ...(redTeam?.caseFor.length
      ? redTeam.caseFor.map((item) => `- ${item.claim} — ${item.source} via ${item.skill}`)
      : ["- Insufficient evidence"]),
    "",
    "### Case Against",
    "",
    ...(redTeam?.caseAgainst.length
      ? redTeam.caseAgainst.map((item) => `- ${item.claim} — ${item.source} via ${item.skill}`)
      : ["- Insufficient evidence"]),
    "",
    "### TCGA Evidence",
    "",
    ...candidateSection(run.candidates.find((item) => item.gene === target.gene) ?? {
      gene: target.gene,
      status: "failed",
      errors: ["Candidate record unavailable"],
      artifacts: {},
    }),
    "### Clinical Evidence",
    "",
    ...(target.trials.length
      ? target.trials.map(
          (trial) =>
            `- [${trial.nctId}](${trial.url}) — ${trial.title}; status=${trial.status}; phase=${trial.phase || "not reported"}. Status is not interpreted as efficacy.`,
        )
      : ["- Insufficient evidence"]),
    "",
    "### Target Validation",
    "",
    target.validation
      ? `- ClawBio adjusted score: ${target.validation.adjusted_score}; raw scorer tier: ${target.validation.decision}`
      : "- Target-validation-scorer output unavailable.",
    decision
      ? `- Dashboard final decision: **${decision.decision}** (${decision.confidence} confidence; ${decision.scoredDimensions}/5 scorer dimensions populated)`
      : "- Dashboard final decision: Insufficient evidence",
    "",
    "### Sources",
    "",
    ...(target.literature.length
      ? target.literature.map(
          (paper) =>
            `- [PMID ${paper.pmid}](${paper.url}) — ${paper.title} — ${paper.source} — ${paper.verified ? "Verified" : "Unverified"}`,
        )
      : ["- No verified PubMed records returned."]),
    "",
    "### Final Decision",
    "",
    decision?.explanation ?? "Insufficient evidence",
    "",
    `Missing evidence: ${redTeam?.missingEvidence.join("; ") || "Not assessed"}`,
    "",
  ];
}

export function buildMarkdownReport(run: AnalysisRun): string {
  const lines = [
    "# Cancer Target Defense Report",
    "",
    `Cancer: ${run.config.cancer.code} — ${run.config.cancer.name}`,
    `Run ID: ${run.runId}`,
    `Generated: ${run.updatedAt}`,
    "",
    "## Candidate screening",
    "",
    ...run.candidates.flatMap(candidateSection),
    "## Shortlisted targets",
    "",
    run.shortlist.length ? run.shortlist.map((gene) => `- ${gene}`).join("\n") : "Insufficient evidence to shortlist a target.",
    "",
    ...run.targets.flatMap((target) => targetSection(target, run)),
    "## Target Killed",
    "",
    run.killedTarget && run.killedTarget.basis !== "none"
      ? `**${run.killedTarget.target} — ${run.killedTarget.decision}**\n\n${run.killedTarget.killedBecause}\n\nCritical negative evidence:\n${run.killedTarget.criticalNegativeEvidence.map((item) => `- ${item}`).join("\n")}`
      : "No target received a defensible evidence-driven NO-GO in this run. The dashboard does not force a rejection.",
    "",
    "## Limitations",
    "",
    "- TCGA expression and survival are associations and do not establish target causality or therapeutic efficacy.",
    "- Optimal-cutoff survival scans are exploratory and uncorrected for multiple cutoff testing.",
    "- Trial status and phase do not establish efficacy or safety.",
    "- Current omics-target-evidence-mapper output does not provide all ChEMBL, PDB, DepMap, or quantitative Open Targets inputs required by the target-validation-scorer.",
    "- Missing evidence is not scored as negative evidence; the dashboard applies a visible coverage gate.",
    "",
    "## Reproducibility",
    "",
    `- Run configuration: results/runs/${run.runId}/config.json`,
    `- Final structured result: results/runs/${run.runId}/final.json`,
    `- Captured commands: results/runs/${run.runId}/commands.json`,
    ...run.commands.map((command) => `- ${command.skill}: \`${command.commandDisplay}\` (exit ${command.exitCode})`),
    "",
    "## Research-use disclaimer",
    "",
    run.disclaimer,
    "",
  ];
  return lines.join("\n");
}

export async function generateReport(run: AnalysisRun): Promise<string> {
  const pathname = reportFile(run.runId);
  await mkdir(pathname.slice(0, pathname.lastIndexOf("/")), { recursive: true });
  try {
    await access(pathname);
    return pathname;
  } catch {
    await writeFile(pathname, buildMarkdownReport(run), { encoding: "utf8", flag: "wx" });
    return pathname;
  }
}
