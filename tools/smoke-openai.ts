/**
 * Manual smoke test — NOT in CI. Run with:
 *   OPENAI_API_KEY=sk-... npm run smoke:openai -- --model gpt-4o-mini
 *
 * Sends one real request through openaiProvider → OpenAI SDK. No relay needed.
 */
import { createOpenAISdkTransport } from "../server/llm/openaiSdkTransport";
import { createDialogueProvider } from "../src/engine/dialogue/providers/remoteProvider";
import { makeDialogueRequest } from "../tests/helpers/dialogueRequest";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

async function main() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required for smoke:openai");
    process.exit(1);
  }
  const model = flag("--model", "gpt-4o-mini");
  const provider = createDialogueProvider({
    model: { provider: "openai", model },
    transport: createOpenAISdkTransport(apiKey),
  });

  console.log(`[smoke] openai model=${model} sending request…`);
  const result = await provider.generate(makeDialogueRequest(), { timeoutMs: 30000 });
  if (result.ok) {
    console.log("[smoke] OK:", JSON.stringify(result.value, null, 2));
  } else {
    console.error("[smoke] FAIL:", JSON.stringify(result.error, null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
