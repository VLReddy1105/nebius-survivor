import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { runPythonTool, ToolExecutionError } from "./runner";
import { skillScript } from "./paths";
import type {
  ApiHealth,
  ApiHealthAttempt,
  CommandRecord,
  DifferentialExpression,
  SurvivalCutoff,
  SurvivalEndpoint,
  SurvivalResult,
} from "@/types/analysis";

const XENA_SCRIPT = skillScript("xena-tcga-gene-query", "scripts", "query_tcga_api.py");
const xenaRequestHistory = new Map<string, number[]>();

async function acquireRateLimitSlot(baseUrl: string, task: string): Promise<void> {
  const key = `${baseUrl}:${task}`;
  while (true) {
    const now = Date.now();
    const recent = (xenaRequestHistory.get(key) ?? []).filter((timestamp) => now - timestamp < 60_500);
    if (recent.length < 5) {
      recent.push(now);
      xenaRequestHistory.set(key, recent);
      return;
    }
    const waitMs = Math.max(250, 60_750 - (now - recent[0]));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

interface HealthEndpoint {
  label: string;
  baseUrl: string;
  healthUrl: string;
  timeoutMs: number;
}

function configuredEndpoint(): HealthEndpoint | null {
  const configured = process.env.UCSCXENA_API_BASE_URL?.replace(/\/$/, "");
  if (!configured) return null;
  return {
    label: "Configured",
    baseUrl: configured,
    healthUrl: `${configured}/health`,
    timeoutMs: 10_000,
  };
}

function healthEndpoints(): HealthEndpoint[] {
  const documented: HealthEndpoint[] = [
    {
      label: "Primary",
      baseUrl: "http://biotree.top:38123/ucscxena",
      healthUrl: "http://biotree.top:38123/ucscxena/health",
      timeoutMs: 4_000,
    },
    {
      label: "Fallback",
      baseUrl: "https://ucscxenatoolspy.onrender.com",
      healthUrl: "https://ucscxenatoolspy.onrender.com/health",
      timeoutMs: 35_000,
    },
    {
      label: "Local",
      baseUrl: "http://127.0.0.1:8765",
      healthUrl: "http://127.0.0.1:8765/health",
      timeoutMs: 3_000,
    },
  ];
  const configured = configuredEndpoint();
  return configured
    ? [configured, ...documented.filter((item) => item.baseUrl !== configured.baseUrl)]
    : documented;
}

export async function checkXenaHealth(): Promise<ApiHealth> {
  const attempts: ApiHealthAttempt[] = [];
  for (const endpoint of healthEndpoints()) {
    const started = Date.now();
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.UCSCXENA_API_KEY) headers["X-API-Key"] = process.env.UCSCXENA_API_KEY;
      const response = await fetch(endpoint.healthUrl, {
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(endpoint.timeoutMs),
      });
      attempts.push({
        label: endpoint.label,
        healthUrl: endpoint.healthUrl,
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - started,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      });
      if (response.ok) {
        return {
          status: "online",
          selectedBaseUrl: endpoint.baseUrl,
          checkedAt: new Date().toISOString(),
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        label: endpoint.label,
        healthUrl: endpoint.healthUrl,
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : "Health check failed",
      });
    }
  }
  return { status: "unavailable", checkedAt: new Date().toISOString(), attempts };
}

