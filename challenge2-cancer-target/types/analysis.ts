export type StageId =
  | "expression"
  | "survival"
  | "ranking"
  | "evidence"
  | "literature"
  | "red_team"
  | "validation"
  | "decision";

export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "insufficient";

export interface PipelineStage {
  id: StageId;
  label: string;
  status: StageStatus;
  message?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CancerOption {
  code: string;
  name: string;
}

export interface CommandRecord {
  skill: string;
  executable: string;
  args: string[];
  commandDisplay: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputDirectory?: string;
}

export interface DifferentialExpression {
  gene: string;
  cancer: string;
  cancerName: string;
  tumorN: number | null;
  normalN: number | null;
  tumorMean: number | null;
  normalMean: number | null;
  log2FoldChange: number | null;
  pValue: number | null;
  expressionScale: string;
  test: string;
  raw: Record<string, unknown>;
}

export interface SurvivalCutoff {
  cutoff?: number | null;
  pValue: number | null;
  chiSquare?: number | null;
  highN?: number | null;
  lowN?: number | null;
  highEvents?: number | null;
  lowEvents?: number | null;
  highMeanSurvivalDays?: number | null;
  lowMeanSurvivalDays?: number | null;
  method?: string;
}

export interface SurvivalEndpoint {
  endpoint: string;
  name: string;
  nTotal: number | null;
  nEvents: number | null;
  median: SurvivalCutoff;
  optimal: SurvivalCutoff;
  optimalWarning: string;
  error?: string;
}

export interface SurvivalResult {
  gene: string;
  cancer: string;
  endpoints: SurvivalEndpoint[];
  raw: Record<string, unknown>;
}

export interface ScreeningFactors {
  expressionPoints: number;
  survivalPoints: number;
  totalPoints: number;
  expressionLabel: string;
  survivalLabel: string;
  status: "Continue" | "Screened out" | "Insufficient evidence";
  factors: string[];
}

export interface CandidateResult {
  gene: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  diffExpression?: DifferentialExpression;
  survival?: SurvivalResult;
  screening?: ScreeningFactors;
  errors: string[];
  artifacts: Record<string, string>;
}

export interface PaperEvidence {
  pmid: string;
  title: string;
  source: string;
  publicationDate?: string;
  url: string;
  verified: boolean;
}

export interface TrialEvidence {
  nctId: string;
  title: string;
  status: string;
  phase: string;
  studyType?: string;
  interventions: string[];
  conditions: string[];
  url: string;
}

export interface EvidenceClaim {
  id: string;
  claim: string;
  source: string;
  skill: string;
  evidencePath: string;
  tone: "for" | "against" | "neutral";
}

export interface RedTeamAssessment {
  strongestFor: string;
  strongestAgainst: string;
  caseFor: EvidenceClaim[];
  caseAgainst: EvidenceClaim[];
  contradictions: string[];
  missingEvidence: string[];
  confidence: "Low" | "Moderate" | "High";
  confidenceExplanation: string;
}

export interface ValidationSubScore {
  score: number | null;
  confidence?: string;
  source?: string;
  detail?: string;
}

export interface ValidationResult {
  target: string;
  disease?: string;
  raw_score: number;
  safety_penalty: number;
  adjusted_score: number;
  decision: string;
  decision_meaning?: string;
  sub_scores: Record<string, ValidationSubScore>;
  safety_flags: Array<{
    risk: string;
    penalty: number;
    tier?: string;
    evidence?: string;
    mitigation?: string;
  }>;
  rationale: string;
  retrieved_at?: string;
}

export interface TargetEvidence {
  gene: string;
  disease: string;
  mapper: Record<string, unknown> | null;
  literature: PaperEvidence[];
  trials: TrialEvidence[];
  validation: ValidationResult | null;
  redTeam?: RedTeamAssessment;
  errors: string[];
  artifacts: Record<string, string>;
}

export type FinalDecisionLabel =
  | "GO"
  | "CONDITIONAL"
  | "NO-GO"
  | "INSUFFICIENT EVIDENCE";

export interface FinalDecision {
  target: string;
  score: number | null;
  decision: FinalDecisionLabel;
  confidence: "Low" | "Moderate" | "High";
  scoredDimensions: number;
  strongestFor: string;
  strongestAgainst: string;
  missingEvidence: string[];
  explanation: string;
}

export interface KilledTarget {
  target: string;
  decision: "NO-GO" | "INSUFFICIENT EVIDENCE";
  basis: "validation" | "screening" | "none";
  initiallyInteresting: string;
  killedBecause: string;
  criticalNegativeEvidence: string[];
}

export interface ApiHealthAttempt {
  label: string;
  healthUrl: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface ApiHealth {
  status: "online" | "unavailable";
  selectedBaseUrl?: string;
  checkedAt: string;
  attempts: ApiHealthAttempt[];
}

export interface AnalysisRun {
  schemaVersion: "1.0";
  runId: string;
  status: "running" | "completed" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  config: {
    cancer: CancerOption;
    genes: string[];
  };
  health: ApiHealth | null;
  stages: PipelineStage[];
  candidates: CandidateResult[];
  shortlist: string[];
  targets: TargetEvidence[];
  decisions: FinalDecision[];
  killedTarget: KilledTarget | null;
  commands: CommandRecord[];
  errors: string[];
  reportPath?: string;
  disclaimer: string;
}

export interface AnalysisEvent {
  type: "state" | "complete" | "error";
  runId: string;
  state?: AnalysisRun;
  message?: string;
}
