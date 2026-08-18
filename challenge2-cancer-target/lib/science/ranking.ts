import type { CandidateResult, ScreeningFactors } from "@/types/analysis";

export const SCREENING_RUBRIC = {
  expression: [
    "3 points: p < 0.05 and log2 difference ≥ 1.0",
    "2 points: p < 0.05 and log2 difference ≥ 0.5",
    "1 point: p < 0.05 and log2 difference > 0",
    "0 points: no significant positive expression difference",
    "−2 points: p < 0.05 and log2 difference ≤ 0",
  ],
  survival: [
    "2 points: at least two median-cutoff endpoints have p < 0.05",
    "1 point: one median-cutoff endpoint has p < 0.05",
    "0 points: no median-cutoff endpoint has p < 0.05",
    "Exploratory optimal-cutoff p-values never add points",
  ],
  shortlist: "Continue when the total is at least 1; shortlist up to the top three.",
} as const;

function expressionFactor(candidate: CandidateResult) {
  const result = candidate.diffExpression;
  if (!result || result.pValue === null || result.log2FoldChange === null) {
    return {
      points: 0,
      label: "Insufficient expression evidence",
      detail: "Differential-expression output was unavailable.",
    };
  }

  if (result.pValue >= 0.05) {
    return {
      points: 0,
      label: "Weak — not statistically significant",
      detail: `Expression p=${result.pValue} does not meet the prespecified p<0.05 screening threshold.`,
    };
  }

  if (result.log2FoldChange <= 0) {
    return {
      points: -2,
      label: "Counter-evidence — no tumour overexpression",
      detail: `The statistically detected difference is non-positive (log2 difference ${result.log2FoldChange}).`,
    };
  }

  if (result.log2FoldChange >= 1) {
    return {
      points: 3,
      label: "Strong expression signal",
      detail: `p=${result.pValue}; log2 difference=${result.log2FoldChange}.`,
    };
  }

  if (result.log2FoldChange >= 0.5) {
    return {
      points: 2,
      label: "Moderate expression signal",
      detail: `p=${result.pValue}; log2 difference=${result.log2FoldChange}.`,
    };
  }

  return {
    points: 1,
    label: "Weak positive expression signal",
    detail: `The difference is statistically detected but small (log2 difference=${result.log2FoldChange}).`,
  };
}

function survivalFactor(candidate: CandidateResult) {
  if (!candidate.survival) {
    return {
      points: 0,
      label: "Insufficient survival evidence",
      detail: "Survival output was unavailable.",
    };
  }

  const valid = candidate.survival.endpoints.filter((item) => !item.error && item.median.pValue !== null);
  const significant = valid.filter((item) => (item.median.pValue ?? 1) < 0.05);
  const exploratoryOnly = candidate.survival.endpoints.some(
    (item) => (item.median.pValue ?? 1) >= 0.05 && (item.optimal.pValue ?? 1) < 0.05,
  );

  if (significant.length >= 2) {
    return {
      points: 2,
      label: `Strong association — ${significant.length} median-cutoff endpoints`,
      detail: `${significant.map((item) => item.endpoint).join(", ")} have median-cutoff p<0.05; association does not establish causality.`,
    };
  }

  if (significant.length === 1) {
    return {
      points: 1,
      label: `Moderate association — ${significant[0].endpoint} only`,
      detail: `${significant[0].endpoint} has median-cutoff p<0.05; other endpoints do not confirm it.`,
    };
  }

  return {
    points: 0,
    label: "No significant median-cutoff survival association",
    detail: exploratoryOnly
      ? "An exploratory optimal cutoff is nominally significant, but it is uncorrected and contributes no screening points."
      : "No returned median-cutoff endpoint has p<0.05.",
  };
}

function screenCandidate(candidate: CandidateResult): CandidateResult {
  const expression = expressionFactor(candidate);
  const survival = survivalFactor(candidate);
  const totalPoints = expression.points + survival.points;
  const hasAnyData = Boolean(candidate.diffExpression || candidate.survival);

  const screening: ScreeningFactors = {
    expressionPoints: expression.points,
    survivalPoints: survival.points,
    totalPoints,
    expressionLabel: expression.label,
    survivalLabel: survival.label,
    status: !hasAnyData ? "Insufficient evidence" : totalPoints >= 1 ? "Continue" : "Screened out",
    factors: [expression.detail, survival.detail],
  };

  return { ...candidate, screening };
}

export function rankCandidates(candidates: CandidateResult[]): CandidateResult[] {
  return candidates
    .map(screenCandidate)
    .sort((a, b) => {
      const pointDifference = (b.screening?.totalPoints ?? -99) - (a.screening?.totalPoints ?? -99);
      return pointDifference || a.gene.localeCompare(b.gene);
    });
}

export function chooseShortlist(candidates: CandidateResult[]): string[] {
  return rankCandidates(candidates)
    .filter((candidate) => candidate.screening?.status === "Continue")
    .slice(0, 3)
    .map((candidate) => candidate.gene);
}
