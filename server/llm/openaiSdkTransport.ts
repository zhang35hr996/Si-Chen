/**
 * OpenAI SDK transport — the network seam for openaiProvider. Lives under
 * server/ (not the engine) so the browser bundle never imports the SDK. Maps SDK
 * errors onto OpenAITransportFailure; never throws for HTTP/network. Exercised
 * manually via `npm run smoke:openai` (needs OPENAI_API_KEY); not in CI.
 */
import OpenAI from "openai";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type {
  OpenAITransport,
  OpenAIRequestPayload,
  OpenAITransportResult,
  OpenAITransportFailure,
} from "../../src/engine/dialogue/providers/openaiProvider";

function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = parseInt(raw, 10);
  return isNaN(s) ? undefined : s * 1000;
}

export function createOpenAISdkTransport(apiKey: string): OpenAITransport {
  const client = new OpenAI({ apiKey });
  return {
    async send(
      p: OpenAIRequestPayload,
      opts?: { signal?: AbortSignal },
    ): Promise<Result<OpenAITransportResult, OpenAITransportFailure>> {
      try {
        const resp = await client.chat.completions.create(
          {
            model: p.model,
            max_tokens: p.max_tokens,
            messages: p.messages,
            tools: p.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters as Record<string, unknown>, strict: t.function.strict },
            })),
            tool_choice: { type: "function" as const, function: { name: p.tool_choice.function.name } },
          },
          { signal: opts?.signal },
        );
        const choice = resp.choices[0];
        const toolCalls = (choice?.message.tool_calls ?? []).flatMap((t) =>
          t.type === "function" ? [{ function: { name: t.function.name, arguments: t.function.arguments } }] : [],
        );
        return ok({
          message: {
            finish_reason: choice?.finish_reason ?? "stop",
            tool_calls: toolCalls,
            usage: resp.usage
              ? {
                  prompt_tokens: resp.usage.prompt_tokens,
                  completion_tokens: resp.usage.completion_tokens,
                  prompt_tokens_details: resp.usage.prompt_tokens_details
                    ? { cached_tokens: resp.usage.prompt_tokens_details.cached_tokens }
                    : undefined,
                }
              : undefined,
          },
          ...(resp._request_id ? { requestId: resp._request_id } : {}),
        });
      } catch (e: unknown) {
        if (e instanceof OpenAI.APIUserAbortError) return err({ kind: "network", message: "aborted" });
        if (e instanceof OpenAI.APIConnectionTimeoutError) return err({ kind: "network", message: "timeout" });
        if (e instanceof OpenAI.APIConnectionError) return err({ kind: "network", message: e.message });
        if (e instanceof OpenAI.APIError) {
          const retryAfterMs = parseRetryAfter(e.headers?.get("retry-after"));
          return err({
            kind: "http",
            ...(typeof e.status === "number" ? { status: e.status } : {}),
            ...(e.requestID ? { requestId: e.requestID } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          });
        }
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
