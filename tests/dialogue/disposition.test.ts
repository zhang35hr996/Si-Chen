import { describe, expect, it } from "vitest";
import { deriveDisposition, DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";

describe("deriveDisposition", () => {
  it("无标签 → 中性基线 50/50/50", () => {
    expect(deriveDisposition([]).disposition).toEqual(DEFAULT_DISPOSITION);
  });
  it("高傲：门第↑、同情↓（多轴）", () => {
    const d = deriveDisposition(["高傲"]).disposition;
    expect(d.statusConsciousness).toBeGreaterThan(50);
    expect(d.compassion).toBeLessThan(50);
  });
  it("多标签确定性叠加 + clamp", () => {
    const d = deriveDisposition(["势利", "刻薄", "高傲"]).disposition;
    expect(d.compassion).toBe(0); // 叠加后下溢 clamp 到 0
    expect(d.statusConsciousness).toBeLessThanOrEqual(100);
  });
  it("未映射标签忽略、不报错、不影响三轴，但进 diagnostics", () => {
    const r = deriveDisposition(["才思敏捷", "仁厚"]);
    expect(r.disposition.compassion).toBeGreaterThan(50); // 仁厚生效
    expect(r.disposition.statusConsciousness).toBe(50);    // 才思敏捷不影响
    expect(r.diagnostics).toContainEqual({ code: "unknown_personality_trait", trait: "才思敏捷" });
  });
  it("确定性：同输入同输出", () => {
    expect(deriveDisposition(["谨慎", "圆滑"])).toEqual(deriveDisposition(["谨慎", "圆滑"]));
  });
});
