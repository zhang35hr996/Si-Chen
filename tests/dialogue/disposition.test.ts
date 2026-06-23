import { describe, expect, it } from "vitest";
import { deriveDisposition, DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";

describe("deriveDisposition", () => {
  it("无 trait → 中性基线 50/50/50", () => {
    expect(deriveDisposition([])).toEqual(DEFAULT_DISPOSITION);
  });
  it("proud：门第↑、同情↓（多轴）", () => {
    const d = deriveDisposition(["proud"]);
    expect(d.statusConsciousness).toBeGreaterThan(50);
    expect(d.compassion).toBeLessThan(50);
  });
  it("多 trait 确定性叠加 + clamp", () => {
    const d = deriveDisposition(["proud", "cold", "calculating"]);
    expect(d.compassion).toBeLessThan(50);
    expect(d.statusConsciousness).toBeLessThanOrEqual(100);
    expect(d.discretion).toBeLessThanOrEqual(100);
  });
  it("discreet + status_conscious → 高 discretion（机器字段直接映射）", () => {
    const d = deriveDisposition(["discreet", "status_conscious"]);
    // discreet (+25) + status_conscious (+10) over the 50 baseline
    expect(d.discretion).toBe(85);
  });
  it("确定性：同输入同输出", () => {
    expect(deriveDisposition(["discreet", "calculating"])).toEqual(deriveDisposition(["discreet", "calculating"]));
  });
});
