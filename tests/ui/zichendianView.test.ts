/**
 * 紫宸殿 App 接线纯决策层（Task 2.4b）。仓库无 <App> 渲染基座（见 tests/ui/autoRouting.test.ts 说明），
 * 故 App 依赖的判断都在此对真实内容 + 合成候见事件单测：视图模型映射、主动提示选取、提交后清账判定、
 * 外部 busy 归属，以及 App 实际调用的 defer/clear 候见生命周期往返。
 */
import { describe, expect, it } from "vitest";
import { AssetRegistry } from "../../src/engine/assets/registry";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import {
  audienceStatus,
  clearAudience,
  defer,
  deferredAudienceCount,
  getAudienceQueue,
  getDeferredAudienceQueue,
  audienceCount,
} from "../../src/engine/events/audience";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createGameStore } from "../../src/store/gameStore";
import type { GameState } from "../../src/engine/state/types";
import {
  audienceItemToPendingView,
  audienceItemToView,
  selectActiveAudience,
  shouldClearAudienceOnCommit,
  summonedConsortToView,
  zichendianExternalBusy,
  type ZichendianBusyInputs,
} from "../../src/ui/zichendianView";
import { loadRealContent } from "../helpers/contentFixture";

const real = loadRealContent();
const registry = new AssetRegistry({ version: 1, entries: {} });

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_a",
    title: "测试候见",
    sceneId: "sc_menses_rite",
    checkpoint: "location_enter",
    condition: { atLocation: "zichendian" },
    priority: 50,
    once: false,
    apCost: 1,
    presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "礼官候见。" },
    ...patch,
  }) as GameEventContent;

