import { describe, expect, it } from "vitest";
import { sceneStageStyle } from "../../src/ui/components/sceneShellStyle";

describe("sceneStageStyle", () => {
  it("wraps the background url and defaults position to center", () => {
    expect(sceneStageStyle("/assets/backgrounds/zichendian_morning.png")).toEqual({
      backgroundImage: 'url("/assets/backgrounds/zichendian_morning.png")',
      backgroundPosition: "center",
    });
  });

  it("passes through an explicit backgroundPosition (crop focus)", () => {
    expect(sceneStageStyle("/bg.png", "62% center")).toEqual({
      backgroundImage: 'url("/bg.png")',
      backgroundPosition: "62% center",
    });
  });
});
