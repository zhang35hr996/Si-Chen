import { aiError, type GameError } from "../infra/errors";
import type { ProviderError } from "./providerContract";

const CODE: Record<ProviderError["kind"], string> = {
  transport: "PROVIDER_TRANSPORT", protocol: "PROVIDER_PROTOCOL", config: "PROVIDER_CONFIG",
  cancelled: "PROVIDER_CANCELLED", offline: "PROVIDER_OFFLINE", refused: "PROVIDER_REFUSED",
};

export function mapProviderErrorToGameError(e: ProviderError): GameError {
  const cause = "cause" in e ? e.cause : undefined;
  return aiError(CODE[e.kind], `dialogue provider failed: ${e.kind}${cause ? `/${cause}` : ""}`, {
    severity: e.retryable ? "warn" : "error",
    context: {
      kind: e.kind,
      ...(cause !== undefined ? { cause } : {}),
      ...(e.meta?.requestId !== undefined ? { requestId: e.meta.requestId } : {}),
      ...(e.meta?.statusCode !== undefined ? { statusCode: e.meta.statusCode } : {}),
    },
  });
}
