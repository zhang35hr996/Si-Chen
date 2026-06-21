import { describe, it, expect } from "vitest";
import { mapProviderErrorToGameError } from "../../src/engine/dialogue/providerError";
import type { ProviderError } from "../../src/engine/dialogue/providerContract";

const cases: { e: ProviderError; code: string }[] = [
  { e: { kind: "transport", retryable: true, cause: "timeout" }, code: "PROVIDER_TRANSPORT" },
  { e: { kind: "protocol", retryable: false, cause: "pause_turn" }, code: "PROVIDER_PROTOCOL" },
  { e: { kind: "config", retryable: false, cause: "invalid_request" }, code: "PROVIDER_CONFIG" },
  { e: { kind: "cancelled", retryable: false }, code: "PROVIDER_CANCELLED" },
  { e: { kind: "offline", retryable: false }, code: "PROVIDER_OFFLINE" },
  { e: { kind: "refused", retryable: false }, code: "PROVIDER_REFUSED" },
];

describe("mapProviderErrorToGameError", () => {
  it("maps each kind to a stable ai code", () => {
    for (const { e, code } of cases) {
      const g = mapProviderErrorToGameError(e);
      expect(g.category).toBe("ai");
      expect(g.code).toBe(code);
    }
  });
  it("carries requestId/statusCode into context, nothing sensitive", () => {
    const g = mapProviderErrorToGameError({ kind: "transport", retryable: true, cause: "5xx", meta: { requestId: "req_1", statusCode: 503 } });
    expect(g.context).toMatchObject({ requestId: "req_1", statusCode: 503, cause: "5xx" });
  });
});
