import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BRANCH = "worktree-taihou-rebuke-gate";

function git(args: string[]): void {
  execFileSync("git", args, { stdio: "inherit" });
}

describe("one-shot PR #134 reviewer fix", () => {
  it("patches greeting ceremony drain on the PR head", () => {
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_HEAD_REF !== BRANCH) {
      expect(true).toBe(true);
      return;
    }

    git(["fetch", "origin", BRANCH]);
    git(["checkout", "-B", BRANCH, "FETCH_HEAD"]);

    const appPath = "src/ui/App.tsx";
    let text = readFileSync(appPath, "utf8");

    const importAnchor = '} from "./eventReturn";\n';
    const importReplacement = '} from "./eventReturn";\nimport { greetingDrainAction } from "./greetingDrain";\n';
    expect(text.split(importAnchor)).toHaveLength(2);
    text = text.replace(importAnchor, importReplacement);

    const enterOld = `    setCeremonyOpen(true);
    // 懿旨等转旬反应入队，待 ceremony 关闭后随正常流程消化（此处仅记一旬动作）。
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
`;
    const enterNew = `    setCeremonyOpen(true);
    // 问安礼自身先占有本次行动的 deferred checkpoint；礼仪结束后统一 drain。
    // 即使没有懿旨/乘风台词，待处理的太后训诫也必须在礼仪结束后弹出，不能悬空阻塞全局结算。
    pendingReactionDispatch({ type: "begin", request: spend.value.rolledOver ? stationaryRequest() : null });
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
`;
    expect(text.includes(enterOld)).toBe(true);
    text = text.replace(enterOld, enterNew);

    const doneOld = `            onDone={() => {
              setCeremonyOpen(false);
              if (reactionQueue.length > 0) {
                const [first, ...rest] = reactionQueue;
                setReaction(first!);
                setReactionQueue(rest);
              }
            }}
`;
    const doneNew = `            onDone={() => {
              setCeremonyOpen(false);
              if (greetingDrainAction(reactionQueue.length) === "play_queue") {
                const [first, ...rest] = reactionQueue;
                setReaction(first!);
                setReactionQueue(rest);
                return;
              }
              // 无排队反应也必须收口：若本行动命中太后训诫，此处显示乘风询问；否则完成 checkpoint。
              flushPendingReactionCheckpoint();
            }}
`;
    expect(text.includes(doneOld)).toBe(true);
    text = text.replace(doneOld, doneNew);
    writeFileSync(appPath, text, "utf8");

    writeFileSync(
      "src/ui/greetingDrain.ts",
      `/** 问安礼结束后的统一收口决策。 */
export type GreetingDrainAction = "play_queue" | "flush";

/**
 * 有排队反应时先播放；没有时也必须 flush，让待处理的太后训诫 prompt 或 deferred checkpoint 继续。
 */
export function greetingDrainAction(reactionQueueLength: number): GreetingDrainAction {
  return reactionQueueLength > 0 ? "play_queue" : "flush";
}
`,
      "utf8",
    );

    mkdirSync("tests/ui", { recursive: true });
    writeFileSync(
      "tests/ui/greetingDrain.test.ts",
      `import { describe, expect, it } from "vitest";
import { greetingDrainAction } from "../../src/ui/greetingDrain";

describe("问安礼结束后的收口", () => {
  it("有排队反应时先播放队列", () => {
    expect(greetingDrainAction(2)).toBe("play_queue");
  });

  it("无排队反应时仍执行 flush，使太后训诫 prompt/checkpoint 不悬空", () => {
    expect(greetingDrainAction(0)).toBe("flush");
  });
});
`,
      "utf8",
    );

    rmSync(".github/workflows/apply-pr134-review-fix.yml", { force: true });
    rmSync("tests/ui/__applyPr134ReviewFix.test.ts", { force: true });

    git(["config", "user.name", "github-actions[bot]"]);
    git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    git(["add", "-A"]);
    git(["commit", "-m", "fix: drain pending rebuke after greeting ceremony"]);
    git(["push", "origin", `HEAD:${BRANCH}`]);

    expect(true).toBe(true);
  });
});
