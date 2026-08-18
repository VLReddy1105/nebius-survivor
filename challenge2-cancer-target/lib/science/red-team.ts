import type {
  CandidateResult,
  EvidenceClaim,
  RedTeamAssessment,
  TargetEvidence,
} from "@/types/analysis";

function claim(
  id: string,
  text: string,
  source: string,
  skill: string,
  evidencePath: string,
  tone: EvidenceClaim["tone"],
): EvidenceClaim {
  return { id, claim: text, source, skill, evidencePath, tone };
}

export function buildRedTeamAssessment(
  candidate: CandidateResult,
  evidence: TargetEvidence,
): RedTeamAssessment {
  const caseFor: EvidenceClaim[] = [];
  const caseAgainst: EvidenceClaim[] = [];
  const contradictions: string[] = [];
  const missingEvidence: string[] = [];
  const diff = candidate.diffExpression;

  if (diff && diff.pValue !== null && diff.log2FoldChange !== null) {
    if (diff.pValue < 0.05 && diff.log2FoldChange > 0) {
      caseFor.push(
        claim(
          "tcga-expression",
          `Tumour expression is higher than normal tissue (log2 difference ${diff.log2FoldChange}, p=${diff.pValue}; tumour n=${diff.tumorN}, normal n=${diff.normalN}).`,
          "TCGA / UCSC Xena-derived data",
          "xena-tcga-gene-query",
          `${candidate.artifacts.diffExpression ?? "raw TCGA output"}#diff_expr`,
          "for",
        ),
      );
      if (Math.abs(diff.log2FoldChange) < 0.5) {
        caseAgainst.push(
          claim(
            "weak-effect",
            `The expression result is statistically significant but biologically modest (absolute log2 difference ${Math.abs(diff.log2FoldChange)} < 0.5).`,
            "TCGA / UCSC Xena-derived data",
            "xena-tcga-gene-query",
            `${candidate.artifacts.diffExpression ?? "raw TCGA output"}#diff_expr.log2_fold_change`,
            "against",
          ),
        );
      }
    } else if (diff.pValue >= 0.05) {
      caseAgainst.push(
        claim(
          "no-expression-association",
          `No statistically significant tumour-versus-normal expression difference was detected (p=${diff.pValue}).`,
          "TCGA / UCSC Xena-derived data",
          "xena-tcga-gene-query",
          `${candidate.artifacts.diffExpression ?? "raw TCGA output"}#diff_expr.p_value`,
          "against",
        ),
      );
    } else if (diff.log2FoldChange <= 0) {
      caseAgainst.push(
        claim(
          "non-positive-expression",
          `The tumour-versus-normal expression difference is non-positive (log2 difference ${diff.log2FoldChange}, p=${diff.pValue}).`,
          "TCGA / UCSC Xena-derived data",
          "xena-tcga-gene-query",
          `${candidate.artifacts.diffExpression ?? "raw TCGA output"}#diff_expr`,
          "against",
        ),
      );
    }
  } else {
    missingEvidence.push("TCGA tumour-versus-normal expression result");
  }

  const endpoints = candidate.survival?.endpoints ?? [];
  const medianSignificant = endpoints.filter((item) => (item.median.pValue ?? 1) < 0.05);
  const optimalOnly = endpoints.filter(
    (item) => (item.median.pValue ?? 1) >= 0.05 && (item.optimal.pValue ?? 1) < 0.05,
  );

  if (medianSignificant.length) {
    caseFor.push(
      claim(
        "tcga-survival",
        `${medianSignificant.map((item) => item.endpoint).join(", ")} show a median-cutoff survival association (p<0.05). This is associative, not causal.`,
        "TCGA clinical survival annotations",
        "xena-tcga-gene-query",
        `${candidate.artifacts.survival ?? "raw TCGA output"}#survival`,
        "for",
      ),
    );
  } else if (endpoints.length) {
    caseAgainst.push(
      claim(
        "absent-survival",
        "No significant survival association was detected at the prespecified median cutoff across the returned endpoints.",
        "TCGA clinical survival annotations",
        "xena-tcga-gene-query",
        `${candidate.artifacts.survival ?? "raw TCGA output"}#survival`,
        "against",
      ),
    );
  } else {
    missingEvidence.push("TCGA survival result");
  }

  if (optimalOnly.length) {
    caseAgainst.push(
      claim(
        "cutoff-instability",
        `${optimalOnly.map((item) => item.endpoint).join(", ")} become nominally significant only after an exploratory minimum-p cutoff scan; these p-values are uncorrected for multiple cutoff testing.`,
        "TCGA clinical survival annotations",
        "xena-tcga-gene-query",
        `${candidate.artifacts.survival ?? "raw TCGA output"}#optimal_cutoff_note`,
        "against",
      ),
    );
    contradictions.push("Median-cutoff and exploratory optimal-cutoff survival results disagree.");
  }

  const mapperAssociation = evidence.mapper?.disease_association as
    | { status?: string; matched_target?: unknown; matched_disease?: unknown }
    | undefined;
  if (mapperAssociation?.status === "ok") {
    missingEvidence.push(
      "Quantitative disease-association score from Open Targets (the mapper resolved entities only)",
    );
  } else {
    missingEvidence.push("Quantitative disease-association score from Open Targets");
  }

  if (evidence.literature.length) {
    caseFor.push(
      claim(
        "verified-literature",
        `${evidence.literature.length} PubMed record${evidence.literature.length === 1 ? " was" : "s were"} resolved for the target and disease query; record presence alone does not establish efficacy.`,
        "PubMed",
        "pubmed-summariser / omics-target-evidence-mapper",
        evidence.artifacts.pubmed ?? evidence.artifacts.mapper ?? "raw PubMed output",
        "for",
      ),
    );
  } else {
    missingEvidence.push("Verified PubMed literature records");
  }

  if (evidence.trials.length) {
    caseFor.push(
      claim(
        "clinical-investigation",
        `${evidence.trials.length} ClinicalTrials.gov record${evidence.trials.length === 1 ? " was" : "s were"} returned for the query; trial presence and completion do not establish efficacy or safety.`,
        "ClinicalTrials.gov",
        "clinical-trial-finder",
        evidence.artifacts.trials ?? "raw clinical-trial output",
        "for",
      ),
    );
    const negativeStatuses = evidence.trials.filter((trial) =>
      ["TERMINATED", "WITHDRAWN", "SUSPENDED"].includes(trial.status),
    );
    if (negativeStatuses.length) {
      caseAgainst.push(
        claim(
          "negative-trial-status",
          `${negativeStatuses.length} returned trial${negativeStatuses.length === 1 ? " has" : "s have"} a terminated, withdrawn, or suspended status. Status is a warning signal, not proof of target failure.`,
          "ClinicalTrials.gov",
          "clinical-trial-finder",
          `${evidence.artifacts.trials ?? "raw clinical-trial output"}#trials`,
          "against",
        ),
      );
    }
  } else {
    missingEvidence.push("Target-and-disease-matched clinical trial records");
  }

  const safetyFlags = evidence.validation?.safety_flags ?? [];
  for (const [index, flag] of safetyFlags.entries()) {
    if (flag.penalty < 0 && flag.evidence) {
      caseAgainst.push(
        claim(
          `safety-${index}`,
          `${flag.risk}: ${flag.evidence}`,
          "Target Validation Scorer input evidence",
          "target-validation-scorer",
          `${evidence.artifacts.validation ?? "raw validation output"}#safety_flags.${index}`,
          "against",
        ),
      );
    }
  }

  if (!safetyFlags.length) {
    missingEvidence.push("Verified toxicity and essentiality evidence (for example DepMap or safety literature)");
  }
  missingEvidence.push("Normal-tissue or single-cell target-specificity evidence");

  const subScores = evidence.validation?.sub_scores ?? {};
  for (const dimension of ["druggability", "chemical_matter", "structural_data"]) {
    if (!subScores[dimension] || subScores[dimension].score === null) {
      missingEvidence.push(`${dimension.replaceAll("_", " ")} dimension`);
    }
  }

  if (caseFor.length && caseAgainst.length) {
    contradictions.push("Supporting biological or translational evidence coexists with material counter-evidence or uncertainty.");
  }

  const evidenceModalities = [
    Boolean(diff),
    Boolean(candidate.survival),
    false,
    evidence.literature.length > 0,
    evidence.trials.length > 0,
    Boolean(evidence.validation),
  ].filter(Boolean).length;
  const confidence: RedTeamAssessment["confidence"] =
    evidenceModalities >= 5 && missingEvidence.length <= 2
      ? "High"
      : evidenceModalities >= 3
        ? "Moderate"
        : "Low";

  return {
    strongestFor: caseFor[0]?.claim ?? "Insufficient evidence",
    strongestAgainst: caseAgainst[0]?.claim ?? "Insufficient evidence",
    caseFor,
    caseAgainst,
    contradictions: [...new Set(contradictions)],
    missingEvidence: [...new Set(missingEvidence)],
    confidence,
    confidenceExplanation: `${evidenceModalities} of 6 planned evidence modalities returned usable output; confidence reflects evidence completeness, not a probability of target success.`,
  };
}
