# TargetDefense AI

TargetDefense AI is the Challenge 2 dashboard for the ClawBio Berlin Hackathon: an adversarial, evidence-based cancer-target selection workflow that makes evidence **against** a target as visible as evidence **for** it.

The app is a separate Next.js project. It does not replace or modify ClawBio scientific methods. Server-only adapters invoke the existing Python skill scripts with argument arrays, retain their raw outputs, and normalize those outputs for the interface.

## Quick start

From the ClawBio repository root:

```bash
cd challenge2-cancer-target
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production verification:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

The repository Python environment is detected at `../.venv/bin/python`. Override it only when needed by creating a local `.env` from `.env.example` and setting `CLAWBIO_PYTHON`. Do not commit `.env` files.

## Demo steps

1. Keep the default cancer: **LUAD — Lung adenocarcinoma**.
2. Keep the default genes: **EGFR, MET, KRAS, BRAF, ERBB2, PIK3CA**.
3. Select **Run analysis**.
4. Watch all eight real pipeline stages. The hosted Xena service currently limits repeated same-endpoint calls, so the server queues a six-gene panel rather than dropping the sixth query.
5. Inspect the candidate ranking. Its complete point rubric is visible in the dashboard.
6. Open each shortlisted target and compare the equal-size **CASE FOR** and **CASE AGAINST** panels.
7. Inspect PubMed verification, every returned clinical-trial status, the real target-validation dimensions, missing evidence, and raw JSON.
8. Review **Target Killed**. The app shows a NO-GO only when the scorer or prespecified TCGA screen supports it; otherwise it explicitly says no defensible rejection was produced.
9. Select **Generate report** to download `results/reports/<run-id>.md`.
10. Refresh the page. The latest state is restored from `results/runs/<run-id>/state.json`.

## Integrated ClawBio skills

- `xena-tcga-gene-query`
  - Mandatory documented health sequence: primary, fallback, then local.
  - Differential expression and survival are separate real CLI calls.
  - Global `--output`, `--base-url`, and `--timeout` arguments are placed before the subcommand, matching the actual argparse parser.
- `omics-target-evidence-mapper`
  - UniProt target summary, Open Targets target/disease resolution, PubMed ESummary records, and ClinicalTrials.gov records.
- `clinical-trial-finder`
  - Dedicated ClinicalTrials.gov API v2 results with all statuses preserved.
- `pubmed-summariser`
  - Dedicated PubMed Entrez retrieval. A PMID is marked verified only when the skill returned a resolved PubMed record and numeric PMID URL.
- `target-validation-scorer`
  - Existing five dimensions and tier thresholds are unchanged.
  - Only dimensions supported by upstream outputs are populated in `validation_input.json`; missing fields remain `null`.

## Data flow

```text
Browser configuration
  → POST /api/analyze (NDJSON progress stream)
  → server validates TCGA code and gene symbols
  → Xena health check
  → ClawBio Xena CLI: expression + survival per gene
  → visible screening rubric and shortlist (up to three)
  → ClawBio evidence mapper + PubMed + clinical-trial finder
  → deterministic, evidence-linked red-team assessment
  → ClawBio target-validation scorer
  → evidence-coverage gate
  → GO / CONDITIONAL / NO-GO / INSUFFICIENT EVIDENCE
  → persisted JSON + Markdown report
```

The red-team step is deterministic. It does not ask an LLM to invent criticism. Every displayed supporting or opposing claim references returned tool evidence; absent toxicity, essentiality, specificity, or structural evidence is listed as **missing**, not fabricated as a negative result.

## Output structure

```text
results/
├── runs/<run-id>/
│   ├── config.json
│   ├── state.json
│   ├── final.json
│   ├── errors.json
│   ├── commands.json
│   ├── tcga/<gene>/{diff-expression,survival}/
│   ├── evidence/<gene>/{mapper,pubmed,trials}/
│   └── validation/<gene>/
└── reports/<run-id>.md
```

Each run uses a server-generated timestamp and random suffix. Existing output directories are never selected by the client and are never overwritten.

## Security

- Python is invoked only on the server with `child_process.spawn` and `shell: false`.
- Cancer codes must exist in ClawBio's `tcga_codes.md` mapping.
- Gene symbols must match a strict allow-list pattern and at most 20 genes are accepted.
- Client input cannot supply executable paths, output paths, script names, or arbitrary arguments.
- `UCSCXENA_API_KEY` is read server-side from the environment and is never placed in a command, response, generated report, or captured log.
- No secret uses a `NEXT_PUBLIC_*` variable.
- `.env*` files are ignored except `.env.example`, which contains variable names only.

## Scientific safeguards

- All TCGA expression, sample counts, p-values, survival values, PubMed records, and trial records displayed by a completed run originate in captured ClawBio tool outputs.
- Non-significant median-cutoff survival results are labelled as no significant association.
- Exploratory optimal-cutoff p-values are always labelled uncorrected and never add ranking points.
- TCGA association is never described as causality or therapeutic validation.
- Trial phase, completion, termination, or withdrawal is not interpreted as efficacy or safety by itself.
- Missing validation dimensions are not converted into zeros. The app requires at least three of the scorer's five dimensions before adopting a scorer GO or NO-GO tier; the rule is visible in the UI and output.
- A screening NO-GO is explicitly limited to the expression-led workflow and does not rule out a mutation-defined target hypothesis.
- Partial results and errors remain visible and are persisted.

## Known limitations

- The author-hosted Xena service and public literature/trial APIs require network access and can be unavailable or rate-limited.
- The current `omics-target-evidence-mapper` resolves Open Targets target/disease entities but does not emit a quantitative association score.
- The current upstream tools do not provide complete ChEMBL ligand counts, PDB structure metrics, DepMap essentiality, verified normal-tissue specificity, or target-specific toxicity for this workflow. Those validation dimensions therefore remain missing rather than inferred.
- `pubmed-summariser` writes HTML and terminal output rather than JSON; the adapter parses its stable terminal record format. Its field-qualified target/disease query is preferred for display, while broader mapper records remain in raw provenance and are used only as an empty-result fallback.
- ClinicalTrials.gov query matches can include observational or biomarker-context records. The dashboard shows the exact returned title, type, interventions, conditions, phase, and status without claiming direct target modulation.
- The coverage gate is a conservative application-level safeguard, not a new ClawBio scientific score.
- This is research decision support, not a medical device or clinical recommendation.
