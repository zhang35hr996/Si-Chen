import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import { pickSubLocationEvent, subLocationEventAffordable } from "../../src/engine/map/subLocations";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (locationId: string): GameState => ({ ...createNewGameState(db), playerLocation: locationId });

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_x",
    title: "测试",
    sceneId: "sc_shen_neglect",
    checkpoint: "location_enter",
    condition: { atLocation: "yuhuayuan" },
    priority: 50,
    once: false,
    apCost: 0,
    ...patch,
  }) as GameEventContent;

const withEvents = (...events: GameEventContent[]): ContentDB =>
  ({ ...db, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

const exploration = (id: string, subLocationId: string, patch: Partial<GameEventContent> = {}): GameEventContent =>
  mkEvent({
    id,
    presentation: { mode: "exploration", hostLocationId: "yuhuayuan", subLocationId },
    ...patch,
  });

describe("pickSubLocationEvent", () => {
  it("binds via presentation.hostLocationId + subLocationId (static)", () => {
    const ev = exploration("ev_a", "taiyechi");
    expect(pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "taiyechi")?.id).toBe("ev_a");
  });

  it("event for the wrong subLocationId is not picked here", () => {
    const ev = exploration("ev_a", "fubiting");
    expect(pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "taiyechi")).toBeNull();
  });

  it("event for another hostLocationId is not picked here", () => {
    const ev = mkEvent({
      id: "ev_a",
      presentation: { mode: "exploration", hostLocationId: "zichendian", subLocationId: "taiyechi" },
    });
    expect(pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "taiyechi")).toBeNull();
  });

  it("a request_audience event in the same place is not treated as exploration", () => {
    const ev = mkEvent({
      id: "ev_aud",
      presentation: { mode: "request_audience", hostLocationId: "yuhuayuan", audienceCharacterId: "wei_ling", audiencePrompt: "候见。" },
    });
    expect(pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "taiyechi")).toBeNull();
  });

  it("at most one event; highest priority wins, tie broken by id asc", () => {
    const lo = exploration("ev_z", "taiyechi", { priority: 1 });
    const hi = exploration("ev_a", "taiyechi", { priority: 9 });
    expect(pickSubLocationEvent(withEvents(lo, hi), at("yuhuayuan"), "yuhuayuan", "taiyechi")?.id).toBe("ev_a");
    const tieA = exploration("ev_a", "taiyechi", { priority: 5 });
    const tieB = exploration("ev_b", "taiyechi", { priority: 5 });
    expect(pickSubLocationEvent(withEvents(tieB, tieA), at("yuhuayuan"), "yuhuayuan", "taiyechi")?.id).toBe("ev_a");
  });

  it("no eligible event → null (普通游览)", () => {
    const ev = exploration("ev_a", "taiyechi", { once: true, condition: { all: [{ atLocation: "yuhuayuan" }, { eventFired: "ev_a" }] } });
    // condition can't be met from a fresh state → not eligible
    expect(pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "jiangxuexuan")).toBeNull();
  });

  it("an unaffordable exploration event is STILL returned (exists), but reported as unaffordable", () => {
    const ev = exploration("ev_a", "taiyechi", { apCost: 99 });
    const picked = pickSubLocationEvent(withEvents(ev), at("yuhuayuan"), "yuhuayuan", "taiyechi");
    expect(picked?.id).toBe("ev_a"); // 事件存在（不因 AP 不足而消失）
    expect(subLocationEventAffordable({ ...at("yuhuayuan"), calendar: { ...at("yuhuayuan").calendar, ap: 1 } }, picked!)).toBe(false);
  });

  it("subLocationEventAffordable reflects AP vs apCost", () => {
    const ev = exploration("ev_a", "taiyechi", { apCost: 1 });
    const s = at("yuhuayuan");
    expect(subLocationEventAffordable({ ...s, calendar: { ...s.calendar, ap: 1 } }, ev)).toBe(true);
    expect(subLocationEventAffordable({ ...s, calendar: { ...s.calendar, ap: 0 } }, ev)).toBe(false);
  });
});
