/**
 * App 自动 checkpoint 路由（Commit A）。App.tsx 的五处自动启动点（runCheckpoints 的
 * time_advance/location_enter、proceedAfterNewGame 的 game_start、onDone 的 scene_end /
 * rollover time_advance）现在都经 pickAutoStartEvent 选择，传入与选择同一快照对应的 location。
 *
 * 仓库无 <App> 渲染测试基座（UI 测试惯例为测纯逻辑）；本文件验证 App 所依赖的选择函数在
 * 这五个 checkpoint 下、对真实内容与合成事件给出正确结论——即 App 实际会自动启动/不启动什么。
 */
import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import { pickAutoStartEvent } from "../../src/engine/events/router";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (locationId: string): GameState => ({ ...createNewGameState(db), playerLocation: locationId });
const locOf = (s: GameState) => db.locations[s.playerLocation];

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_x",
    title: "测试",
    sceneId: "sc_menses_rite",
    checkpoint: "location_enter",
    condition: { atLocation: "zichendian" },
    priority: 50,
    once: false,
    apCost: 0,
    ...patch,
  }) as GameEventContent;

const withEvents = (...events: GameEventContent[]): ContentDB =>
  ({ ...db, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

describe("App automatic checkpoint routing", () => {
  // ── real-content guarantees ──
  it("real auto_on_enter event (ev_shen_neglect @ 御花园) auto-starts on location_enter", () => {
    const s = at("yuhuayuan");
    expect(pickAutoStartEvent(db, s, "location_enter", locOf(s))?.id).toBe("ev_shen_neglect");
  });

  it("real request_audience event (ev_menses_rite @ 紫宸殿) is NOT auto-started on location_enter", () => {
    const s = at("zichendian");
    expect(pickAutoStartEvent(db, s, "location_enter", locOf(s))).toBeNull();
  });

  // ── checkpoint-specific (synthetic events injected the way App sees them) ──
  it("scene_end: a manual event is not auto-started", () => {
    const manual = mkEvent({ id: "ev_m", checkpoint: "scene_end", presentation: { mode: "manual" } });
    const s = at("zichendian");
    expect(pickAutoStartEvent(withEvents(manual), s, "scene_end", locOf(s))).toBeNull();
  });

  it("time_advance: a request_audience event is not auto-started", () => {
    const aud = mkEvent({
      id: "ev_aud",
      checkpoint: "time_advance",
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    const s = at("zichendian");
    expect(pickAutoStartEvent(withEvents(aud), s, "time_advance", locOf(s))).toBeNull();
  });

  it("location_enter: a lower-priority auto_on_enter wins over a higher-priority request_audience", () => {
    const auto = mkEvent({ id: "ev_auto", priority: 1, presentation: { mode: "auto_on_enter" } });
    const aud = mkEvent({
      id: "ev_aud",
      priority: 9,
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    const s = at("zichendian");
    expect(pickAutoStartEvent(withEvents(auto, aud), s, "location_enter", locOf(s))?.id).toBe("ev_auto");
  });

  it("location_enter: a legacy ordinary-location event WITHOUT presentation still auto-starts", () => {
    const legacy = mkEvent({ id: "ev_legacy", condition: { atLocation: "yanhe_gong" } }); // no presentation → derived auto_on_enter
    const s = at("yanhe_gong");
    expect(pickAutoStartEvent(withEvents(legacy), s, "location_enter", locOf(s))?.id).toBe("ev_legacy");
  });

  it("game_start: a normal auto event still starts", () => {
    const start = mkEvent({ id: "ev_start", checkpoint: "game_start", condition: { all: [] }, presentation: { mode: "auto_on_enter" } });
    const s = at("zichendian");
    expect(pickAutoStartEvent(withEvents(start), s, "game_start", locOf(s))?.id).toBe("ev_start");
  });

  it("no auto-start event eligible → returns null (App keeps its existing destination/fallback)", () => {
    const aud = mkEvent({
      id: "ev_aud",
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    const s = at("zichendian");
    expect(pickAutoStartEvent(withEvents(aud), s, "location_enter", locOf(s))).toBeNull();
  });
});
