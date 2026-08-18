import "server-only";

import path from "node:path";

import { checkXenaHealth, queryDifferentialExpression, querySurvival } from "@/lib/clawbio/xena";
import { queryTargetEvidence } from "@/lib/clawbio/evidence";
import { queryPubMed } from "@/lib/clawbio/pubmed";
import { queryClinicalTrials } from "@/lib/clawbio/trials";
import { validateTarget } from "@/lib/clawbio/validation";
import { ToolExecutionError } from "@/lib/clawbio/runner";
import { toArtifactPath } from "@/lib/clawbio/paths";
import { chooseShortlist, rankCandidates } from "@/lib/science/ranking";
import { applyEvidenceCoverageGate } from "@/lib/science/decision";
import { buildRedTeamAssessment } from "@/lib/science/red-team";
import type {
  AnalysisRun,
  CancerOption,
  FinalDecision,
  KilledTarget,
  StageId,
  StageStatus,
  TargetEvidence,
} from "@/types/analysis";
import {
  finalizeRunFiles,
  initializeRun,
  runDirectory,
  saveRun,
} from "./persistence";
import { generateReport } from "./report";

type StateListener = (state: AnalysisRun) => void | Promise<void>;

async function publish(state: AnalysisRun, listener: StateListener): Promise<void> {
  await saveRun(state);
  await listener(state);
}

function updateStage(
  state: AnalysisRun,
  id: StageId,
  status: StageStatus,
  message: string,
): void {
  const stage = state.stages.find((item) => item.id === id);
  if (!stage) return;
  stage.status = status;
  stage.message = message;
  if (status === "running" && !stage.startedAt) stage.startedAt = new Date().toISOString();
  if (["completed", "failed", "insufficient"].includes(status)) {
    stage.completedAt = new Date().toISOString();
  }
}

function captureError(state: AnalysisRun, error: unknown, context: string): string {
  if (error instanceof ToolExecutionError) state.commands.push(error.record);
  const detail = error instanceof Error ? error.message : "Unknown error";
  const message = `${context}: ${detail}`;
  state.errors.push(message);
  return message;
}

function buildKilledTarget(state: AnalysisRun): KilledTarget {
  const noGo = state.decisions
    .filter((decision) => decision.decision === "NO-GO")
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))[0];
  if (noGo) {
    return {
      target: noGo.target,
      decision: "NO-GO",
      basis: "validation",
      initiallyInteresting: "The target passed the transparent TCGA screening step and entered deeper review.",
      killedBecause: noGo.explanation,
      criticalNegativeEvidence: [noGo.strongestAgainst, ...noGo.missingEvidence.slice(0, 2)],
    };
  }

  const screeningRejection = state.candidates.find(
    (candidate) =>
      candidate.screening?.status === "Screened out" &&
      (candidate.screening.expressionPoints < 0 ||
        (candidate.diffExpression?.pValue ?? 1) < 0.05 &&
          (candidate.diffExpression?.log2FoldChange ?? 1) <= 0),
  );
  if (screeningRejection) {
    const negativeEvidence = (screeningRejection.screening?.factors ?? []).filter(
      (factor) => !/unavailable|insufficient/i.test(factor),
    );
    return {
      target: screeningRejection.gene,
      decision: "NO-GO",
      basis: "screening",
      initiallyInteresting: "It was included in the predeclared candidate set for TCGA screening.",
      killedBecause:
        "The prespecified expression-led TCGA screen returned significant counter-evidence and the target did not meet the continuation rule. This is a screening NO-GO for this workflow; it does not rule out a mutation-defined target hypothesis.",
      criticalNegativeEvidence: negativeEvidence.length
        ? negativeEvidence
        : ["The TCGA screen returned significant counter-expression evidence."],
    };
  }

  return {
    target: "None",
    decision: "INSUFFICIENT EVIDENCE",
    basis: "none",
    initiallyInteresting: "No candidate was forced into rejection.",
    killedBecause: "This run did not produce enough evidence for a defensible NO-GO.",
    criticalNegativeEvidence: ["No validated NO-GO or significant counter-expression screen was returned."],
  };
}

