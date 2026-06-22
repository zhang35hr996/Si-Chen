/**
 * Minimal valid DialogueRequest for provider unit tests and manual smoke tools.
 * Mirrors the literal originally inlined in tools/smoke-anthropic.ts so provider
 * tests can build a request without standing up the full assembly pipeline.
 */
import type { DialogueRequest } from "../../src/engine/dialogue/types";
import type { DialoguePromptContext } from "../../src/engine/dialogue/promptPayload";

export function makeDialogueRequest(): DialogueRequest {
  return {
    speakerId: "smoke_test",
    targetId: "player",
    locationId: "hall_of_supreme_harmony",
    time: { year: 1, month: 1, period: "early", dayIndex: 0 },
    speakerContext: {
      profile: {
        name: "烟波",
        age: 20,
        role: "烟波楼头牌",
        appearance: "风姿绰约",
        personalityTraits: ["聪慧", "不羁"],
        coreFacts: ["初入宫廷"],
        goals: ["保全自身"],
        speechStyle: "俏皮活泼",
        speechPattern: "轻描淡写却藏机锋",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, // profile fields beyond schema minimum for test/smoke
      voice: {
        register: "casual",
        quirks: [],
        tabooTopics: [],
      },
      standing: {
        rank: "貴人",
        favor: 50,
        selfRefs: {
          toPlayer: ["臣妾"],
          formal: ["妾"],
        },
      },
      relevantMemories: [],
      stances: [],
    },
    etiquette: {
      allowedTerms: ["陛下"],
      forbiddenTerms: [],
      addressRules: [],
    },
    transcript: [],
    promptContext: {
      speakerDisplayName: "烟波",
      rankDisplay: {
        kind: "ranked",
        id: "貴人",
        name: "貴人",
        grade: "正六品",
        selfRefs: { toPlayer: ["臣妾"], formal: ["妾"] },
      },
      audience: {
        targetId: "player",
        targetRole: "sovereign",
        presentCharacterIds: ["player"],
        privacy: "semi_private",
      },
      relevantMemories: [],
      reactionPlan: undefined,
      knownEvents: [],
      allowedClaims: [],
      forbiddenClaims: [],
      choiceCandidates: [],
    } satisfies DialoguePromptContext,
  };
}
