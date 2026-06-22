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
