import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GoogleGenAI, type Content } from "@google/genai";
import type { RunArtifactStore } from "../../artifacts/run-artifact-store";
import { loadLocalEnv } from "../../config/load-local-env";
import type { Artifact } from "../../domain";
import type { RunEventEmitter } from "../../pipeline/events";

export interface CollectGeminiAgentOutputInput {
    runId: string;
    prompt: string;
    model?: string;
    transcriptPath: string;
    transcriptTitle: string;
    artifactStore?: RunArtifactStore;
    emit?: RunEventEmitter;
    jobId?: string;
}

export interface CollectGeminiAgentOutputResult {
    structuredOutput: unknown;
    transcriptArtifact?: Artifact;
    finalResponse: string;
}

function createGeminiClient(): GoogleGenAI {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) loadLocalEnv();

    if (process.env.GOOGLE_CLOUD_PROJECT) {
        return new GoogleGenAI({
            vertexai: true,
            project: process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
        });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
    return new GoogleGenAI({ apiKey });
}

export function canUseGeminiAgentSdk(): boolean {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) loadLocalEnv();
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT);
}

export async function collectGeminiAgentOutput(
    input: CollectGeminiAgentOutputInput,
): Promise<CollectGeminiAgentOutputResult> {
    const ai = createGeminiClient();
    const messages: string[] = [];

    const enrichedPrompt = await injectFileContents(input.prompt);

    const contents: Content[] = [
        { role: "user", parts: [{ text: enrichedPrompt }] },
    ];

    const response = await ai.models.generateContent({
        model: input.model ?? "gemini-2.0-flash",
        contents,
        config: { maxOutputTokens: 8192 },
    });

    const finalResponse =
        response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    messages.push(`user: ${enrichedPrompt}`);
    messages.push(`assistant: ${finalResponse}`);

    const structuredOutput = extractJsonObject(finalResponse);

    await emitGeminiTrace(input, finalResponse);

    const transcriptContent = messages.join("\n") + "\n";
    const transcriptArtifact = input.artifactStore
        ? await input.artifactStore.writeText(
            input.runId,
            input.transcriptPath,
            transcriptContent,
            {
                kind: "agent-transcript",
                title: input.transcriptTitle,
                contentType: "text/plain",
                summary: `Captured ${messages.length} Gemini messages.`,
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

    return transcriptArtifact
        ? { structuredOutput, transcriptArtifact, finalResponse }
        : { structuredOutput, finalResponse };
}

async function injectFileContents(prompt: string): Promise<string> {
    const pathMatches = prompt.match(/\/[^\s"'`]+\.[a-zA-Z]{1,10}/g) ?? [];
    const unique = Array.from(new Set(pathMatches));
    let enriched = prompt;

    for (const filePath of unique) {
        if (!existsSync(filePath)) continue;
        try {
            const content = await readFile(filePath, "utf8");
            enriched += `\n\n--- Contents of ${filePath} ---\n${content}\n--- End of ${filePath} ---`;
        } catch {
            // Skip unreadable files
        }
    }
    return enriched;
}

async function emitGeminiTrace(
    input: CollectGeminiAgentOutputInput,
    response: string,
): Promise<void> {
    if (!input.emit || !input.jobId) return;
    await input.emit({
        type: "validation.agent.output",
        runId: input.runId,
        jobId: input.jobId,
        message: `Agent: ${response.slice(0, 220)}`,
    });
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