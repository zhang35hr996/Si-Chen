import { describe, expect, it } from "vitest";
import { healthStatusLabel } from "../../../src/ui/components/HealthStatusChip";

describe("healthStatusLabel", () => {
  it("returns 健康 for healthy", () => {
    expect(healthStatusLabel("healthy")).toBe("健康");
  });
  it("returns 生病 for sick", () => {
    expect(healthStatusLabel("sick")).toBe("生病");
  });
  it("returns 重病 for critical", () => {
    expect(healthStatusLabel("critical")).toBe("重病");
  });
});
