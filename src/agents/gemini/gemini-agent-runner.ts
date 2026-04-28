import type { AgentEvent, AgentRunner, AgentValidationInput } from "../agent-runner";

export class GeminiAgentRunner implements AgentRunner {
    async *runValidation(input: AgentValidationInput): AsyncIterable<AgentEvent> {
        yield {
            type: "message",
            message: `Gemini Agent received goal: ${input.goal}`,
        };
        yield {
            type: "completed",
            summary: "Gemini Agent integration placeholder.",
        };
    }
}