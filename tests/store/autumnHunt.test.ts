import { describe, expect, it } from "vitest";
import { huntFurs, buildAutumnHuntPrompt } from "../../src/store/autumnHunt";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const LOW = ["tumao", "yezhiwei"];
const MID = ["diaopi", "lupi", "lurong"];
const HIGH = ["hulipi", "hupi", "yinlangpi"];

describe("秋猎掉落", () => {
  it("低武力只掉低档；数量 2–3", () => {
    const furs = huntFurs(20, "s1");
    expect(furs.length).toBeGreaterThanOrEqual(2);
    expect(furs.length).toBeLessThanOrEqual(3); // 最低档无额外掉落 → 上限 3
    for (const f of furs) expect(LOW).toContain(f);
  });
  it("高武力掉高档（可含 25% 下档）", () => {
    const furs = huntFurs(90, "s2");
    for (const f of furs) expect([...HIGH, ...MID]).toContain(f);
    expect(furs.some((f) => HIGH.includes(f))).toBe(true);
  });
  it("确定性：同 seed 同结果", () => {
    expect(huntFurs(50, "x")).toEqual(huntFurs(50, "x"));
  });
});

describe("秋猎询问触发", () => {
  it("9月中旬下午未问过 → 出 prompt；否则 null", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    const cal = { ...s.calendar, month: 9, period: "mid" as const, ap: s.calendar.apMax - 2 }; // slot2=申
    const s2 = { ...s, calendar: cal };
    const p = buildAutumnHuntPrompt(s2, "h1");
    expect(p).not.toBeNull();
    expect(p!.choices.map((c) => c.action.type).sort()).toEqual(["huntDecline", "huntJoin"]);
    const asked = { ...s2, flags: { ...s2.flags, [`autumnHunt:${cal.year}`]: true } };
    expect(buildAutumnHuntPrompt(asked, "h1")).toBeNull();
    const wrongMonth = { ...s2, calendar: { ...cal, month: 8 } };
    expect(buildAutumnHuntPrompt(wrongMonth, "h1")).toBeNull();
  });
});
