import { ok, err, type Result } from "../../infra/result";
import type {
  AnthropicTransport, AnthropicRequestPayload,
  AnthropicTransportResult, AnthropicTransportFailure,
  TransportOptions,
} from "./anthropicProvider";

export function createHttpAnthropicTransport(endpoint = "/api/llm/anthropic"): AnthropicTransport {
  return {
    async send(
      payload: AnthropicRequestPayload,
      options?: TransportOptions,
    ): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>> {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: options?.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as AnthropicTransportResult;
          return ok(data);
        }
        const retryAfterRaw = res.headers.get("Retry-After");
        const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : undefined;
        return err<AnthropicTransportFailure>({
          kind: "http",
          status: res.status,
          ...(retryAfterMs ? { retryAfterMs } : {}),
        });
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          return err({ kind: "network", message: "aborted" });
        }
        if (e instanceof TypeError) {
          return err({ kind: "offline" });
        }
        return err({ kind: "network", message: String(e) });
      }
    },
  };
}
