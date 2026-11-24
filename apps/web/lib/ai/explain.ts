import Anthropic from "@anthropic-ai/sdk";
import { buildExplainInput, EXPLAIN_SYSTEM, type ExplainFinding, type ExplainPush } from "@preflux/shared/explain";

// Server-only: imported by server actions. The key is read from ANTHROPIC_API_KEY in
// apps/web/.env.local (git-ignored) and never reaches the browser.

/** Default model; override with PREFLUX_AI_MODEL without changing code. */
export const AI_MODEL = process.env.PREFLUX_AI_MODEL ?? "claude-opus-5-5";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ExplainResult = { ok: true; text: string; model: string } | { ok: false; error: string };

export async function explainPush(push: ExplainPush, findings: ExplainFinding[]): Promise<ExplainResult> {
  if (!aiConfigured()) return { ok: false, error: "AI explanations are not set up on this server (no ANTHROPIC_API_KEY)." };

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      // Summarising a short report: low effort keeps it fast and cheap.
      output_config: { effort: "low" },
      // If the model declines, the API retries on its default fallback model within the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: EXPLAIN_SYSTEM,
      messages: [{ role: "user", content: buildExplainInput(push, findings) }],
    });

    if (response.stop_reason === "refusal") return { ok: false, error: "The AI declined to explain this push." };
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (!text) return { ok: false, error: "The AI returned an empty explanation. Try again." };
    return { ok: true, text, model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "The AI key on this server is invalid." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "Too many AI requests right now. Try again in a minute." };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "Could not reach the AI service. Check the internet connection." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `The AI service returned an error (${error.status ?? "no status"}).` };
    return { ok: false, error: "Could not reach the AI service." };
  }
}
