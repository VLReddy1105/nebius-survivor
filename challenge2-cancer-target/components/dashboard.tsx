"use client";

import { useEffect, useMemo, useState } from "react";

import { SCREENING_RUBRIC } from "@/lib/science/ranking";
import type {
  AnalysisEvent,
  AnalysisRun,
  ApiHealth,
  CancerOption,
  CandidateResult,
  FinalDecisionLabel,
  StageStatus,
  TargetEvidence,
} from "@/types/analysis";

const DEFAULT_GENES = ["EGFR", "MET", "KRAS", "BRAF", "ERBB2", "PIK3CA"];

function formatNumber(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return "Unavailable";
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value.toFixed(digits)).toLocaleString();
}

function statusTone(status: StageStatus): string {
  return {
    pending: "status-neutral",
    running: "status-running",
    completed: "status-positive",
    failed: "status-negative",
    insufficient: "status-caution",
  }[status];
}

function decisionTone(decision: FinalDecisionLabel): string {
  if (decision === "GO") return "decision-go";
  if (decision === "CONDITIONAL") return "decision-conditional";
  if (decision === "NO-GO") return "decision-no-go";
  return "decision-insufficient";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function CandidateScreening({ candidate }: { candidate: CandidateResult }) {
  const diff = candidate.diffExpression;
  const survival = candidate.survival;
  return (
    <article className="data-card" id={`candidate-${candidate.gene}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Candidate</p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{candidate.gene}</h3>
        </div>
        <span
          className={`status-pill ${
            candidate.screening?.status === "Continue"
              ? "status-positive"
              : candidate.screening?.status === "Screened out"
                ? "status-negative"
                : "status-caution"
          }`}
        >
          {candidate.screening?.status ?? candidate.status}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="metric-block">
          <span>log2 difference</span>
          <strong>{formatNumber(diff?.log2FoldChange)}</strong>
          <small>{diff?.expressionScale ?? "Expression unavailable"}</small>
        </div>
        <div className="metric-block">
          <span>Expression p-value</span>
          <strong>{formatNumber(diff?.pValue)}</strong>
          <small>
            {diff?.pValue !== null && diff?.pValue !== undefined && diff.pValue < 0.05
              ? "Statistically detected; inspect effect size"
              : "No significant expression difference detected"}
          </small>
        </div>
        <div className="metric-block">
          <span>Screening points</span>
          <strong>{candidate.screening?.totalPoints ?? "—"}</strong>
          <small>
            Expression {candidate.screening?.expressionPoints ?? 0} · Survival {candidate.screening?.survivalPoints ?? 0}
          </small>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="subpanel">
          <h4>TCGA differential expression</h4>
          {diff ? (
            <dl className="compact-list">
              <div><dt>Tumour samples</dt><dd>{diff.tumorN ?? "Unavailable"}</dd></div>
              <div><dt>Normal samples</dt><dd>{diff.normalN ?? "Unavailable"}</dd></div>
              <div><dt>Tumour mean</dt><dd>{formatNumber(diff.tumorMean)}</dd></div>
              <div><dt>Normal mean</dt><dd>{formatNumber(diff.normalMean)}</dd></div>
              <div><dt>Test</dt><dd>{diff.test}</dd></div>
            </dl>
          ) : <p className="empty-copy">Insufficient evidence</p>}
          <p className="evidence-note mt-4">{candidate.screening?.expressionLabel}</p>
        </div>

        <div className="subpanel">
          <h4>TCGA survival</h4>
          {survival?.endpoints.length ? (
            <div className="mt-3 space-y-3">
              {survival.endpoints.map((endpoint) => (
                <div className="survival-row" key={endpoint.endpoint}>
                  <div className="flex items-baseline justify-between gap-2">
                    <strong>{endpoint.endpoint}</strong>
                    <span>n={endpoint.nTotal ?? "—"} · events={endpoint.nEvents ?? "—"}</span>
                  </div>
                  <p>Median cutoff p={formatNumber(endpoint.median.pValue)} · χ²={formatNumber(endpoint.median.chiSquare)}</p>
                  <p className={(endpoint.median.pValue ?? 1) < 0.05 ? "text-emerald-700" : "text-slate-600"}>
                    {(endpoint.median.pValue ?? 1) < 0.05
                      ? "Association detected; this does not establish causality"
                      : "No significant survival association detected"}
                  </p>
                  <p className="warning-copy">Optimal cutoff p={formatNumber(endpoint.optimal.pValue)} — exploratory, uncorrected</p>
                </div>
              ))}
            </div>
          ) : <p className="empty-copy">Insufficient evidence</p>}
          <p className="evidence-note mt-4">{candidate.screening?.survivalLabel}</p>
        </div>
      </div>

      {candidate.errors.length > 0 && (
        <div className="error-box mt-4">
          {candidate.errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
    </article>
  );
}

function TargetDetail({ target, run }: { target: TargetEvidence; run: AnalysisRun }) {
  const candidate = run.candidates.find((item) => item.gene === target.gene);
  const decision = run.decisions.find((item) => item.target === target.gene);
  const mapperTarget = record(record(target.mapper).target_summary);
  const mapperAssociation = record(record(target.mapper).disease_association);

  return (
    <article className="target-card" id={`target-${target.gene}`}>
      <div className="target-card-header">
        <div>
          <p className="eyebrow">Shortlisted target</p>
          <h3>{target.gene}</h3>
          <p>{String(mapperTarget.protein_name ?? "Canonical protein summary unavailable")}</p>
        </div>
        {decision && <span className={`decision-badge ${decisionTone(decision.decision)}`}>{decision.decision}</span>}
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="subpanel">
          <p className="eyebrow">TCGA evidence</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            log2 difference <strong>{formatNumber(candidate?.diffExpression?.log2FoldChange)}</strong>, p=<strong>{formatNumber(candidate?.diffExpression?.pValue)}</strong>
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Screening status: {candidate?.screening?.status ?? "Insufficient evidence"}. Expression alone is not target validation.
          </p>
        </div>
        <div className="subpanel">
          <p className="eyebrow">Disease / target evidence</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            UniProt: <strong>{String(mapperTarget.primary_accession ?? "Unavailable")}</strong>
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Open Targets match: {mapperAssociation.status === "ok" ? "Resolved" : String(mapperAssociation.status ?? "Unavailable")}. The current mapper returns no association score.
          </p>
        </div>
        <div className="subpanel">
          <p className="eyebrow">Validation coverage</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {decision?.scoredDimensions ?? 0}<span className="text-base font-medium text-slate-400"> / 5</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">Missing scorer dimensions remain null; they are never converted into zero evidence.</p>
        </div>
      </section>

      <section className="evidence-balance mt-6" aria-label={`${target.gene} case for and case against`}>
        <div className="case-panel case-for">
          <div className="case-heading">
            <span aria-hidden="true">+</span>
            <div><p>CASE FOR</p><small>Supporting evidence</small></div>
          </div>
          {target.redTeam?.caseFor.length ? (
            <ol className="case-list">
              {target.redTeam.caseFor.map((item) => (
                <li key={item.id}>
                  <p>{item.claim}</p>
                  <span>{item.source} · {item.skill}</span>
                </li>
              ))}
            </ol>
          ) : <p className="empty-copy">Insufficient evidence</p>}
        </div>
        <div className="case-panel case-against">
          <div className="case-heading">
            <span aria-hidden="true">−</span>
            <div><p>CASE AGAINST</p><small>Counter-evidence and risk</small></div>
          </div>
          {target.redTeam?.caseAgainst.length ? (
            <ol className="case-list">
              {target.redTeam.caseAgainst.map((item) => (
                <li key={item.id}>
                  <p>{item.claim}</p>
                  <span>{item.source} · {item.skill}</span>
                </li>
              ))}
            </ol>
          ) : <p className="empty-copy">Insufficient evidence — no negative claim fabricated</p>}
        </div>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="subpanel">
          <div className="flex items-center justify-between gap-3">
            <h4>Literature provenance</h4>
            <span className="count-label">{target.literature.length} records</span>
          </div>
          <div className="mt-4 space-y-3">
            {target.literature.length ? target.literature.map((paper) => (
              <a className="source-row" href={paper.url} target="_blank" rel="noreferrer" key={paper.pmid}>
                <span className="source-id">PMID {paper.pmid}</span>
                <span className="source-title">{paper.title}</span>
                <span className={paper.verified ? "verified" : "unverified"}>{paper.verified ? "Verified ✓" : "Unverified ✕"}</span>
              </a>
            )) : <p className="empty-copy">No verified PubMed records returned.</p>}
          </div>
        </div>

        <div className="subpanel">
          <div className="flex items-center justify-between gap-3">
            <h4>Clinical trial landscape</h4>
            <span className="count-label">{target.trials.length} records</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">All statuses are shown. Completed does not mean effective; terminated does not by itself prove target failure.</p>
          <div className="mt-4 space-y-3">
            {target.trials.length ? target.trials.slice(0, 10).map((trial) => (
              <a className="trial-row" href={trial.url} target="_blank" rel="noreferrer" key={trial.nctId}>
                <div><span className="source-id">{trial.nctId}</span><p>{trial.title}</p></div>
                <div className="trial-meta"><span>{trial.status}</span><span>{trial.phase || "Phase not reported"}</span></div>
              </a>
            )) : <p className="empty-copy">No matching ClinicalTrials.gov records returned.</p>}
          </div>
        </div>
      </section>

      <section className="mt-6 subpanel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Target validation scorer</p>
            <h4 className="mt-1">Real scoring dimensions</h4>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tracking-tight text-slate-950">{target.validation?.adjusted_score ?? "—"}</p>
            <p className="text-xs text-slate-500">Adjusted score · raw tier {target.validation?.decision ?? "Unavailable"}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(target.validation?.sub_scores ?? {}).map(([name, value]) => (
            <div className="score-dimension" key={name}>
              <span>{name.replaceAll("_", " ")}</span>
              <strong>{value.score === null ? "N/A" : `${value.score}/20`}</strong>
              <small>{value.source ?? "Source unavailable"}</small>
            </div>
          ))}
          {!target.validation && <p className="empty-copy">Scorer output unavailable.</p>}
        </div>
        {decision && <p className="coverage-note mt-5">{decision.explanation}</p>}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="subpanel">
          <h4>Red-team verdict</h4>
          <dl className="compact-list mt-3">
            <div><dt>Strongest FOR</dt><dd>{target.redTeam?.strongestFor ?? "Insufficient evidence"}</dd></div>
            <div><dt>Strongest AGAINST</dt><dd>{target.redTeam?.strongestAgainst ?? "Insufficient evidence"}</dd></div>
            <div><dt>Confidence</dt><dd>{target.redTeam?.confidence ?? "Low"}</dd></div>
          </dl>
          {target.redTeam?.contradictions.length ? (
            <div className="mt-4">
              <p className="eyebrow">Contradictions</p>
              <ul className="plain-list mt-2">{target.redTeam.contradictions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ) : null}
        </div>
        <div className="subpanel">
          <h4>Missing evidence</h4>
          <ul className="plain-list mt-3">
            {(target.redTeam?.missingEvidence ?? ["Evidence assessment unavailable"]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <details className="raw-panel mt-6">
        <summary>Raw Evidence / Provenance</summary>
        <div className="raw-grid">
          <div><p className="eyebrow">Artifacts</p><pre>{JSON.stringify(target.artifacts, null, 2)}</pre></div>
          <div><p className="eyebrow">Raw target evidence</p><pre>{JSON.stringify({ mapper: target.mapper, validation: target.validation }, null, 2)}</pre></div>
        </div>
      </details>

      {target.errors.length > 0 && <div className="error-box mt-5">{target.errors.map((error) => <p key={error}>{error}</p>)}</div>}
    </article>
  );
}

export function Dashboard({ cancers, initialRun }: { cancers: CancerOption[]; initialRun: AnalysisRun | null }) {
  const [cancer, setCancer] = useState("LUAD");
  const [genes, setGenes] = useState(DEFAULT_GENES);
  const [geneInput, setGeneInput] = useState("");
  const [run, setRun] = useState<AnalysisRun | null>(initialRun);
  const [health, setHealth] = useState<ApiHealth | null>(initialRun?.health ?? null);
  const [running, setRunning] = useState(false);
  const [uiError, setUiError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    if (health) return;
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store" })
      .then(async (response) => response.json() as Promise<ApiHealth>)
      .then((value) => { if (!cancelled) setHealth(value); })
      .catch(() => { if (!cancelled) setHealth({ status: "unavailable", checkedAt: new Date().toISOString(), attempts: [] }); });
    return () => { cancelled = true; };
  }, [health]);

  const selectedCancer = cancers.find((item) => item.code === cancer);
  const completedStages = run?.stages.filter((stage) => stage.status === "completed").length ?? 0;
  const shortlist = useMemo(() => new Set(run?.shortlist ?? []), [run?.shortlist]);

  function addGene() {
    const normalized = geneInput.trim().toUpperCase();
    if (!normalized || genes.includes(normalized)) { setGeneInput(""); return; }
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(normalized)) {
      setUiError("Use a valid gene symbol containing letters, digits, dots, underscores, or hyphens.");
      return;
    }
    if (genes.length >= 20) { setUiError("The dashboard accepts at most 20 candidate genes per run."); return; }
    setGenes((current) => [...current, normalized]);
    setGeneInput("");
    setUiError("");
  }

  async function startAnalysis() {
    setUiError("");
    setRunning(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancer, genes }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Could not start analysis.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AnalysisEvent;
          if (event.state) {
            setRun(event.state);
            if (event.state.health) setHealth(event.state.health);
          }
          if (event.type === "error") setUiError(event.message ?? "Analysis failed.");
        }
        if (done) break;
      }
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setRunning(false);
    }
  }

  async function downloadReport() {
    if (!run) return;
    setReportBusy(true);
    setUiError("");
    try {
      const response = await fetch(`/api/runs/${run.runId}/report`, { method: "POST" });
      const payload = await response.json() as { downloadUrl?: string; error?: string };
      if (!response.ok || !payload.downloadUrl) throw new Error(payload.error ?? "Report generation failed.");
      const link = document.createElement("a");
      link.href = payload.downloadUrl;
      link.download = `target-defense-${run.runId}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "Report generation failed.");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="app-header">
        <div className="page-shell flex flex-col gap-7 py-8 lg:flex-row lg:items-end lg:justify-between lg:py-11">
          <div>
            <div className="brand-lockup"><span>TD</span><p>TargetDefense AI</p></div>
            <h1>Adversarial evidence-based<br className="hidden sm:block" /> oncology target selection</h1>
            <p className="header-subtitle">Cancer Target Defense <span>•</span> TCGA <span>•</span> Literature <span>•</span> Clinical Evidence <span>•</span> Red-Team Validation</p>
          </div>
          <div className="api-status-card">
            <div><span className={`health-dot ${health?.status === "online" ? "online" : health ? "offline" : "checking"}`} /><p>TCGA / Xena API</p></div>
            <strong>{health?.status === "online" ? "Online" : health ? "Unavailable" : "Checking"}</strong>
            <small>{health?.status === "online" ? `Selected after ${health.attempts.length} health check${health.attempts.length === 1 ? "" : "s"}` : "Primary → fallback → local"}</small>
          </div>
        </div>
      </header>

      <div className="page-shell space-y-10 py-8 lg:py-12">
        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]" aria-labelledby="configuration-title">
          <div className="panel">
            <div className="section-heading">
              <div><p className="step-label">01 · Configure</p><h2 id="configuration-title">Analysis configuration</h2></div>
              <span className="method-chip">Local orchestration</span>
            </div>
            <label className="field-label mt-7" htmlFor="cancer">TCGA cancer</label>
            <select id="cancer" className="select-control" value={cancer} onChange={(event) => setCancer(event.target.value)} disabled={running}>
              {cancers.map((item) => <option value={item.code} key={item.code}>{item.code} — {item.name}</option>)}
            </select>
            <p className="field-help">Loaded from ClawBio&apos;s <code>tcga_codes.md</code> mapping.</p>

            <label className="field-label mt-6" htmlFor="gene">Candidate genes</label>
            <div className="gene-input-row">
              <input id="gene" className="text-control" value={geneInput} placeholder="Add HGNC symbol" disabled={running}
                onChange={(event) => setGeneInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addGene(); } }} />
              <button className="secondary-button" type="button" onClick={addGene} disabled={running}>Add gene</button>
            </div>
            <div className="gene-chips" aria-label="Selected candidate genes">
              {genes.map((gene) => (
                <span className="gene-chip" key={gene}>{gene}<button type="button" aria-label={`Remove ${gene}`} disabled={running || genes.length === 1} onClick={() => setGenes((current) => current.filter((item) => item !== gene))}>×</button></span>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <button className="primary-button" type="button" disabled={running || genes.length === 0} onClick={startAnalysis}>
                {running ? "Analysis running…" : "Run analysis"}
              </button>
              <button className="text-button" type="button" disabled={running} onClick={() => { setCancer("LUAD"); setGenes(DEFAULT_GENES); setGeneInput(""); }}>Reset defaults</button>
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-500">Every run gets a unique timestamped directory. No existing scientific output is overwritten.</p>
          </div>

          <div className="panel progress-panel" aria-live="polite">
            <div className="section-heading">
              <div><p className="step-label">02 · Observe</p><h2>Pipeline progress</h2></div>
              <span className="method-chip">{run ? `${completedStages}/8 complete` : "Ready"}</span>
            </div>
            <ol className="pipeline-list mt-6">
              {(run?.stages ?? [
                "TCGA Expression", "TCGA Survival", "Candidate Ranking", "Target Evidence",
                "Literature / Clinical Evidence", "Red-Team Analysis", "Target Validation", "Final Decision",
              ].map((label, index) => ({ id: String(index), label: `${index + 1}. ${label}`, status: "pending" as const }))).map((stage) => (
                <li key={stage.id} className={stage.status === "running" ? "active" : ""}>
                  <span className={`stage-marker ${statusTone(stage.status)}`}>{stage.status === "completed" ? "✓" : stage.status === "failed" ? "!" : stage.status === "insufficient" ? "—" : stage.status === "running" ? "•" : ""}</span>
                  <div><p>{stage.label}</p><small>{("message" in stage ? stage.message : undefined) ?? stage.status}</small></div>
                </li>
              ))}
            </ol>
            {run && <div className="run-meta mt-6"><span>Run {run.runId}</span><span>{run.status}</span></div>}
          </div>
        </section>

        {uiError && <div className="error-box" role="alert"><strong>Visible error</strong><p>{uiError}</p></div>}

        {run && (
          <>
            <section aria-labelledby="screening-title">
              <div className="section-heading section-heading-outside">
                <div><p className="step-label">03 · Screen</p><h2 id="screening-title">TCGA candidate screening</h2><p>Real aggregate values returned by xena-tcga-gene-query. No patient-level plots are inferred.</p></div>
                <details className="rubric-popover"><summary>View ranking rubric</summary><div><p>{SCREENING_RUBRIC.expression.join(" · ")}</p><p>{SCREENING_RUBRIC.survival.join(" · ")}</p><p>{SCREENING_RUBRIC.shortlist}</p></div></details>
              </div>
              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                {run.candidates.map((candidate) => <CandidateScreening candidate={candidate} key={candidate.gene} />)}
              </div>
            </section>

            <section className="panel" aria-labelledby="ranking-title">
              <div className="section-heading">
                <div><p className="step-label">04 · Rank</p><h2 id="ranking-title">Transparent initial ranking</h2></div>
                <span className="method-chip">Screening, not validation</span>
              </div>
              <div className="table-wrap mt-6">
                <table>
                  <thead><tr><th>Rank</th><th>Gene</th><th>Expression</th><th>Survival</th><th>Points</th><th>Initial status</th></tr></thead>
                  <tbody>{run.candidates.map((candidate, index) => (
                    <tr key={candidate.gene}>
                      <td>{index + 1}</td><td><strong>{candidate.gene}</strong></td><td>{candidate.screening?.expressionLabel ?? "Insufficient evidence"}</td><td>{candidate.screening?.survivalLabel ?? "Insufficient evidence"}</td><td>{candidate.screening?.totalPoints ?? "—"}</td><td><span className={`status-pill ${shortlist.has(candidate.gene) ? "status-positive" : "status-neutral"}`}>{candidate.screening?.status ?? "Pending"}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>

            {run.targets.length > 0 && (
              <section aria-labelledby="targets-title">
                <div className="section-heading section-heading-outside">
                  <div><p className="step-label">05 · Challenge</p><h2 id="targets-title">Shortlisted target defense</h2><p>Supporting and opposing evidence receive equal visual weight.</p></div>
                  <nav className="target-nav" aria-label="Shortlisted targets">{run.targets.map((target) => <a href={`#target-${target.gene}`} key={target.gene}>{target.gene}</a>)}</nav>
                </div>
                <div className="mt-5 space-y-7">{run.targets.map((target) => <TargetDetail target={target} run={run} key={target.gene} />)}</div>
              </section>
            )}

            <section aria-labelledby="decisions-title">
              <div className="section-heading section-heading-outside">
                <div><p className="step-label">06 · Decide</p><h2 id="decisions-title">Final decisions</h2><p>Scorer tiers are adopted only after the visible evidence-coverage gate.</p></div>
                <button className="secondary-button" type="button" onClick={downloadReport} disabled={running || reportBusy}>{reportBusy ? "Preparing…" : "Generate report"}</button>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                {run.decisions.length ? run.decisions.map((decision) => (
                  <article className={`decision-card ${decisionTone(decision.decision)}`} key={decision.target}>
                    <div className="flex items-center justify-between gap-3"><h3>{decision.target}</h3><span>{decision.decision}</span></div>
                    <p className="decision-score">{decision.score ?? "—"}<small> scorer score</small></p>
                    <dl><div><dt>Confidence</dt><dd>{decision.confidence}</dd></div><div><dt>Dimensions</dt><dd>{decision.scoredDimensions}/5</dd></div></dl>
                    <div className="decision-evidence"><p><strong>FOR</strong>{decision.strongestFor}</p><p><strong>AGAINST</strong>{decision.strongestAgainst}</p></div>
                    <p className="mt-4 text-xs leading-5 opacity-80">{decision.explanation}</p>
                  </article>
                )) : <div className="empty-state">No target reached final validation. Insufficient Evidence is preserved.</div>}
              </div>
            </section>

            <section className={`killed-panel ${run.killedTarget?.basis === "none" ? "not-killed" : ""}`} aria-labelledby="killed-title">
              <div className="killed-symbol" aria-hidden="true">{run.killedTarget?.basis === "none" ? "—" : "×"}</div>
              <div>
                <p className="step-label">TARGET KILLED</p>
                <h2 id="killed-title">{run.killedTarget?.basis === "none" ? "No defensible rejection in this run" : `${run.killedTarget?.target} rejected`}</h2>
                <p className="mt-3 max-w-3xl leading-7">{run.killedTarget?.killedBecause ?? "No target was forced to fail."}</p>
                {run.killedTarget?.basis !== "none" && <><h3 className="mt-5">Critical negative evidence</h3><ul className="plain-list mt-2">{run.killedTarget?.criticalNegativeEvidence.map((item) => <li key={item}>{item}</li>)}</ul><span className="killed-decision">Final decision · {run.killedTarget?.decision}</span></>}
              </div>
            </section>

            {run.errors.length > 0 && (
              <section className="panel" aria-labelledby="errors-title"><div className="section-heading"><div><p className="step-label">Partial results preserved</p><h2 id="errors-title">Errors and unavailable evidence</h2></div><span className="status-pill status-negative">{run.errors.length} errors</span></div><ul className="plain-list mt-5">{run.errors.map((error) => <li key={error}>{error}</li>)}</ul></section>
            )}

            <details className="raw-panel">
              <summary>Full Run JSON / Reproducibility</summary>
              <div className="raw-grid"><div><p className="eyebrow">Configuration and artifacts</p><pre>{JSON.stringify({ runId: run.runId, config: run.config, health: run.health, reportPath: run.reportPath }, null, 2)}</pre></div><div><p className="eyebrow">Complete normalized run</p><pre>{JSON.stringify(run, null, 2)}</pre></div></div>
            </details>
          </>
        )}

        {!run && <section className="empty-state"><p className="eyebrow">Ready for evidence</p><h2>{selectedCancer?.code} · {selectedCancer?.name}</h2><p>Run the preconfigured LUAD panel to move from TCGA screening to adversarial target defense.</p></section>}

        <footer><p>{run?.disclaimer ?? "ClawBio is a research and educational tool. It is not a medical device and does not provide clinical diagnoses. Consult a healthcare professional before making any medical decisions."}</p></footer>
      </div>
    </main>
  );
}
