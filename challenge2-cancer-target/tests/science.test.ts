import assert from "node:assert/strict";
import test from "node:test";

import { rankCandidates } from "../lib/science/ranking";
import { applyEvidenceCoverageGate } from "../lib/science/decision";
import { buildRedTeamAssessment } from "../lib/science/red-team";
import type { CandidateResult, TargetEvidence } from "../types/analysis";

const baseCandidate = (overrides: Partial<CandidateResult> = {}): CandidateResult => ({
  gene: "EGFR",
  status: "completed",
  diffExpression: {
    gene: "EGFR",
    cancer: "LUAD",
    cancerName: "Lung adenocarcinoma",
    tumorN: 510,
    normalN: 59,
    tumorMean: 5.1,
    normalMean: 4.2,
    log2FoldChange: 0.9,
    pValue: 0.001,
    expressionScale: "log2(TPM + 0.001)",
    test: "Mann-Whitney U (two-sided)",
    raw: {},
  },
  survival: {
    gene: "EGFR",
    cancer: "LUAD",
    endpoints: [
      {
        endpoint: "OS",
        name: "Overall Survival",
        nTotal: 504,
        nEvents: 183,
        median: { pValue: 0.67, highN: 252, lowN: 252 },
        optimal: { pValue: 0.04, highN: 156, lowN: 348 },
        optimalWarning: "Exploratory and uncorrected for multiple cutoff testing.",
      },
    ],
    raw: {},
  },
  errors: [],
  artifacts: {},
  ...overrides,
});

test("ranking uses only prespecified, visible TCGA factors", () => {
  const ranked = rankCandidates([
    baseCandidate(),
    baseCandidate({
      gene: "KRAS",
      diffExpression: {
        ...baseCandidate().diffExpression!,
        gene: "KRAS",
        log2FoldChange: 0.1,
        pValue: 0.3,
      },
    }),
  ]);

  assert.equal(ranked[0].gene, "EGFR");
  assert.equal(ranked[0].screening?.expressionPoints, 2);
  assert.equal(ranked[0].screening?.survivalPoints, 0);
  assert.match(ranked[0].screening?.survivalLabel ?? "", /No significant/i);
  assert.equal(ranked[1].screening?.expressionPoints, 0);
});

test("an exploratory optimal cutoff never becomes positive survival evidence", () => {
  const [ranked] = rankCandidates([baseCandidate()]);
  assert.equal(ranked.screening?.survivalPoints, 0);
  assert.match(ranked.screening?.survivalLabel ?? "", /median-cutoff/i);
});

test("missing scorer dimensions become insufficient evidence, not NO-GO", () => {
  const decision = applyEvidenceCoverageGate({
    target: "EGFR",
    adjusted_score: 20,
    decision: "NO_GO",
    sub_scores: {
      disease_association: { score: null },
      druggability: { score: null },
      chemical_matter: { score: null },
      clinical_precedent: { score: 20 },
      structural_data: { score: null },
    },
  });

  assert.equal(decision.decision, "INSUFFICIENT EVIDENCE");
  assert.equal(decision.scoredDimensions, 1);
  assert.match(decision.explanation, /1 of 5/i);
});

test("red-team flags weak biology and absent survival without inventing toxicity", () => {
  const candidate = baseCandidate({
    diffExpression: {
      ...baseCandidate().diffExpression!,
      log2FoldChange: 0.22,
      pValue: 0.0001,
    },
  });
  const evidence: TargetEvidence = {
    gene: "EGFR",
    disease: "Lung adenocarcinoma",
    mapper: null,
    literature: [],
    trials: [],
    validation: null,
    errors: [],
    artifacts: {},
  };
  const assessment = buildRedTeamAssessment(candidate, evidence);

  assert.ok(assessment.caseAgainst.some((item) => /biologically modest/i.test(item.claim)));
  assert.ok(assessment.caseAgainst.some((item) => /No significant survival/i.test(item.claim)));
  assert.ok(assessment.missingEvidence.some((item) => /toxicity|essentiality/i.test(item)));
  assert.ok(!assessment.caseAgainst.some((item) => /toxic/i.test(item.claim)));
});
