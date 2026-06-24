import { describe, expect, it } from "vitest";
import { TraceCollector } from "../../src/engine/trace/collector";

describe("TraceCollector", () => {
  it("records mutations with default classification 'direct'", () => {
    const c = new TraceCollector();
    c.record({ path: "foo.bar", before: 1, after: 2, delta: 1 });
    const muts = c.getMutations();
    expect(muts).toHaveLength(1);
    expect(muts[0]).toMatchObject({ path: "foo.bar", before: 1, after: 2, delta: 1, classification: "direct" });
  });

  it("skips no-op mutations where before === after", () => {
    const c = new TraceCollector();
    c.record({ path: "x", before: 5, after: 5 });
    expect(c.getMutations()).toHaveLength(0);
  });

  it("withPhase labels mutations recorded inside the block", () => {
    const c = new TraceCollector();
    c.withPhase("monthly_tick", () => {
      c.record({ path: "health", before: 100, after: 90, delta: -10 });
    });
    const muts = c.getMutations();
    expect(muts[0]?.phase).toBe("monthly_tick");
  });

  it("restores prior phase after withPhase exits", () => {
    const c = new TraceCollector();
    c.withPhase("phase_a", () => {
      c.withPhase("phase_b", () => {/* noop */});
    });
    expect(c.currentPhase).toBe("effects");
  });

  it("withPhase restores phase even if fn throws", () => {
    const c = new TraceCollector();
    expect(() =>
      c.withPhase("broken", () => { throw new Error("boom"); })
    ).toThrow("boom");
    expect(c.currentPhase).toBe("effects");
  });

  it("records warnings", () => {
    const c = new TraceCollector();
    c.warn("something unexpected", "foo.bar");
    expect(c.getWarnings()).toHaveLength(1);
    expect(c.getWarnings()[0]).toMatchObject({ message: "something unexpected", path: "foo.bar" });
  });

  it("accepts 'untracked' classification override", () => {
    const c = new TraceCollector();
    c.record({ path: "x", before: 0, after: 1, classification: "untracked" });
    expect(c.getMutations()[0]?.classification).toBe("untracked");
  });
});