async function completeWithoutXena(state: AnalysisRun, listener: StateListener): Promise<AnalysisRun> {
  for (const stage of state.stages) {
    if (stage.id === "expression" || stage.id === "survival") {
      updateStage(state, stage.id, "failed", "TCGA/Xena API unavailable; no values were fabricated.");
    } else {
      updateStage(state, stage.id, "insufficient", "Insufficient upstream evidence.");
    }
  }
  for (const candidate of state.candidates) {
    candidate.status = "failed";
    candidate.errors.push("TCGA/Xena API unavailable.");
  }
  state.killedTarget = buildKilledTarget(state);
  state.status = "failed";
  const reportPath = await generateReport(state);
  state.reportPath = toArtifactPath(reportPath);
  await finalizeRunFiles(state);
  await publish(state, listener);
  return state;
}

export async function runAnalysis(
  config: { cancer: CancerOption; genes: string[] },
  listener: StateListener,
): Promise<AnalysisRun> {
  const state = await initializeRun(config.cancer, config.genes);
  const directory = runDirectory(state.runId);
  await publish(state, listener);

  updateStage(state, "expression", "running", "Checking documented primary and fallback Xena services.");
  await publish(state, listener);
  state.health = await checkXenaHealth();
  if (state.health.status !== "online" || !state.health.selectedBaseUrl) {
    state.errors.push("TCGA/Xena API health check failed for all documented endpoints.");
    return completeWithoutXena(state, listener);
  }

  let expressionSuccesses = 0;
  for (const candidate of state.candidates) {
    candidate.status = "running";
    updateStage(state, "expression", "running", `Querying ${candidate.gene} (${expressionSuccesses}/${state.candidates.length} complete).`);
    await publish(state, listener);
    const outputDirectory = path.join(directory, "tcga", candidate.gene, "diff-expression");
    try {
      const { result, record } = await queryDifferentialExpression(
        candidate.gene,
        config.cancer.code,
        state.health.selectedBaseUrl,
        outputDirectory,
      );
      state.commands.push(record);
      candidate.diffExpression = result;
      candidate.artifacts.diffExpression = toArtifactPath(path.join(outputDirectory, "result.json"));
      candidate.status = "partial";
      expressionSuccesses += 1;
    } catch (error) {
      candidate.errors.push(captureError(state, error, `${candidate.gene} differential expression`));
      candidate.status = "partial";
    }
  }
  updateStage(
    state,
    "expression",
    expressionSuccesses ? "completed" : "failed",
    `${expressionSuccesses}/${state.candidates.length} differential-expression queries completed.`,
  );
  await publish(state, listener);

    updateStage(state, "survival", "running", "Running rate-limit-aware TCGA survival queries; optimal cutoffs remain exploratory.");
  await publish(state, listener);
  let survivalSuccesses = 0;
  for (const candidate of state.candidates) {
    updateStage(state, "survival", "running", `Querying ${candidate.gene} (${survivalSuccesses}/${state.candidates.length} complete).`);
    await publish(state, listener);
    const outputDirectory = path.join(directory, "tcga", candidate.gene, "survival");
    try {
      const { result, record } = await querySurvival(
        candidate.gene,
        config.cancer.code,
        state.health.selectedBaseUrl,
        outputDirectory,
      );
      state.commands.push(record);
      candidate.survival = result;
      candidate.artifacts.survival = toArtifactPath(path.join(outputDirectory, "result.json"));
      candidate.status = candidate.diffExpression ? "completed" : "partial";
      survivalSuccesses += 1;
    } catch (error) {
      candidate.errors.push(captureError(state, error, `${candidate.gene} survival`));
      candidate.status = candidate.diffExpression ? "partial" : "failed";
    }
  }
  updateStage(
    state,
    "survival",
    survivalSuccesses ? "completed" : "failed",
    `${survivalSuccesses}/${state.candidates.length} survival queries completed.`,
  );
  await publish(state, listener);

  updateStage(state, "ranking", "running", "Applying the visible expression + median-cutoff survival rubric.");
  state.candidates = rankCandidates(state.candidates);
  state.shortlist = chooseShortlist(state.candidates);
  updateStage(
    state,
    "ranking",
    state.shortlist.length ? "completed" : "insufficient",
    state.shortlist.length
      ? `Shortlisted ${state.shortlist.join(", ")} for deeper review.`
      : "No candidate met the continuation rule.",
  );
  await publish(state, listener);

  if (!state.shortlist.length) {
    for (const id of ["evidence", "literature", "red_team", "validation"] as StageId[]) {
      updateStage(state, id, "insufficient", "No target passed TCGA screening.");
    }
  } else {
    state.targets = state.shortlist.map(
      (gene): TargetEvidence => ({
        gene,
        disease: config.cancer.name,
        mapper: null,
        literature: [],
        trials: [],
        validation: null,
        errors: [],
        artifacts: {},
      }),
    );

    updateStage(state, "evidence", "running", "Querying UniProt, Open Targets, PubMed, and ClinicalTrials.gov through the evidence mapper.");
    await publish(state, listener);
    let mapperSuccesses = 0;
    for (const target of state.targets) {
      const outputDirectory = path.join(directory, "evidence", target.gene, "mapper");
      try {
        const result = await queryTargetEvidence(target.gene, target.disease, outputDirectory);
        state.commands.push(result.record);
        target.mapper = result.evidence;
        target.literature = result.papers;
        target.trials = result.trials;
        target.artifacts.mapper = toArtifactPath(path.join(outputDirectory, "evidence.json"));
        mapperSuccesses += 1;
      } catch (error) {
        target.errors.push(captureError(state, error, `${target.gene} evidence mapper`));
      }
      await publish(state, listener);
    }
    updateStage(
      state,
      "evidence",
      mapperSuccesses ? "completed" : "failed",
      `${mapperSuccesses}/${state.targets.length} target evidence bundles completed.`,
    );
    await publish(state, listener);

    updateStage(state, "literature", "running", "Running dedicated PubMed and ClinicalTrials.gov skills; all statuses remain visible.");
    await publish(state, listener);
    let literatureSuccesses = 0;
    for (const target of state.targets) {
      const trialDirectory = path.join(directory, "evidence", target.gene, "trials");
      try {
        const result = await queryClinicalTrials(target.gene, target.disease, trialDirectory);
        state.commands.push(result.record);
        // Prefer the dedicated finder output; keep mapper trials only as a
        // fallback because its broader free-text query can be noisier.
        if (result.trials.length) target.trials = result.trials;
        target.artifacts.trials = toArtifactPath(path.join(trialDirectory, "summary.json"));
        literatureSuccesses += 1;
      } catch (error) {
        target.errors.push(captureError(state, error, `${target.gene} clinical trials`));
      }

      const pubmedDirectory = path.join(directory, "evidence", target.gene, "pubmed");
      try {
        const result = await queryPubMed(target.gene, target.disease, pubmedDirectory);
        state.commands.push(result.record);
        // Prefer the dedicated field-qualified PubMed query. Mapper records
        // remain in raw evidence.json for provenance and as an empty-result fallback.
        if (result.papers.length) target.literature = result.papers;
        target.artifacts.pubmed = toArtifactPath(path.join(pubmedDirectory, "report.html"));
        literatureSuccesses += 1;
      } catch (error) {
        target.errors.push(captureError(state, error, `${target.gene} PubMed`));
      }
      await publish(state, listener);
    }
    updateStage(
      state,
      "literature",
      literatureSuccesses ? "completed" : "failed",
      `${literatureSuccesses}/${state.targets.length * 2} dedicated literature/clinical queries completed.`,
    );
    await publish(state, listener);

    updateStage(state, "red_team", "running", "Building deterministic counter-evidence assessments linked to raw outputs.");
    for (const target of state.targets) {
      const candidate = state.candidates.find((item) => item.gene === target.gene);
      if (candidate) target.redTeam = buildRedTeamAssessment(candidate, target);
    }
    updateStage(state, "red_team", "completed", "Case FOR and CASE AGAINST generated with equal prominence.");
    await publish(state, listener);

    updateStage(state, "validation", "running", "Running the existing five-dimension target-validation scorer with only supported fields populated.");
    await publish(state, listener);
    let validationSuccesses = 0;
    for (const target of state.targets) {
      const outputDirectory = path.join(directory, "validation", target.gene);
      try {
        const result = await validateTarget(target.gene, target.disease, target.trials, outputDirectory);
        state.commands.push(result.record);
        target.validation = result.result;
        target.artifacts.validation = toArtifactPath(path.join(outputDirectory, "validation_report.json"));
        target.artifacts.validationInput = toArtifactPath(result.inputPath);
        const candidate = state.candidates.find((item) => item.gene === target.gene);
        if (candidate) target.redTeam = buildRedTeamAssessment(candidate, target);
        validationSuccesses += 1;
      } catch (error) {
        target.errors.push(captureError(state, error, `${target.gene} target validation`));
      }
      await publish(state, listener);
    }
    updateStage(
      state,
      "validation",
      validationSuccesses ? "completed" : "failed",
      `${validationSuccesses}/${state.targets.length} scorer runs completed; the coverage gate is applied next.`,
    );
    await publish(state, listener);
  }

  updateStage(state, "decision", "running", "Applying validation tiers and the explicit evidence-coverage gate.");
  state.decisions = state.targets.map((target): FinalDecision => {
    const redTeam = target.redTeam;
    if (!target.validation) {
      return {
        target: target.gene,
        score: null,
        decision: "INSUFFICIENT EVIDENCE",
        confidence: "Low",
        scoredDimensions: 0,
        strongestFor: redTeam?.strongestFor ?? "Insufficient evidence",
        strongestAgainst: redTeam?.strongestAgainst ?? "Insufficient evidence",
        missingEvidence: redTeam?.missingEvidence ?? ["Target-validation-scorer output"],
        explanation: "The target-validation-scorer did not return a usable result.",
      };
    }
    const gate = applyEvidenceCoverageGate(target.validation);
    return {
      target: target.gene,
      score: target.validation.adjusted_score,
      decision: gate.decision,
      confidence: gate.confidence,
      scoredDimensions: gate.scoredDimensions,
      strongestFor: redTeam?.strongestFor ?? "Insufficient evidence",
      strongestAgainst: redTeam?.strongestAgainst ?? "Insufficient evidence",
      missingEvidence: redTeam?.missingEvidence ?? [],
      explanation: gate.explanation,
    };
  });
  state.killedTarget = buildKilledTarget(state);
  updateStage(
    state,
    "decision",
    state.decisions.length || state.killedTarget.basis !== "none" ? "completed" : "insufficient",
    state.killedTarget.basis === "none"
      ? "No defensible NO-GO was produced; no target was forced to fail."
      : `${state.killedTarget.target} received an evidence-driven ${state.killedTarget.decision}.`,
  );

  const hasAnyTcga = state.candidates.some((candidate) => candidate.diffExpression || candidate.survival);
  state.status = !hasAnyTcga ? "failed" : state.errors.length ? "partial" : "completed";
  const reportPath = await generateReport(state);
  state.reportPath = toArtifactPath(reportPath);
  await finalizeRunFiles(state);
  await publish(state, listener);
  return state;
}
