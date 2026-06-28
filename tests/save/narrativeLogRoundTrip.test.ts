import { describe, expect, it } from "vitest";
import { exportSaveText, importSaveText } from "../../src/engine/save/saveSystem";
import { toGameTime } from "../../src/engine/calendar/time";
import { createGameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("narrativeLog 存读档 round-trip", () => {
  it("已记录的对话历史在存档后读回保持一致", () => {
    const store = createGameStore();
    store.newGame(db, 1);
    const now = toGameTime(store.getState().calendar);
    store.appendNarrativeLog([
      { at: now, speakerId: "narrator", lines: ["御花园中海棠初绽。"] },
      { at: now, speakerId: "player", lines: ["今日天气甚好。"] },
      { at: now, speakerId: "shen_zhibai", lines: ["陛下圣明。", "臣侍这便去办。"] },
    ]);
    const before = store.getState().narrativeLog ?? [];
    expect(before).toHaveLength(3);

    const loaded = importSaveText(db, exportSaveText(db, store.getState()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.narrativeLog).toEqual(before);
  });
});
