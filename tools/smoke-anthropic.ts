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

async function main() {
  const transport = createHttpAnthropicTransport("http://localhost:3001/api/llm/anthropic");
  const provider = createDialogueProvider({
    model: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    transport,
  });

  const request = {
    speakerId: "smoke_test",
    speakerContext: {
      profile: "测试角色，用于 smoke 验证。",
      voice: "平静",
      relevantMemories: [],
    },
    policy: { offeredContextIds: [], gates: [] },
  } as unknown as Parameters<typeof provider.generate>[0];

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
