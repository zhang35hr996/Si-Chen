import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type {
  AnthropicTransport,
  AnthropicRequestPayload,
  AnthropicTransportResult,
  AnthropicTransportFailure,
  AnthropicToolUseResponse,
  TransportOptions,
} from "../../src/engine/dialogue/providers/anthropicProvider";

function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = parseInt(raw, 10);
  return isNaN(s) ? undefined : s * 1000;
}

export function createAnthropicSdkTransport(apiKey: string): AnthropicTransport {
  const client = new Anthropic({ apiKey });
  return {
    async send(
      payload: AnthropicRequestPayload,
      options?: TransportOptions,
    ): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>> {
      try {
        const msg = await client.messages.create(
          payload as unknown as MessageCreateParamsNonStreaming,
          { signal: options?.signal },
        );
        const message = msg as typeof msg & { _request_id?: string | null };
        return ok({
          message: message as unknown as AnthropicToolUseResponse,
          ...(message._request_id ? { requestId: message._request_id } : {}),
        });
      } catch (e: unknown) {
        if (e instanceof Anthropic.APIUserAbortError) {
          return err({ kind: "network", message: "aborted" });
        }
        if (e instanceof Anthropic.APIConnectionTimeoutError) {
          return err({ kind: "network", message: "timeout" });
        }
        if (e instanceof Anthropic.APIConnectionError) {
          return err({ kind: "network", message: e.message });
        }
        if (e instanceof Anthropic.APIError) {
          const retryAfterMs = parseRetryAfter(e.headers?.get("retry-after"));
          return err({
            kind: "http",
            status: e.status,
            ...(e.request_id ? { requestId: e.request_id } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          });
        }
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
