/**
 * 生成式对话异步操作所有权（§ async-dialogue-ownership）的纯状态机。
 */
import { describe, expect, it } from "vitest";
import {
  type DialogueOpState,
  finishDialogueOp,
  initialDialogueOpState,
  invalidateDialogueOps,
  isCurrentDialogueOp,
  startDialogueOp,
} from "../../src/ui/dialogueOp";

describe("dialogue op ownership", () => {
  it("1. a second conversation while one is active is rejected (token null) before AP spend", () => {
    const a = startDialogueOp(initialDialogueOpState);
    expect(a.token).toBe(1);
    const b = startDialogueOp(a.state); // still active
    expect(b.token).toBeNull(); // rejected — caller must not spend AP
    expect(b.state).toBe(a.state); // unchanged
  });

  it("2. each successful operation receives a unique monotonic token", () => {
    const a = startDialogueOp(initialDialogueOpState);
    const afterA = finishDialogueOp(a.state, a.token!);
    const b = startDialogueOp(afterA);
    expect(a.token).toBe(1);
    expect(b.token).toBe(2);
  });

  it("3+4. lifecycle invalidation makes the in-flight completion stale (cannot react)", () => {
    const a = startDialogueOp(initialDialogueOpState);
    const invalidated = invalidateDialogueOps(a.state); // new game / load / death
    expect(isCurrentDialogueOp(invalidated, a.token!)).toBe(false); // stale → must not commit/react
  });

  it("5. a stale operation's finish cannot clear a newer operation's busy state", () => {
    const a = startDialogueOp(initialDialogueOpState); // token 1
    const invalidated = invalidateDialogueOps(a.state); // a is now stale, activeOp null
    const b = startDialogueOp(invalidated); // token 2, active
    const afterStaleFinish = finishDialogueOp(b.state, a.token!); // old op tries to finish
    expect(afterStaleFinish.activeOp).toBe(b.token); // newer op's busy untouched
  });

  it("6. the current operation clears its own busy state on finish", () => {
    const a = startDialogueOp(initialDialogueOpState);
    expect(finishDialogueOp(a.state, a.token!).activeOp).toBeNull();
  });

  it("9. a duplicate launch cannot occupy twice (single active op invariant)", () => {
    let s: DialogueOpState = initialDialogueOpState;
    const first = startDialogueOp(s);
    s = first.state;
    const dup = startDialogueOp(s);
    expect(first.token).not.toBeNull();
    expect(dup.token).toBeNull(); // duplicate click → no second provider call
  });
});

/**
 * 续接（onConverseChoice）所有权协议建模。首轮 converse 的 op 已收尾后，选择续接也是一次 provider request，
 * App 现以同一套原语认领新 token、await 后用 isCurrentDialogueOp 把关、owner-only finish 收尾。
 * 本组用状态机精确复刻该调用点的步骤，覆盖评审要求 1–5（仓库无 <App> 渲染基座，App 判断抽原语单测）。
 */
describe("continuation turn ownership (onConverseChoice protocol)", () => {
  it("1+3+4. a continuation invalidated mid-flight is stale → must not commit/react", () => {
    // first turn ran and released its op
    const first = startDialogueOp(initialDialogueOpState);
    let s = finishDialogueOp(first.state, first.token!);
    // continuation acquires its own token (op pending)
    const cont = startDialogueOp(s);
    s = cont.state;
    expect(cont.token).toBe(2);
    // lifecycle switch during the await (load / new game / death)
    s = invalidateDialogueOps(s);
    // old promise resolves → gate rejects: no commitDialogueState, no setReaction
    expect(isCurrentDialogueOp(s, cont.token!)).toBe(false);
  });

  it("4. a stale continuation's finish does not clear a newer session's busy state", () => {
    const first = startDialogueOp(initialDialogueOpState);
    let s = finishDialogueOp(first.state, first.token!);
    const cont = startDialogueOp(s); // token 2 (the stale continuation)
    s = invalidateDialogueOps(cont.state); // lifecycle switch
    const fresh = startDialogueOp(s); // a brand-new session takes over (token 4)
    s = fresh.state;
    // the stale continuation's finally runs finishDialogueOp with its old token
    const afterStaleFinish = finishDialogueOp(s, cont.token!);
    expect(afterStaleFinish.activeOp).toBe(fresh.token); // new session's busy untouched
  });

  it("5. after a stale continuation, a fresh session can still start (no permanent lock)", () => {
    // models that choiceInFlightRef is always cleared in finally, so the op machine is the only gate
    const first = startDialogueOp(initialDialogueOpState);
    let s = finishDialogueOp(first.state, first.token!);
    const cont = startDialogueOp(s);
    s = invalidateDialogueOps(cont.state); // stale; activeOp cleared by invalidation
    const next = startDialogueOp(s);
    expect(next.token).not.toBeNull(); // a new conversation is not blocked by the orphaned old one
  });
});
