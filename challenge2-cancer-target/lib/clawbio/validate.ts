import type { CancerOption } from "@/types/analysis";

const GENE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;

export function normalizeGene(value: unknown): string {
  if (typeof value !== "string") throw new Error("Every gene must be a string.");
  const gene = value.trim().toUpperCase();
  if (!GENE_PATTERN.test(gene)) {
    throw new Error(`Invalid gene symbol: ${value}. Use 1–32 letters, digits, dots, underscores, or hyphens.`);
  }
  return gene;
}

export function validateAnalysisConfig(
  value: unknown,
  cancers: CancerOption[],
): { cancer: CancerOption; genes: string[] } {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  const input = value as { cancer?: unknown; genes?: unknown };
  if (typeof input.cancer !== "string") throw new Error("Cancer code is required.");
  const cancerCode = input.cancer.trim().toUpperCase();
  const cancer = cancers.find((item) => item.code === cancerCode);
  if (!cancer) throw new Error(`Unsupported TCGA cancer code: ${cancerCode}.`);
  if (!Array.isArray(input.genes)) throw new Error("Genes must be an array.");
  if (input.genes.length < 1 || input.genes.length > 20) {
    throw new Error("Choose between 1 and 20 candidate genes.");
  }
  const genes = [...new Set(input.genes.map(normalizeGene))];
  return { cancer, genes };
}

export function validateRunId(value: string): string {
  if (!RUN_ID_PATTERN.test(value)) throw new Error("Invalid run ID.");
  return value;
}
