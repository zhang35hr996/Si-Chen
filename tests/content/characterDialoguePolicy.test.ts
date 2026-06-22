import { describe, expect, it } from "vitest";
import { characterSchema } from "../../src/engine/content/schemas";

/**
 * Minimal valid character for testing (includes only required fields).
 * Extend with dialoguePolicy as needed in each test.
 */
function makeValidCharacter(overrides: Record<string, any> = {}) {
  return {
    id: "char_test",
    kind: "consort",
    profile: {
      name: "测试侍君",
      age: 20,
      role: "侍君",
      appearance: "外貌。",
      personalityTraits: ["端肃"],
      coreFacts: ["入宫两年"],
      goals: ["承宠"],
      speechStyle: "克制。",
    },
    defaultLocation: "loc_a",
    portraitSet: "char_a",
    expressions: ["neutral"],
    voice: { register: "formal", quirks: [], tabooTopics: [] },
    initialMemories: [],
    secrets: [],
    ...overrides,
  };
}

describe("characterSchema dialoguePolicy", () => {
  it("character with valid dialoguePolicy.forbiddenClaims parses successfully", () => {
    const charWithPolicy = makeValidCharacter({
      dialoguePolicy: {
        forbiddenClaims: [
          {
            id: "forbid_test_rank",
            predicate: "holds_rank",
            subjectId: "wenya",
            object: "fenghou",
            modality: "assert",
          },
        ],
      },
    });

    const result = characterSchema.safeParse(charWithPolicy);
    expect(result.success).toBe(true);
    if (result.success) {
      const policy = result.data.dialoguePolicy;
      expect(policy).toBeDefined();
      expect(policy?.forbiddenClaims).toHaveLength(1);
    }
  });

  it("character without dialoguePolicy parses successfully", () => {
    const charWithoutPolicy = makeValidCharacter();

    const result = characterSchema.safeParse(charWithoutPolicy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dialoguePolicy).toBeUndefined();
    }
  });

  it("character with unknown key inside dialoguePolicy fails (strict)", () => {
    const charWithExtraKey = makeValidCharacter({
      dialoguePolicy: {
        forbiddenClaims: [],
        extraKey: "bad",
      },
    });

    const result = characterSchema.safeParse(charWithExtraKey);
    expect(result.success).toBe(false);
  });

  it("character with invalid forbiddenClaim predicate fails", () => {
    const charWithInvalidPredicate = makeValidCharacter({
      dialoguePolicy: {
        forbiddenClaims: [
          {
            id: "forbid_invalid",
            predicate: "invalid_pred",
            subjectId: "wenya",
            modality: "assert",
          },
        ],
      },
    });

    const result = characterSchema.safeParse(charWithInvalidPredicate);
    expect(result.success).toBe(false);
  });

  it("forbiddenClaims array respects max length of 16", () => {
    // Create 17 claims to exceed the max
    const claims = Array.from({ length: 17 }, (_, i) => ({
      id: `forbid_${i}`,
      predicate: "holds_rank" as const,
      subjectId: "wenya",
      object: "rank",
      modality: "assert" as const,
    }));

    const charWithTooManyClaims = makeValidCharacter({
      dialoguePolicy: {
        forbiddenClaims: claims,
      },
    });

    const result = characterSchema.safeParse(charWithTooManyClaims);
    expect(result.success).toBe(false);
  });
});
