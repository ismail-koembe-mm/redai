import type { ScanRun, ThreatModel } from "../../domain";

export interface FilePrioritizerPromptInput {
  run: ScanRun;
  threatModel: ThreatModel;
  candidatePathsFile: string;
  candidatePaths: string[]; // embed paths directly — Gemini API cannot read files from disk
  candidateCount: number;
  scratchDir: string;
}

export function buildFilePrioritizerAgentPrompt(input: FilePrioritizerPromptInput): string {
  const focusAreas = input.threatModel.recommendedFocusAreas.map((area) => ({
    title: area.title,
    rationale: area.rationale,
  }));
  const threats = input.threatModel.threats.map((threat) => ({
    title: threat.title,
    category: threat.category,
    severity: threat.severity,
    rationale: threat.rationale,
  }));
  const entrypoints = input.threatModel.entrypoints.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    location: entry.location ?? "",
    description: entry.description,
  }));

  // Embed up to 200 paths directly in the prompt.
  // Gemini API cannot read files from disk unlike Claude Code,
  // so we must provide the candidate list inline.
  const embeddedPaths = input.candidatePaths.slice(0, 200).join("\n");
  const remaining = input.candidateCount - Math.min(input.candidatePaths.length, 200);

  return `You are RedAI's file prioritization analyst.

Goal: rank source files by how likely they are to contain security-relevant code given the threat model below. A downstream stage uses your scores to pick which files get scanned in depth.

The source walker found ${input.candidateCount} candidate ${input.candidateCount === 1 ? "file" : "files"}. Here is the candidate file list:

${embeddedPaths}
${remaining > 0 ? `\n(${remaining} more files not shown — use the patterns above to infer what else might be security-relevant.)` : ""}

Score each file you choose to rank on a 0..1 scale where 1 means "definitely scan" and 0 means "almost certainly nothing security-relevant here". Be calibrated — most files shouldn't be 1.0. Files clearly out of scope (fixtures, generated code, vendored assets, pure UI, etc.) belong in "excluded" so they're skipped entirely.

Use bare relative file paths exactly as they appear in the candidate list above. Do not append line or column numbers to ranked or excluded paths.

IMPORTANT: Do NOT list individual excluded files. Only state the total count and general categories (e.g. "Excluded ~500 test fixtures, generated files, and assets"). This keeps your response focused on the security-relevant files.

Boundaries:
- Treat the source directory as read-only. Do not modify, delete, or move source files.
- You may write scratch files and run scripts under ${input.scratchDir} — use it freely for notes, groupings, or quick probes.

Source directory: ${input.run.target.kind === "source-directory" ? input.run.target.path : "unknown"}

Threat model focus areas:
${JSON.stringify(focusAreas, null, 2)}

Threats:
${JSON.stringify(threats, null, 2)}

Entrypoints:
${JSON.stringify(entrypoints, null, 2)}

Write your response as prose — a readable ranking document with your scores, rationales, and any exclusions. A separate structuring step will turn your write-up into the typed shape, so you do not need to think about JSON or enum values.

CRITICAL: Do NOT output JSON arrays anywhere in your response. All sections including "Excluded" MUST use standard markdown list format.

Correct format:
**Excluded (Score 0.0):**
- file1.test.ts
- file2.mock.ts

Incorrect format (never do this):
**Excluded (Score 0.0):**
["file1.test.ts", "file2.mock.ts"]
`;
}