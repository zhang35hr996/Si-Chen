import { describe, expect, it } from "vitest";
import type { ChengFengPrompt } from "../../src/store/prompt";
import { isPromptAction } from "../../src/store/prompt";

describe("ChengFengPrompt", () => {
  it("isPromptAction 判别合法 action", () => {
    expect(isPromptAction({ type: "stash", itemId: "x" })).toBe(true);
    expect(isPromptAction({ type: "gift", itemId: "x" })).toBe(true);
    expect(isPromptAction({ type: "huntJoin", year: 1 })).toBe(true);
    expect(isPromptAction({ type: "nope" })).toBe(false);
  });
  it("prompt 结构成型", () => {
    const p: ChengFengPrompt = {
      speakerId: "cheng_feng",
      line: "蜀地进贡了鸳鸯墨。",
      choices: [
        { label: "赏赐", action: { type: "gift", itemId: "yuanyang_mo" } },
        { label: "知道了，收进库房", action: { type: "stash", itemId: "yuanyang_mo" } },
      ],
    };
    expect(p.choices).toHaveLength(2);
  });
});
