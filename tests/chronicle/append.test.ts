import { describe, expect, it } from "vitest";
import { appendCourtEvent, courtEventId } from "../../src/engine/chronicle/append";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent } from "../../src/engine/state/types";

const draft: Omit<CourtEvent, "id"> = {
  type: "rank_changed",
  occurredAt: makeGameTime(1, 1, "early"), // = createInitialState 的 now（非未来）
  participants: [{ charId: "consort_gu", role: "demoted" }],
  payload: { from: "chengyi", to: "meiren" },
  publicity: { scope: "palace", persistence: "contemporaneous" },
  publicSalience: 60,
  retention: "slow",
  tags: ["demotion"],
};

describe("appendCourtEvent", () => {
  it("单调 id 且不改入参", () => {
    expect(courtEventId(1)).toBe("evt_000001");
    const s0 = createInitialState();
    const { state: s1, event: e1 } = appendCourtEvent(s0, draft);
    expect(e1.id).toBe("evt_000001");
    expect(s1.chronicle).toHaveLength(1);
    expect(s0.chronicle).toHaveLength(0);

    const { event: e2 } = appendCourtEvent(s1, draft);
    expect(e2.id).toBe("evt_000002");
  });

  it("从最大序号派生（空洞不重号；忽略非 evt_ id）", () => {
    const s = createInitialState();
    s.chronicle.push({ ...draft, id: "evt_000005" }); // 人为留洞
    s.chronicle.push({ ...draft, id: "legacy_999999" }); // 非法前缀须被忽略，不参与 max
    const { event } = appendCourtEvent(s, draft);
    expect(event.id).toBe("evt_000006"); // 不是 evt_000002，也不受 legacy_999999 影响
  });

  it("拒绝未来事件（occurredAt > now）", () => {
    const s = createInitialState(); // 开局 元年一月上旬
    const future = { ...draft, occurredAt: makeGameTime(5, 1, "early") };
    expect(() => appendCourtEvent(s, future)).toThrow();
  });
});
