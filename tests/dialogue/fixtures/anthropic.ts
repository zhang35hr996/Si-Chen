import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { assembleDialogueRequest } from "../../../src/engine/dialogue/orchestrator";
import { ok, err } from "../../../src/engine/infra/result";
import type { DialogueToolOutput } from "../../../src/engine/dialogue/providerContract";
import type { AnthropicTransport, AnthropicTransportResult, AnthropicTransportFailure } from "../../../src/engine/dialogue/providers/anthropicProvider";

const db = loadRealContent();
const state = createNewGameState(db);

export function makeRequest(speakerId: string) {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian", {});
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

export function envelope(input: DialogueToolOutput, requestId = "req_test"): AnthropicTransportResult {
  return { requestId, message: { id: "msg_abc", stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_dialogue_line", input }], usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000 } } };
}
export function msg(over: Partial<AnthropicTransportResult["message"]>): AnthropicTransportResult {
  return { requestId: "req_f", message: { id: "msg_f", stop_reason: "tool_use", content: [], ...over } };
}
/** Transports returning a structured Result. */
export const okTransport = (input: DialogueToolOutput, requestId?: string): AnthropicTransport => ({ send: () => Promise.resolve(ok(envelope(input, requestId))) });
export const msgTransport = (m: AnthropicTransportResult): AnthropicTransport => ({ send: () => Promise.resolve(ok(m)) });
export const failTransport = (f: AnthropicTransportFailure): AnthropicTransport => ({ send: () => Promise.resolve(err(f)) });
export const hangingTransport = (): AnthropicTransport => ({ send: () => new Promise(() => {}) }); // never resolves, ignores signal
