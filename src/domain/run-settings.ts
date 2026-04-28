import { z } from "zod";

export const scanCoverageSchema = z.enum(["focused", "balanced", "thorough"]);
export type ScanCoverage = z.infer<typeof scanCoverageSchema>;

export const runSettingsSchema = z.object({
  validatorEnvironmentId: z.string(),
  scannerProvider: z.enum(["claude", "codex", "gemini"]),
  scanCoverage: scanCoverageSchema.default("balanced"),
  unitAgentConcurrency: z.number().int().positive(),
  validatorAgentConcurrency: z.number().int().positive(),
});
export type RunSettings = z.infer<typeof runSettingsSchema>;

export const defaultRunSettings: RunSettings = {
  validatorEnvironmentId: "",
  scannerProvider: "gemini",
  scanCoverage: "balanced",
  unitAgentConcurrency: 4,
  validatorAgentConcurrency: 2,
};