import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import { pickSubLocationEvent, subLocationEventAffordable, eventPinnedSubLocations, assignGardenOccupants } from "../../src/engine/map/subLocations";
import { gardenSubLocationFor } from "../../src/engine/characters/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadTestContent } from "../helpers/testContentFixture";

const db = loadTestContent();
const at = (locationId: string): GameState => ({ ...createNewGameState(db), playerLocation: locationId });

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_x",
    title: "测试",
    sceneId: "sc_fixture_scene_runner",
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

  it("P1: high-priority unaffordable + low-priority affordable → picks the affordable one (priority desc among affordable)", () => {
    const hiUnaffordable = exploration("ev_hi", "taiyechi", { priority: 9, apCost: 2 });
    const loAffordable = exploration("ev_lo", "taiyechi", { priority: 1, apCost: 1 });
    const s = { ...at("yuhuayuan"), calendar: { ...at("yuhuayuan").calendar, ap: 1 } }; // AP=1
    const picked = pickSubLocationEvent(withEvents(hiUnaffordable, loAffordable), s, "yuhuayuan", "taiyechi");
    expect(picked?.id).toBe("ev_lo"); // 取可承担者，而非抢占的高优先级不可承担者
    expect(subLocationEventAffordable(s, picked!)).toBe(true);
  });

  it("P1: two affordable candidates → highest priority wins (affordability does not override priority among affordable)", () => {
    const hi = exploration("ev_a", "taiyechi", { priority: 9, apCost: 1 });
    const lo = exploration("ev_z", "taiyechi", { priority: 1, apCost: 1 });
    const s = { ...at("yuhuayuan"), calendar: { ...at("yuhuayuan").calendar, ap: 5 } };
    expect(pickSubLocationEvent(withEvents(lo, hi), s, "yuhuayuan", "taiyechi")?.id).toBe("ev_a");
  });

  it("P1: all candidates unaffordable → returns highest-priority one so UI can show the reason", () => {
    const hi = exploration("ev_a", "taiyechi", { priority: 9, apCost: 9 });
    const lo = exploration("ev_z", "taiyechi", { priority: 1, apCost: 9 });
    const s = { ...at("yuhuayuan"), calendar: { ...at("yuhuayuan").calendar, ap: 1 } };
    const picked = pickSubLocationEvent(withEvents(hi, lo), s, "yuhuayuan", "taiyechi");
    expect(picked?.id).toBe("ev_a");
    expect(subLocationEventAffordable(s, picked!)).toBe(false);
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

describe("eventPinnedSubLocations", () => {
  const SUB_IDS = ["taiyechi", "tuixiushan", "jiangxuexuan"] as const;

  it("eligible event 的 scene participants 固定到其子地点", () => {
    // ev_fixture_scene_runner 绑定 taiyechi，scene sc_fixture_scene_runner participants=[wenya]
    const pinned = eventPinnedSubLocations(db, at("yuhuayuan"), "yuhuayuan", SUB_IDS);
    expect(pinned.get("wenya")).toBe("taiyechi");
  });

  it("已触发（一次性）事件不再产生固定映射", () => {
    // ev_fixture_scene_runner 是 once=true；写入 eventLog 后 getEligibleEvents 会排除它
    const base = at("yuhuayuan");
    const fired: GameState = {
      ...base,
      eventLog: [{ eventId: "ev_fixture_scene_runner", firedAt: base.calendar }],
    };
    const pinned = eventPinnedSubLocations(db, fired, "yuhuayuan", SUB_IDS);
    expect(pinned.has("wenya")).toBe(false);
  });

  it("无 exploration 事件的子地点不产生固定映射", () => {
    const pinned = eventPinnedSubLocations(db, at("yuhuayuan"), "yuhuayuan", ["tuixiushan"]);
    expect(pinned.size).toBe(0);
  });
});

describe("assignGardenOccupants", () => {
  const SUBS = ["taiyechi", "tuixiushan", "jiangxuexuan", "fubiting"] as const;
  const items = [
    { id: "a", name: "甲" },
    { id: "b", name: "乙" },
    { id: "c", name: "丙" },
  ];

  it("每名人物恰好出现在一个子地点（无重复、无遗漏）", () => {
    const map = assignGardenOccupants(items, new Map(), 7, 3, SUBS);
    const all = [...map.values()].flat().map((i) => i.id).sort();
    expect(all).toEqual(["a", "b", "c"]);
    // 无任何人物出现在两个子地点
    const seen = new Set<string>();
    for (const list of map.values()) for (const i of list) {
      expect(seen.has(i.id)).toBe(false);
      seen.add(i.id);
    }
  });

  it("事件钉扎优先于哈希分配（pinnedMap 覆盖 gardenSubLocationFor）", () => {
    const hashSub = gardenSubLocationFor(7, 3, "a", SUBS)!;
    const pinTarget = SUBS.find((s) => s !== hashSub)!; // 故意钉到非哈希结果
    const map = assignGardenOccupants(items, new Map([["a", pinTarget]]), 7, 3, SUBS);
    expect(map.get(pinTarget)!.some((i) => i.id === "a")).toBe(true);
    expect(map.get(hashSub)?.some((i) => i.id === "a") ?? false).toBe(false);
  });

  it("非钉扎人物落点与 gardenSubLocationFor 一致", () => {
    const map = assignGardenOccupants(items, new Map(), 7, 3, SUBS);
    for (const i of items) {
      const expected = gardenSubLocationFor(7, 3, i.id, SUBS)!;
      expect(map.get(expected)!.some((x) => x.id === i.id)).toBe(true);
    }
  });

  it("同 (seed, day, 角色) 分配稳定", () => {
    const a = assignGardenOccupants(items, new Map(), 42, 9, SUBS);
    const b = assignGardenOccupants(items, new Map(), 42, 9, SUBS);
    const flat = (m: Map<string, { id: string }[]>) =>
      [...m.entries()].map(([k, v]) => [k, v.map((i) => i.id).sort()]).sort();
    expect(flat(a)).toEqual(flat(b));
  });

  it("子地点为空时不产生任何归属", () => {
    const map = assignGardenOccupants(items, new Map(), 7, 3, []);
    expect(map.size).toBe(0);
  });
});
