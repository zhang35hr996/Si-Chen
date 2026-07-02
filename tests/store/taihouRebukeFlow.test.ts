/**
 * 太后训诫·空间门控 + 乘风询问纯逻辑。
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import {
  buildTaihouRebukePrompt,
  maybeBuildRebukeForAction,
  rebukeAttendBeats,
} from "../../src/store/taihouRebukeFlow";
import { isPromptAction } from "../../src/store/prompt";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

/** Find a seed that makes buildTaihouRebuke hit (interior gate passes). */
function hittingSeed(): string {
  const s = createNewGameState(db);
  for (let i = 0; i < 500; i++) {
    if (maybeBuildRebukeForAction(db, s, `hit:${i}`, "palace")) return `hit:${i}`;
  }
  throw new Error("no hitting seed found");
}

describe("maybeBuildRebukeForAction — 空间门控", () => {
  it("宫外（jingjiao/慈恩寺）：即便命中种子也返回 null（不掷骰）", () => {
    const s = createNewGameState(db);
    const seed = hittingSeed();
    expect(maybeBuildRebukeForAction(db, s, seed, "palace")).not.toBeNull(); // 宫内确实会中
    expect(maybeBuildRebukeForAction(db, s, seed, "jingjiao")).toBeNull(); // 郊外（慈恩寺）→ 不触发
  });

  it("宫外（jingcheng/京城）：返回 null", () => {
    const s = createNewGameState(db);
    const seed = hittingSeed();
    expect(maybeBuildRebukeForAction(db, s, seed, "jingcheng")).toBeNull();
  });

  it("宫内（palace/hougong）：命中返回带 targetDisplayName 的计划", () => {
    const s = createNewGameState(db);
    const seed = hittingSeed();
    const planP = maybeBuildRebukeForAction(db, s, seed, "palace")!;
    expect(planP.targetDisplayName).toBeTruthy();
    expect(planP.effects.some((e) => e.type === "favor" && e.delta === -5)).toBe(true);
    expect(maybeBuildRebukeForAction(db, s, seed, "hougong")).not.toBeNull();
  });

  it("undefined zone（无法判定）：保守不触发", () => {
    const s = createNewGameState(db);
    expect(maybeBuildRebukeForAction(db, s, hittingSeed(), undefined)).toBeNull();
  });
});

describe("buildTaihouRebukePrompt — 乘风询问", () => {
  it("文案含目标当前称谓，两个选项为 attend/decline（合法 PromptAction）", () => {
    const s = createNewGameState(db);
    const plan = maybeBuildRebukeForAction(db, s, hittingSeed(), "palace")!;
    const prompt = buildTaihouRebukePrompt(plan);
    expect(prompt.speakerId).toBe("cheng_feng");
    expect(prompt.line).toContain(plan.targetDisplayName);
    expect(prompt.line).toContain("慈宁宫");
    expect(prompt.choices.map((c) => c.label)).toEqual(["去看看", "不必了"]);
    expect(prompt.choices[0]!.action).toEqual({ type: "taihouRebukeAttend" });
    expect(prompt.choices[1]!.action).toEqual({ type: "taihouRebukeDecline" });
    expect(isPromptAction(prompt.choices[0]!.action)).toBe(true);
    expect(isPromptAction(prompt.choices[1]!.action)).toBe(true);
  });

  it("不写死称谓——不同目标显示各自称谓", () => {
    const s = createNewGameState(db);
    const plan = maybeBuildRebukeForAction(db, s, hittingSeed(), "palace")!;
    expect(buildTaihouRebukePrompt(plan).line).not.toContain("某贵人");
  });
});

describe("rebukeAttendBeats — 去看看过场", () => {
  it("每条节拍套用慈宁宫背景，台词不变", () => {
    const s = createNewGameState(db);
    const plan = maybeBuildRebukeForAction(db, s, hittingSeed(), "palace")!;
    const ciningBg = db.locations["cining_gong"]!.backgroundKey;
    const beats = rebukeAttendBeats(plan, ciningBg);
    expect(beats.length).toBe(plan.beats.length);
    expect(beats.every((b) => b.backgroundKey === ciningBg)).toBe(true);
    expect(beats.map((b) => b.lines)).toEqual(plan.beats.map((b) => b.lines));
  });
});

describe("isPromptAction — 新增训诫动作", () => {
  it("接受 taihouRebukeAttend/Decline", () => {
    expect(isPromptAction({ type: "taihouRebukeAttend" })).toBe(true);
    expect(isPromptAction({ type: "taihouRebukeDecline" })).toBe(true);
  });
  it("拒绝未知动作", () => {
    expect(isPromptAction({ type: "nope" })).toBe(false);
  });
});
