/**
 * Google/Gemini SDK transport — the network seam for geminiProvider via
 * @google/genai. Lives under server/ so the browser bundle never imports the
 * SDK. Forces a single emit_dialogue_line function call (mode ANY). Maps SDK
 * errors onto GeminiTransportFailure; never throws for HTTP/network. Exercised
 * manually via `npm run smoke:gemini` (needs GEMINI_API_KEY); not in CI.
 */
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type {
  GeminiTransport,
  GeminiRequestPayload,
  GeminiTransportResult,
  GeminiTransportFailure,
} from "../../src/engine/dialogue/providers/geminiProvider";

export function createGeminiSdkTransport(apiKey: string): GeminiTransport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async send(
      p: GeminiRequestPayload,
      opts?: { signal?: AbortSignal },
    ): Promise<Result<GeminiTransportResult, GeminiTransportFailure>> {
      try {
        const resp = await ai.models.generateContent({
          model: p.model,
          contents: p.contents,
          config: {
            systemInstruction: p.systemInstruction,
            maxOutputTokens: p.maxOutputTokens,
            abortSignal: opts?.signal,
            tools: [{ functionDeclarations: [p.functionDeclaration] }],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                allowedFunctionNames: [p.functionDeclaration.name],
              },
            },
          },
        });
        const fc = resp.functionCalls ?? [];
        const u = resp.usageMetadata;
        return ok({
          functionCalls: fc.map((c) => ({ name: c.name ?? "", args: c.args })),
          ...(resp.candidates?.[0]?.finishReason ? { finishReason: String(resp.candidates[0].finishReason) } : {}),
          ...(u
            ? {
                usage: {
                  ...(u.promptTokenCount !== undefined ? { promptTokenCount: u.promptTokenCount } : {}),
                  ...(u.candidatesTokenCount !== undefined ? { candidatesTokenCount: u.candidatesTokenCount } : {}),
                  ...(u.cachedContentTokenCount !== undefined ? { cachedContentTokenCount: u.cachedContentTokenCount } : {}),
                },
              }
            : {}),
        });
      } catch (e: unknown) {
        const status = (e as { status?: unknown })?.status;
        if (typeof status === "number") return err({ kind: "http", status });
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
