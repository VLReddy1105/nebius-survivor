import "server-only";

import { runPythonTool, ToolExecutionError } from "./runner";
import { skillScript } from "./paths";
import type { CommandRecord, PaperEvidence } from "@/types/analysis";

const PUBMED_SCRIPT = skillScript("pubmed-summariser", "pubmed_summariser.py");

function parsePapers(stdout: string): PaperEvidence[] {
  const blocks = stdout.split(/\n(?=\d+\.\s)/);
  const papers: PaperEvidence[] = [];
  for (const block of blocks) {
    const title = block.match(/^(?:\d+\.\s)(.+)$/m)?.[1]?.trim();
    const url = block.match(/URL:\s+(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/)/)?.[1];
    const pmid = block.match(/URL:\s+https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\//)?.[1];
    const journalLine = block.match(/^\s*Journal:\s*(.+)$/m)?.[1]?.trim();
    if (!title || !url || !pmid) continue;
    const [source, publicationDate] = journalLine?.split(" | ") ?? ["PubMed", undefined];
    papers.push({
      pmid,
      title,
      source: source || "PubMed",
      publicationDate,
      url,
      verified: true,
    });
  }
  return papers;
}

export async function queryPubMed(
  gene: string,
  disease: string,
  outputDirectory: string,
): Promise<{ papers: PaperEvidence[]; record: CommandRecord }> {
  const record = await runPythonTool({
    skill: "pubmed-summariser",
    script: PUBMED_SCRIPT,
    args: [
      "--query",
      `"${gene}"[Title/Abstract] AND "${disease}"[Title/Abstract]`,
      "--max-results",
      "5",
      "--output",
      outputDirectory,
    ],
    outputDirectory,
    timeoutMs: 120_000,
  });
  if (record.exitCode !== 0) {
    throw new ToolExecutionError(
      `PubMed retrieval failed for ${gene}: ${record.stderr.trim() || `exit code ${record.exitCode}`}`,
      record,
    );
  }
  return { papers: parsePapers(record.stdout), record };
}

export function mergePapers(...collections: PaperEvidence[][]): PaperEvidence[] {
  const byPmid = new Map<string, PaperEvidence>();
  for (const paper of collections.flat()) {
    if (!/^\d+$/.test(paper.pmid)) continue;
    byPmid.set(paper.pmid, { ...byPmid.get(paper.pmid), ...paper, verified: true });
  }
  return [...byPmid.values()];
}
