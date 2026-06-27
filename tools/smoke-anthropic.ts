/**
 * Manual smoke test — NOT in CI. Run with:
 *   ANTHROPIC_API_KEY=sk-... npm run smoke:anthropic
 *
 * Sends one real request through the full pipeline:
 *   HttpAnthropicTransport → relay → Anthropic SDK → Claude
 *
 * Requires: relay running locally (npm run dev:relay)
 */
import { createHttpAnthropicTransport } from "../src/engine/dialogue/providers/httpAnthropicTransport";
import { createDialogueProvider } from "../src/engine/dialogue/providers/remoteProvider";
import type { DialogueRequest } from "../src/engine/dialogue/types";
import type { DialoguePromptContext } from "../src/engine/dialogue/promptPayload";

async function main() {
  const transport = createHttpAnthropicTransport("http://localhost:3001/api/llm/anthropic");
  const provider = createDialogueProvider({
    model: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    transport,
  });

  const request: DialogueRequest = {
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
      } as any, // profile fields beyond schema minimum for smoke
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
    register: "private",
    transcript: [],
    topicTags: [],
    promptContext: {
      speakerDisplayName: "烟波",
      rankDisplay: { kind: "ranked", id: "貴人", name: "貴人", grade: "正六品", selfRefs: { toPlayer: ["臣妾"], formal: ["妾"] } },
      audience: { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" },
      relevantMemories: [],
      reactionPlan: undefined,
      knownEvents: [],
      allowedClaims: [],
      forbiddenClaims: [],
      choiceCandidates: [],
    } satisfies DialoguePromptContext,
  };

  console.log("[smoke] sending request…");
  const result = await provider.generate(request, { timeoutMs: 15000 });
  if (result.ok) {
    console.log("[smoke] OK:", JSON.stringify(result.value, null, 2));
  } else {
    console.error("[smoke] FAIL:", JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
