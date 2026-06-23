import { describe, expect, it } from "vitest";
import type { GameEventContent, LocationContent } from "../../src/engine/content/schemas";
import { resolveEntryMode } from "../../src/engine/events/entryMode";

const ev = (patch: Partial<GameEventContent> = {}): GameEventContent =>
  ({
    id: "ev_x",
    title: "测试",
    sceneId: "sc_x",
    checkpoint: "location_enter",
    condition: { atLocation: "zichendian" },
    priority: 0,
    once: false,
    apCost: 0,
    ...patch,
  }) as GameEventContent;

const loc = (patch: Partial<LocationContent> = {}): LocationContent =>
  ({ id: "zichendian", zone: "palace", ...patch }) as LocationContent;

describe("resolveEntryMode", () => {
  it("explicit presentation.mode wins over derivation", () => {
    expect(resolveEntryMode(ev({ presentation: { mode: "manual" } }), loc())).toBe("manual");
  });

  it("court checkpoint derives to scheduled", () => {
    expect(resolveEntryMode(ev({ checkpoint: "court" }), loc())).toBe("scheduled");
  });

  it("location_enter at zichendian derives to request_audience", () => {
    expect(resolveEntryMode(ev(), loc({ id: "zichendian" }))).toBe("request_audience");
  });

  it("location_enter at yuhuayuan derives to exploration", () => {
    expect(resolveEntryMode(ev(), loc({ id: "yuhuayuan" }))).toBe("exploration");
  });

  it("location_enter at a hougong palace derives to auto_on_enter", () => {
    expect(resolveEntryMode(ev(), loc({ id: "yanhe_gong", zone: "hougong" }))).toBe("auto_on_enter");
  });

  it("game_start / scene_end / time_advance derive to auto_on_enter", () => {
    expect(resolveEntryMode(ev({ checkpoint: "game_start" }), loc())).toBe("auto_on_enter");
    expect(resolveEntryMode(ev({ checkpoint: "scene_end" }), loc())).toBe("auto_on_enter");
    expect(resolveEntryMode(ev({ checkpoint: "time_advance" }), loc())).toBe("auto_on_enter");
  });
});
