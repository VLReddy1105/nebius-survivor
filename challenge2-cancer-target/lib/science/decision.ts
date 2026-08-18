import type { FinalDecisionLabel, ValidationResult } from "@/types/analysis";

export const MIN_SCORED_DIMENSIONS = 3;

interface PartialValidation {
  target: string;
  adjusted_score: number;
  decision: string;
  sub_scores: Record<string, { score: number | null }>;
}

export function applyEvidenceCoverageGate(validation: PartialValidation): {
  decision: FinalDecisionLabel;
  confidence: "Low" | "Moderate" | "High";
  scoredDimensions: number;
  explanation: string;
} {
  const totalDimensions = Object.keys(validation.sub_scores).length || 5;
  const scoredDimensions = Object.values(validation.sub_scores).filter(
    (dimension) => dimension.score !== null && dimension.score !== undefined,
  ).length;

  if (scoredDimensions < MIN_SCORED_DIMENSIONS) {
    return {
      decision: "INSUFFICIENT EVIDENCE",
      confidence: "Low",
      scoredDimensions,
      explanation: `The ClawBio scorer returned data for ${scoredDimensions} of ${totalDimensions} dimensions. The dashboard requires at least ${MIN_SCORED_DIMENSIONS} populated dimensions before adopting a GO or NO-GO tier; missing evidence is not treated as zero.`,
    };
  }

  const mapped: Record<string, FinalDecisionLabel> = {
    GO: "GO",
    CONDITIONAL_GO: "CONDITIONAL",
    REVIEW: "INSUFFICIENT EVIDENCE",
    NO_GO: "NO-GO",
  };
  const decision = mapped[validation.decision] ?? "INSUFFICIENT EVIDENCE";
  const confidence = scoredDimensions === totalDimensions ? "High" : "Moderate";

  return {
    decision,
    confidence,
    scoredDimensions,
    explanation: `Adopts the target-validation-scorer tier (${validation.decision}) from an adjusted score of ${validation.adjusted_score}, with ${scoredDimensions} of ${totalDimensions} dimensions populated.`,
  };
}

export function populatedValidationDimensions(validation: ValidationResult | null): string[] {
  if (!validation) return [];
  return Object.entries(validation.sub_scores)
    .filter(([, value]) => value.score !== null)
    .map(([name]) => name);
}
