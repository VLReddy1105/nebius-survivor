import "server-only";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

import { pythonExecutable, REPO_ROOT } from "./paths";
import type { CommandRecord } from "@/types/analysis";

const MAX_CAPTURE_CHARS = 2_000_000;

function quoteForDisplay(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function boundedAppend(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return `${next.slice(0, MAX_CAPTURE_CHARS)}\n[output truncated by TargetDefense AI]`;
}

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly record: CommandRecord,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

interface RunToolOptions {
  skill: string;
  script: string;
  args: string[];
  outputDirectory?: string;
  timeoutMs?: number;
}

export async function runPythonTool(options: RunToolOptions): Promise<CommandRecord> {
  await access(options.script);
  const executable = pythonExecutable();
  const args = [options.script, ...options.args];
  const started = new Date();
  const startedAt = started.toISOString();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn(executable, args, {
      cwd: REPO_ROOT,
      shell: false,
      env: {
        ...process.env,
        PYTHONPATH: [REPO_ROOT, process.env.PYTHONPATH].filter(Boolean).join(":"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs ?? 180_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on("error", (error) => {
      stderr = boundedAppend(stderr, Buffer.from(error.message));
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  if (timedOut) stderr += "\nTargetDefense AI stopped the command after its time limit.";
  const completed = new Date();
  const safeArgs = args.filter((arg, index) => args[index - 1] !== "--api-key");

  return {
    skill: options.skill,
    executable,
    args: safeArgs,
    commandDisplay: [executable, ...safeArgs].map(quoteForDisplay).join(" "),
    startedAt,
    completedAt: completed.toISOString(),
    durationMs: completed.getTime() - started.getTime(),
    exitCode,
    stdout,
    stderr,
    outputDirectory: options.outputDirectory,
  };
}
