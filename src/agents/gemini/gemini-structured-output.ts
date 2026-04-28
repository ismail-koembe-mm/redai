import { loadLocalEnv } from "../../config/load-local-env";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";

export interface CollectGeminiStructuredOutputInput {
    instructions: string;
    input: string;
    outputSchema: Record<string, unknown>;
    toolName: string;
    toolDescription: string;
    model?: string;
    maxTokens?: number;
    signal?: AbortSignal;
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

export async function collectGeminiStructuredOutput(
    input: CollectGeminiStructuredOutputInput,
): Promise<unknown> {
    const ai = createGeminiClient();

    const response = await ai.models.generateContent({
        model: input.model ?? "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: input.input }] }],
        config: {
            systemInstruction: input.instructions,
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: input.toolName,
                            description: input.toolDescription,
                            parameters: input.outputSchema,
                        },
                    ],
                },
            ],
            toolConfig: {
                functionCallingConfig: {
                    mode: FunctionCallingConfigMode.ANY,
                    allowedFunctionNames: [input.toolName],
                },
            },
            maxOutputTokens: input.maxTokens ?? 8192,
        },
    });

    const call = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.functionCall?.name === input.toolName,
    );
    return call?.functionCall?.args ?? undefined;
}

export function canUseGeminiApi(): boolean {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) loadLocalEnv();
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT);
}