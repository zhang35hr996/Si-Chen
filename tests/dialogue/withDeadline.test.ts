import { describe, it, expect } from "vitest";
import { runWithDeadline } from "../../src/engine/dialogue/providers/withDeadline";

describe("runWithDeadline", () => {
  it("returns ok when work resolves first", async () => {
    const r = await runWithDeadline(async () => 42, { timeoutMs: 1000 });
    expect(r).toEqual({ kind: "ok", value: 42 });
  });

  it("returns timeout when work is slow", async () => {
    const r = await runWithDeadline(
      () => new Promise((res) => setTimeout(() => res(1), 50)),
      { timeoutMs: 5 },
    );
    expect(r.kind).toBe("timeout");
  });

  it("returns cancel when pre-aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runWithDeadline(async () => 1, { timeoutMs: 1000, signal: ac.signal });
    expect(r.kind).toBe("cancel");
  });

  it("returns cancel when aborted mid-flight", async () => {
    const ac = new AbortController();
    const p = runWithDeadline(
      () => new Promise((res) => setTimeout(() => res(1), 1000)),
      { timeoutMs: 5000, signal: ac.signal },
    );
    ac.abort();
    const r = await p;
    expect(r.kind).toBe("cancel");
  });
});
