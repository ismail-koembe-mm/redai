import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanRun } from "../../domain";

// Manifest files that reveal project technology stack
const MANIFEST_FILES = [
  "composer.json",
  "package.json",
  "go.mod",
  "requirements.txt",
  "Gemfile",
  "pom.xml",
  "build.gradle",
];

export function buildProjectBriefing(run: ScanRun): string {
  if (run.target.kind === "source-directory") {
    const sourceDir = run.target.path;
    const manifests: string[] = [];

    // Read manifest files to help Gemini identify the technology stack
    for (const filename of MANIFEST_FILES) {
      const filePath = join(sourceDir, filename);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf8");
          manifests.push(`--- Contents of ${filename} ---\n${content}\n--- End of ${filename} ---`);
        } catch {
          // Skip unreadable files
        }
      }
    }

    return [
      `Target source directory: ${sourceDir}`,
      manifests.length > 0
        ? `Project manifest files:\n${manifests.join("\n\n")}`
        : "Explore the source tree directly to understand architecture, assets, trust boundaries, entrypoints, and data flows.",
      "Identify relevant areas from the code and project structure.",
    ].join("\n\n");
  }

  return `Target: ${JSON.stringify(run.target)}`;
}