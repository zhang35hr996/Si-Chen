import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import { pickAutoStartEvent } from "../../src/engine/events/router";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (locationId: string): GameState => ({ ...createNewGameState(db), playerLocation: locationId });

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

const zichen = db.locations.zichendian;

describe("pickAutoStartEvent", () => {
  it("auto checkpoint only starts auto_on_enter, never a higher-priority request_audience", () => {
    const auto = mkEvent({ id: "ev_auto", priority: 1, presentation: { mode: "auto_on_enter" } });
    const audience = mkEvent({
      id: "ev_aud",
      priority: 9,
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    const picked = pickAutoStartEvent(withEvents(auto, audience), at("zichendian"), "location_enter", zichen);
    expect(picked?.id).toBe("ev_auto");
  });

  it("returns null when only request_audience / exploration / manual are eligible", () => {
    const audience = mkEvent({
      id: "ev_aud",
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    expect(pickAutoStartEvent(withEvents(audience), at("zichendian"), "location_enter", zichen)).toBeNull();
  });

  it("scene_end does not auto-start a manual event", () => {
    const manual = mkEvent({ id: "ev_m", checkpoint: "scene_end", presentation: { mode: "manual" } });
    expect(pickAutoStartEvent(withEvents(manual), at("zichendian"), "scene_end", zichen)).toBeNull();
  });

  it("time_advance does not auto-start a request_audience event", () => {
    const audience = mkEvent({
      id: "ev_aud",
      checkpoint: "time_advance",
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    });
    expect(pickAutoStartEvent(withEvents(audience), at("zichendian"), "time_advance", zichen)).toBeNull();
  });

  it("skips unaffordable auto_on_enter events", () => {
    const auto = mkEvent({ id: "ev_auto", apCost: 1, presentation: { mode: "auto_on_enter" } });
    const broke = { ...at("zichendian"), calendar: { ...at("zichendian").calendar, ap: 0 } };
    expect(pickAutoStartEvent(withEvents(auto), broke, "location_enter", zichen)).toBeNull();
  });
});
