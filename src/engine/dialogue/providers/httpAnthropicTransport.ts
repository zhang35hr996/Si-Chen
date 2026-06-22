import { z } from "zod";
import { ok, err, type Result } from "../../infra/result";
import type {
  AnthropicTransport, AnthropicRequestPayload,
  AnthropicTransportResult, AnthropicTransportFailure,
  TransportOptions,
} from "./anthropicProvider";

const relaySuccessSchema = z.object({
  message: z.object({
    stop_reason: z.string(),
    content: z.array(z.unknown()),
  }).passthrough(),
  requestId: z.string().optional(),
});

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
          let json: unknown;
          try {
            json = await res.json();
          } catch {
            return err({ kind: "network", message: "invalid JSON response" });
          }
          const parsed = relaySuccessSchema.safeParse(json);
          if (!parsed.success) {
            return err({ kind: "network", message: "relay response schema mismatch" });
          }
          return ok(parsed.data as AnthropicTransportResult);
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
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return err({ kind: "offline" });
          }
          return err({ kind: "network", message: e.message });
        }
        return err({ kind: "network", message: String(e) });
      }
    },
  };
}