const dbWith = (...events: GameEventContent[]): ContentDB =>
  ({ ...real, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

const freshAt = (db: ContentDB, flags: Record<string, unknown> = {}): GameState => ({
  ...createNewGameState(db),
  playerLocation: "zichendian",
  flags: flags as GameState["flags"],
});

const storeAt = (db: ContentDB, flags: Record<string, unknown> = {}) => {
  const store = createGameStore();
  store.loadState(freshAt(db, flags));
  return store;
};

describe("selectActiveAudience", () => {
  const db = dbWith(
    mkEvent({ id: "ev_p", priority: 90 }),
    mkEvent({ id: "ev_q", priority: 80, presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "shen_yan", audiencePrompt: "户部候见。" } }),
  );

  it("returns the first available item by deterministic priority order", () => {
    const queue = getAudienceQueue(db, freshAt(db), "zichendian");
    expect(selectActiveAudience(queue)?.event.id).toBe("ev_p"); // priority 90 > 80
  });

  it("never returns a suppressed item; falls through to a pending one", () => {
    // ev_p deferred but not yet at remind → suppressed; ev_q available
    const state = freshAt(db, {
      "audience:pending:ev_p": true,
      "audience:remindAt:ev_p": 999,
    });
    const queue = getAudienceQueue(db, state, "zichendian");
    expect(queue.find((i) => i.event.id === "ev_p")?.status).toBe("suppressed");
    expect(selectActiveAudience(queue)?.event.id).toBe("ev_q"); // suppressed ev_p skipped
  });

  it("returns undefined when every item is suppressed", () => {
    const dbOne = dbWith(mkEvent({ id: "ev_p" }));
    const state = freshAt(dbOne, { "audience:pending:ev_p": true, "audience:remindAt:ev_p": 999 });
    expect(selectActiveAudience(getAudienceQueue(dbOne, state, "zichendian"))).toBeUndefined();
  });
});

describe("view-model mapping", () => {
  const db = dbWith(mkEvent({ id: "ev_p", apCost: 3 }));
  const item = getAudienceQueue(db, freshAt(db), "zichendian")[0]!;

  it("maps the active prompt without the component inspecting the DB", () => {
    const v = audienceItemToView(db, freshAt(db), registry, item);
    expect(v.eventId).toBe("ev_p");
    expect(v.message).toBe("礼官候见。");
    expect(v.visitorName).toBe(db.characters["wei_sui"]!.profile.name);
    expect(v.portraitSrc).toBeTruthy();
    expect(v.affordable).toBe(true);
    expect(v.disabledReason).toBeUndefined();
  });

  it("derives an unaffordable reason from the real AP cost", () => {
    const unaffordable = { ...item, affordable: false };
    const v = audienceItemToView(db, freshAt(db), registry, unaffordable);
    expect(v.affordable).toBe(false);
    expect(v.disabledReason).toContain("3"); // 需 3 行动点
  });

  it("maps a deferred item to a pending drawer view with its status", () => {
    const suppressed = { ...item, status: "suppressed" as const };
    const v = audienceItemToPendingView(db, freshAt(db), registry, suppressed);
    expect(v.status).toBe("suppressed");
    expect(v.eventId).toBe("ev_p");
    expect(v.visitorName).toBe(db.characters["wei_sui"]!.profile.name);
  });

  it("falls back to the character id when the character is unknown", () => {
    const ghost = { ...item, presentation: { ...item.presentation, audienceCharacterId: "no_such_char" } };
    const v = audienceItemToView(db, freshAt(db), registry, ghost);
    expect(v.visitorName).toBe("no_such_char");
    expect(v.portraitSrc).toBeUndefined();
  });
});

describe("summonedConsortToView", () => {
  const db = dbWith(mkEvent({}));
  it("renders an existing consort as a presence view-model", () => {
    const charId = Object.keys(db.characters).find((id) => db.characters[id]!.kind === "consort")!;
    const v = summonedConsortToView(db, freshAt(db), registry, charId);
    expect(v?.characterId).toBe(charId);
    expect(v?.name).toBe(db.characters[charId]!.profile.name);
    expect(v?.portraitSrc).toBeTruthy();
  });
  it("returns undefined for an unknown character", () => {
    expect(summonedConsortToView(db, freshAt(db), registry, "no_such_char")).toBeUndefined();
  });
});

describe("shouldClearAudienceOnCommit", () => {
  const audienceEv = mkEvent({ id: "ev_p" });
  const otherHost = mkEvent({ id: "ev_o", presentation: { mode: "request_audience", hostLocationId: "yuhuayuan", audienceCharacterId: "wei_sui", audiencePrompt: "x" } });
  const nonAudience = mkEvent({ id: "ev_n", presentation: undefined });

  it("clears only a committed request_audience event hosted here", () => {
    expect(shouldClearAudienceOnCommit(audienceEv, true, "zichendian")).toBe(true);
  });
  it("does not clear an abandoned event", () => {
    expect(shouldClearAudienceOnCommit(audienceEv, false, "zichendian")).toBe(false);
  });
  it("does not clear a committed event hosted elsewhere", () => {
    expect(shouldClearAudienceOnCommit(otherHost, true, "zichendian")).toBe(false);
  });
  it("does not clear a committed non-audience event", () => {
    expect(shouldClearAudienceOnCommit(nonAudience, true, "zichendian")).toBe(false);
  });
  it("does not clear when the completed event is missing", () => {
    expect(shouldClearAudienceOnCommit(undefined, true, "zichendian")).toBe(false);
  });
});

describe("zichendianExternalBusy", () => {
  const allFalse: ZichendianBusyInputs = {
    atomicFlowInProgress: false, relocateOpen: false, consortPickerOpen: false, consortListOpen: false,
    physicianOpen: false, physicianPickerOpen: false, heirListOpen: false, resourcePanelOpen: false,
    storehouseOpen: false, profileOpen: false, settingsOpen: false, choicePending: false, globalInterruptActive: false,
  };
  it("is false when nothing external is open", () => {
    expect(zichendianExternalBusy(allFalse)).toBe(false);
  });
  it("is true if any single external owner is active", () => {
    for (const key of Object.keys(allFalse) as (keyof ZichendianBusyInputs)[]) {
      expect(zichendianExternalBusy({ ...allFalse, [key]: true })).toBe(true);
    }
  });
});

// App's actual defer/clear calls, exercised through the real effect funnel.
describe("audience lifecycle the App drives", () => {
  it("available → defer(dayIndex) → suppressed; counts move from 候见 to 待宣", () => {
    const db = dbWith(mkEvent({ id: "ev_p" }));
    const store = storeAt(db);
    expect(audienceCount(db, store.getState(), "zichendian")).toBe(1);
    expect(deferredAudienceCount(db, store.getState(), "zichendian")).toBe(0);
    const applied = store.applyEffects(db, defer("ev_p", store.getState().calendar.dayIndex));
    expect(applied.ok).toBe(true);
    expect(audienceStatus(store.getState(), "ev_p")).toBe("suppressed");
    expect(audienceCount(db, store.getState(), "zichendian")).toBe(1); // still in 候见之人 total
    expect(deferredAudienceCount(db, store.getState(), "zichendian")).toBe(1); // now in 待宣
    expect(getDeferredAudienceQueue(db, store.getState(), "zichendian")[0]!.event.id).toBe("ev_p");
  });

  it("committed clearAudience resets pending/shown/remind flags back to available", () => {
    const db = dbWith(mkEvent({ id: "ev_p" }));
    const store = storeAt(db, {
      "audience:pending:ev_p": true, "audience:promptShownAt:ev_p": 5, "audience:remindAt:ev_p": 6,
    });
    expect(audienceStatus(store.getState(), "ev_p")).not.toBe("available");
    const applied = store.applyEffects(db, clearAudience("ev_p"));
    expect(applied.ok).toBe(true);
    expect(audienceStatus(store.getState(), "ev_p")).toBe("available");
  });

  it("a brand-new available event: 候见 1 / 待宣 0 (available items never enter the drawer)", () => {
    const db = dbWith(mkEvent({ id: "ev_p" }));
    const state = freshAt(db);
    expect(audienceCount(db, state, "zichendian")).toBe(1);
    expect(deferredAudienceCount(db, state, "zichendian")).toBe(0);
    expect(getDeferredAudienceQueue(db, state, "zichendian")).toHaveLength(0);
  });
});
