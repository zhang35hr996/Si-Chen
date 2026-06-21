import { describe, expect, it } from "vitest";
import { effectMemoryDraftSchema, initialMemoryDraftSchema } from "../../src/engine/content/schemas";

const ok = {
  kind: "trauma", summary: "怀中夭折。", subjectIds: ["heir_000007"], perspective: "parent",
  strength: 100, retention: "permanent", triggerTags: ["anniversary"], unresolved: true,
  emotions: { grief: 95, guilt: 90 },
};

describe("memory draft schema 边界", () => {
  it("effect 接受 permanent 创伤", () => {
    expect(effectMemoryDraftSchema.safeParse(ok).success).toBe(true);
  });
  it("initial：retention 缺省 slow，emotions/unresolved 有默认", () => {
    const parsed = initialMemoryDraftSchema.parse({
      kind: "impression", summary: "旧事一桩。", subjectIds: ["player"], perspective: "witness", strength: 30, triggerTags: [],
    });
    expect(parsed.retention).toBe("slow");
    expect(parsed.unresolved).toBe(false);
    expect(parsed.emotions).toEqual({});
  });
  it("拒绝旧 kind / 缺 subjectIds", () => {
    expect(effectMemoryDraftSchema.safeParse({ ...ok, kind: "event" }).success).toBe(false);
    const { subjectIds, ...noSubj } = ok;
    expect(effectMemoryDraftSchema.safeParse(noSubj).success).toBe(false);
  });
});
