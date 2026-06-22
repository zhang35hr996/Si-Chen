/**
 * Manual smoke test — NOT in CI. Run with:
 *   GEMINI_API_KEY=... npm run smoke:gemini -- --model gemini-2.5-flash
 *
 * Sends one real request through geminiProvider → @google/genai SDK. No relay needed.
 */
import { createGeminiSdkTransport } from "../server/llm/geminiSdkTransport";
import { createDialogueProvider } from "../src/engine/dialogue/providers/remoteProvider";
import { makeDialogueRequest } from "../tests/helpers/dialogueRequest";

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

async function main() {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable is required for smoke:gemini");
    process.exit(1);
  }
  const model = flag("--model", "gemini-2.5-flash");
  const provider = createDialogueProvider({
    model: { provider: "google", model },
    transport: createGeminiSdkTransport(apiKey),
  });

  console.log(`[smoke] gemini model=${model} sending request…`);
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
