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
    // models that the op machine is the only concurrency gate (no separate boolean to get stuck)
    const first = startDialogueOp(initialDialogueOpState);
    let s = finishDialogueOp(first.state, first.token!);
    const cont = startDialogueOp(s);
    s = invalidateDialogueOps(cont.state); // stale; activeOp cleared by invalidation
    const next = startDialogueOp(s);
    expect(next.token).not.toBeNull(); // a new conversation is not blocked by the orphaned old one
  });
});

/**
 * 续接 UI pending 的 token 所有权（onConverseChoice 协议）。choicePendingToken 与 choiceOpTokenRef 都绑到
 * 续接 op 的 token；生命周期失效（invalidateDialogue）立即清两者；旧续接 finally 仅在仍持有同一 token 时清，
 * 绝不清新会话。下方小型模拟精确复刻 App 的并发门 + owner-scoped 收尾，覆盖评审要求的交错场景。
 */
describe("choice-pending token ownership (onConverseChoice UI state)", () => {
  // 模拟 App 三态：dialogueOp 状态机 + choiceOpTokenRef（同步 owner 判定）+ choicePendingToken（渲染用）。
  function makeApp() {
    let op: DialogueOpState = initialDialogueOpState;
    let choiceOpToken: number | null = null; // choiceOpTokenRef.current
    let choicePendingToken: number | null = null; // setChoicePendingToken
    return {
      get pending() { return choicePendingToken; },
      get activeOp() { return op.activeOp; },
      /** 启动续接：并发门=startDialogueOp（activeOp!=null → 返回 null 表示被拒）。 */
      startChoice(): number | null {
        const s = startDialogueOp(op);
        if (s.token === null) return null; // rejected — no second provider call
        op = s.state;
        choiceOpToken = s.token;
        choicePendingToken = s.token;
        return s.token;
      },
      /** 生命周期失效：立即清 UI pending（不等旧 promise settle）。 */
      invalidate() {
        op = invalidateDialogueOps(op);
        choiceOpToken = null;
        choicePendingToken = null;
      },
      /** 续接 finally：owner-scoped——仅在仍持有同一 token 时清。 */
      finishChoice(token: number) {
        op = finishDialogueOp(op, token);
        if (choiceOpToken === token) { choiceOpToken = null; choicePendingToken = null; }
      },
    };
  }

  it("lifecycle invalidate immediately releases the old choice's UI pending (no wait for the promise)", () => {
    const app = makeApp();
    const a = app.startChoice()!;
    expect(app.pending).toBe(a);
    app.invalidate(); // before A's promise settles
    expect(app.pending).toBeNull(); // released immediately
    expect(a).not.toBeNull();
  });

  it("interleave: A pending → invalidate → B starts → stale A finally → B stays pending → B finishes → only B clears", () => {
    const app = makeApp();
    const a = app.startChoice()!; // choice A pending
    app.invalidate(); // lifecycle switch
    const b = app.startChoice()!; // choice B starts
    expect(b).not.toBe(a);
    expect(app.pending).toBe(b); // B owns the UI pending

    app.finishChoice(a); // stale A's finally runs
    expect(app.activeOp).toBe(b); // B remains active
    expect(app.pending).toBe(b); // B remains pending — A could not clear it

    app.finishChoice(b); // B finishes
    expect(app.activeOp).toBeNull();
    expect(app.pending).toBeNull(); // only B cleared its own state
  });

  it("a second choice while one is pending is rejected by the op gate (no separate boolean)", () => {
    const app = makeApp();
    app.startChoice();
    expect(app.startChoice()).toBeNull(); // double-tap rejected
  });
});
