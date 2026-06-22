import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type {
  AnthropicTransport,
  AnthropicRequestPayload,
  AnthropicTransportResult,
  AnthropicTransportFailure,
  AnthropicToolUseResponse,
} from "../../src/engine/dialogue/providers/anthropicProvider";

export function createAnthropicSdkTransport(apiKey: string): AnthropicTransport {
  const client = new Anthropic({ apiKey });
  return {
    async send(payload: AnthropicRequestPayload): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>> {
      try {
        const msg = await client.messages.create(payload as unknown as MessageCreateParamsNonStreaming);
        return ok({
          message: msg as unknown as AnthropicToolUseResponse,
          requestId: msg.id,
        });
      } catch (e: unknown) {
        const status = (e as { status?: number }).status;
        const headers = (e as { headers?: Record<string, string> }).headers ?? {};
        if (typeof status === "number") {
          const retryAfterRaw = headers["retry-after"];
          const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : undefined;
          return err({ kind: "http", status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
        }
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
