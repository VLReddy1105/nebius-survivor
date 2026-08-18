import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { REPO_ROOT } from "./paths";
import type { CancerOption } from "@/types/analysis";

const EXCLUDED_CODES = new Set(["CNTL", "FPPP", "MISC"]);

export async function getCancerOptions(): Promise<CancerOption[]> {
  const mappingPath = path.join(
    REPO_ROOT,
    "skills",
    "xena-tcga-gene-query",
    "references",
    "tcga_codes.md",
  );
  const content = await readFile(mappingPath, "utf8");
  const cancers: CancerOption[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(/^\|\s*([A-Z0-9]{2,8})\s*\|\s*([^|]+?)\s*\|$/);
    if (!match || match[1] === "Code" || EXCLUDED_CODES.has(match[1])) continue;
    cancers.push({ code: match[1], name: match[2].trim() });
  }

  if (!cancers.some((cancer) => cancer.code === "LUAD")) {
    throw new Error("ClawBio TCGA cancer mapping did not contain LUAD.");
  }
  return cancers;
}