async function runXenaTask(
  task: "diff-expr" | "survival",
  gene: string,
  cancer: string,
  baseUrl: string,
  outputDirectory: string,
): Promise<{ raw: Record<string, unknown>; record: CommandRecord }> {
  // The hosted service currently returns HTTP 429 after five same-endpoint
  // requests per minute. Queue locally so a six-gene panel completes cleanly.
  await acquireRateLimitSlot(baseUrl, task);
  const record = await runPythonTool({
    skill: "xena-tcga-gene-query",
    script: XENA_SCRIPT,
    args: [
      "--timeout",
      "90",
      "--output",
      outputDirectory,
      "--base-url",
      baseUrl,
      task,
      "--gene",
      gene,
      "--cancer",
      cancer,
    ],
    outputDirectory,
    timeoutMs: 120_000,
  });
  if (record.exitCode !== 0) {
    throw new ToolExecutionError(
      `${task} failed for ${gene}: ${record.stderr.trim() || `exit code ${record.exitCode}`}`,
      record,
    );
  }
  try {
    const parsed = JSON.parse(await readFile(path.join(outputDirectory, "result.json"), "utf8")) as Record<
      string,
      Record<string, unknown>
    >;
    const key = task === "diff-expr" ? "diff_expr" : "survival";
    if (!parsed[key] || typeof parsed[key] !== "object") {
      throw new Error(`result.json did not contain ${key}`);
    }
    return { raw: parsed[key], record };
  } catch (error) {
    throw new ToolExecutionError(
      `Could not read ${task} result for ${gene}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      record,
    );
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function queryDifferentialExpression(
  gene: string,
  cancer: string,
  baseUrl: string,
  outputDirectory: string,
): Promise<{ result: DifferentialExpression; record: CommandRecord }> {
  const { raw, record } = await runXenaTask("diff-expr", gene, cancer, baseUrl, outputDirectory);
  const tumor = (raw.tumor ?? {}) as Record<string, unknown>;
  const normal = (raw.normal ?? {}) as Record<string, unknown>;
  return {
    result: {
      gene: String(raw.gene ?? gene),
      cancer: String(raw.cancer ?? cancer),
      cancerName: String(raw.cancer_full_name ?? cancer),
      tumorN: numberOrNull(tumor.n),
      normalN: numberOrNull(normal.n),
      tumorMean: numberOrNull(tumor.mean),
      normalMean: numberOrNull(normal.mean),
      log2FoldChange: numberOrNull(raw.log2_fold_change),
      pValue: numberOrNull(raw.p_value),
      expressionScale: String(raw.expression_scale ?? "log2(TPM + 0.001)"),
      test: String(raw.test ?? "Mann-Whitney U (two-sided)"),
      raw,
    },
    record,
  };
}

function normalizeCutoff(value: unknown): SurvivalCutoff {
  const cutoff = (value ?? {}) as Record<string, unknown>;
  const high = (cutoff.high ?? {}) as Record<string, unknown>;
  const low = (cutoff.low ?? {}) as Record<string, unknown>;
  return {
    cutoff: numberOrNull(cutoff.cutoff),
    pValue: numberOrNull(cutoff.p_value),
    chiSquare: numberOrNull(cutoff.chi2_stat),
    highN: numberOrNull(high.n ?? cutoff.high_n),
    lowN: numberOrNull(low.n ?? cutoff.low_n),
    highEvents: numberOrNull(high.n_events ?? cutoff.high_events),
    lowEvents: numberOrNull(low.n_events ?? cutoff.low_events),
    highMeanSurvivalDays: numberOrNull(high.mean_survival_days ?? cutoff.high_mean_survival_days),
    lowMeanSurvivalDays: numberOrNull(low.mean_survival_days ?? cutoff.low_mean_survival_days),
    method: typeof cutoff.method === "string" ? cutoff.method : undefined,
  };
}

export async function querySurvival(
  gene: string,
  cancer: string,
  baseUrl: string,
  outputDirectory: string,
): Promise<{ result: SurvivalResult; record: CommandRecord }> {
  const { raw, record } = await runXenaTask("survival", gene, cancer, baseUrl, outputDirectory);
  const survival = (raw.survival ?? {}) as Record<string, Record<string, unknown>>;
  const endpoints: SurvivalEndpoint[] = Object.entries(survival).map(([endpoint, value]) => ({
    endpoint,
    name: String(value.name ?? endpoint),
    nTotal: numberOrNull(value.n_total),
    nEvents: numberOrNull(value.n_events),
    median: normalizeCutoff(value.median_cutoff),
    optimal: normalizeCutoff(value.optimal_cutoff),
    optimalWarning: String(
      value.optimal_cutoff_note ??
        "Exploratory minimum-p cutoff scan; p-value is not adjusted for multiple cutoff testing.",
    ),
    error: typeof value.error === "string" ? value.error : undefined,
  }));
  return {
    result: {
      gene: String(raw.gene ?? gene),
      cancer: String(raw.cancer ?? cancer),
      endpoints,
      raw,
    },
    record,
  };
}
