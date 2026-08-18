import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

export const APP_ROOT = process.cwd();
export const REPO_ROOT = path.resolve(process.env.CLAWBIO_REPO_ROOT || APP_ROOT, process.env.CLAWBIO_REPO_ROOT ? "." : "..");
export const RESULTS_ROOT = path.join(APP_ROOT, "results");
export const RUNS_ROOT = path.join(RESULTS_ROOT, "runs");
export const REPORTS_ROOT = path.join(RESULTS_ROOT, "reports");

export function pythonExecutable(): string {
  if (process.env.CLAWBIO_PYTHON) return process.env.CLAWBIO_PYTHON;
  const repositoryVenv = path.join(REPO_ROOT, ".venv", "bin", "python");
  return existsSync(repositoryVenv) ? repositoryVenv : "python3";
}

export function skillScript(...segments: string[]): string {
  const resolved = path.resolve(REPO_ROOT, "skills", ...segments);
  const skillsRoot = path.resolve(REPO_ROOT, "skills") + path.sep;
  if (!resolved.startsWith(skillsRoot)) {
    throw new Error("Resolved skill path is outside the ClawBio skills directory.");
  }
  return resolved;
}

export function toArtifactPath(absolutePath: string): string {
  const relative = path.relative(APP_ROOT, absolutePath);
  return relative.split(path.sep).join("/");
}
