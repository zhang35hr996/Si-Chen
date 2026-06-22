/**
 * Shared deadline/cancel race for generative providers.
 *
 * Guarantees the timeout and caller-cancel resolve even if the underlying
 * transport ignores the AbortSignal. Mirrors the race logic originally inlined
 * in anthropicProvider; new providers (openai/gemini) reuse this so the
 * cancellation contract is identical across vendors.
 */

const TIMEOUT = Symbol("timeout");
const CANCEL = Symbol("cancel");
const DEFAULT_TIMEOUT_MS = 30000;

export type DeadlineOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "cancel" };

export async function runWithDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<DeadlineOutcome<T>> {
  if (opts?.signal?.aborted) return { kind: "cancel" };
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveCancel!: (v: typeof CANCEL) => void;
  const deadline = new Promise<typeof TIMEOUT>((res) => {
    timer = setTimeout(() => res(TIMEOUT), timeoutMs);
  });
  const cancel = new Promise<typeof CANCEL>((res) => {
    resolveCancel = res;
  });
  const onAbort = () => resolveCancel(CANCEL);
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const winner = await Promise.race([work(controller.signal), deadline, cancel]);
    if (winner === TIMEOUT) {
      controller.abort();
      return { kind: "timeout" };
    }
    if (winner === CANCEL) {
      controller.abort();
      return { kind: "cancel" };
    }
    return { kind: "ok", value: winner as T };
  } finally {
    opts?.signal?.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
  }
}
