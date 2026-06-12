/**
 * Typed error hierarchy (skeleton-plan §10): every failure in the engine is a
 * GameError with a category, a stable code, a severity, and free-form context.
 * Rule: a player-visible degradation must map to exactly one logged GameError.
 */
export type ErrorCategory = "content" | "asset" | "ai" | "save" | "state";

export type ErrorSeverity = "fatal" | "error" | "warn";

export interface GameError {
  readonly category: ErrorCategory;
  /** Stable, grep-able code, e.g. "SCHEMA", "MISSING_REF", "CALENDAR_INVARIANT". */
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
}

export interface GameErrorOptions {
  severity?: ErrorSeverity;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export function gameError(
  category: ErrorCategory,
  code: string,
  message: string,
  options: GameErrorOptions = {},
): GameError {
  return {
    category,
    code,
    severity: options.severity ?? "error",
    message,
    ...(options.context !== undefined ? { context: options.context } : {}),
    ...(options.cause !== undefined ? { cause: options.cause } : {}),
  };
}

export const contentError = (code: string, message: string, options?: GameErrorOptions): GameError =>
  gameError("content", code, message, options);

export const assetError = (code: string, message: string, options?: GameErrorOptions): GameError =>
  gameError("asset", code, message, options);

export const aiError = (code: string, message: string, options?: GameErrorOptions): GameError =>
  gameError("ai", code, message, options);

export const saveError = (code: string, message: string, options?: GameErrorOptions): GameError =>
  gameError("save", code, message, options);

export const stateError = (code: string, message: string, options?: GameErrorOptions): GameError =>
  gameError("state", code, message, options);

/** Render as a stable single-line tag, e.g. "ContentError:MISSING_REF". */
export function formatErrorTag(error: GameError): string {
  const name = error.category.charAt(0).toUpperCase() + error.category.slice(1);
  return `${name}Error:${error.code}`;
}
