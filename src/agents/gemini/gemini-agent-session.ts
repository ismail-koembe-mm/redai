import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunArtifactStore } from "../../artifacts/run-artifact-store";
import { loadLocalEnv } from "../../config/load-local-env";
import type { Artifact } from "../../domain";
import type { RunEventEmitter } from "../../pipeline/events";

const execFileAsync = promisify(execFile);

export interface CollectGeminiAgentOutputInput {
    runId: string;
    prompt: string;
    model?: string;
    cwd?: string; // working directory for Gemini CLI — controls sandbox workspace
    transcriptPath: string;
    transcriptTitle: string;
    artifactStore?: RunArtifactStore;
    emit?: RunEventEmitter;
    jobId?: string;
    env?: Record<string, string>;
}

export interface CollectGeminiAgentOutputResult {
    structuredOutput: unknown;
    transcriptArtifact?: Artifact;
    finalResponse: string;
}

export function canUseGeminiAgentSdk(): boolean {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) loadLocalEnv();
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT);
}

export async function collectGeminiAgentOutput(
    input: CollectGeminiAgentOutputInput,
): Promise<CollectGeminiAgentOutputResult> {
    const agentEnv = { ...process.env, ...(input.env ?? {}) };
    const geminiPath = await resolveGeminiPath();
    const model = input.model ?? "gemini-2.5-flash";

    const args = [
        "-m", model,
        "--approval-mode", "yolo",
        "-p", input.prompt,
    ];

    let finalResponse = "";
    let stdout = "";
    let stderr = "";

    try {
        const result = await execFileAsync(geminiPath, args, {
            env: agentEnv,
            timeout: 5 * 60 * 1000, // 5 minutes
            maxBuffer: 10 * 1024 * 1024, // 10MB
            // Use provided cwd (source dir) so Gemini CLI can access source files.
            // home directory so ~/.redai is always accessible.
            cwd: process.env.HOME,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        finalResponse = stdout.trim();
    } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
        finalResponse = stdout.trim() || `Error: ${err.message ?? String(error)}`;
    }

    if (input.emit && input.jobId) {
        await input.emit({
            type: "validation.agent.output",
            runId: input.runId,
            jobId: input.jobId,
            message: `Agent: ${finalResponse.slice(0, 220)}`,
        });
    }

    const transcriptContent = [
        `user: ${input.prompt}`,
        `assistant: ${finalResponse}`,
        stderr ? `stderr: ${stderr}` : "",
    ].filter(Boolean).join("\n") + "\n";

    const transcriptArtifact = input.artifactStore
        ? await input.artifactStore.writeText(
            input.runId,
            input.transcriptPath,
            transcriptContent,
            {
                kind: "agent-transcript",
                title: input.transcriptTitle,
                contentType: "text/plain",
                summary: `Gemini CLI agent output captured.`,
            },
        )
        : undefined;

    if (transcriptArtifact && input.emit) {
        await input.emit({
            type: "artifact.created",
            runId: input.runId,
            jobId: input.transcriptPath,
            artifact: transcriptArtifact,
        });
    }

    const structuredOutput = extractJsonObject(finalResponse);

    return transcriptArtifact
        ? { structuredOutput, transcriptArtifact, finalResponse }
        : { structuredOutput, finalResponse };
}

async function resolveGeminiPath(): Promise<string> {
    try {
        const { stdout } = await execFileAsync("which", ["gemini"]);
        return stdout.trim();
    } catch {
        return "/opt/homebrew/bin/gemini";
    }
}

function extractJsonObject(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [
        fenced?.[1],
        text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    ].filter((v): v is string => Boolean(v?.trim()));

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // try next candidate
        }
    }
    return undefined;
}