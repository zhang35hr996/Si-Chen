// tests/dialogue/anthropicProvider.integration.test.ts
import { describe, it, expect } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";
import { assembleDialogueRequest, produceDialogueTurn } from "../../src/engine/dialogue/orchestrator";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport } from "./fixtures/anthropic";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
// shen_zhibai is now event_only; inject her so dialogue tests can read her rank from standing
const state = withConsort(createNewGameState(db), db, "shen_zhibai");
const SPEAKER = "shen_zhibai";
const correctRank = state.standing[SPEAKER]!.rank;                                   // real value from state
const wrongRank = Object.keys(db.ranks).find((r) => r !== correctRank)!;             // any other valid rank

function ctx(text: string, claims: ProposedClaim[]) {
  const req = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!req.ok) throw new Error(req.error.message);
  const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: okTransport({ text, proposedClaims: claims }) });
  return { req: req.value, provider };
}
const rankClaim = (id: string, object: string, sourceIds: string[]): ProposedClaim =>
  ({ claim: { id, predicate: "holds_rank", subjectId: SPEAKER, object, modality: "assert" }, sourceRefs: sourceIds.map((id) => ({ kind: "memory" as const, id })), modality: "assert", certainty: 90 });
function firstOfferedMemoryId(req: ReturnType<typeof ctx>["req"]): string {
  const mem = req.speakerContext.relevantMemories[0];
  expect(mem).toBeDefined();
  if (!mem) throw new Error("fixture must offer memory context (speaker initial memories changed?)");
  return mem.id;
}

describe("anthropic provider — full PR5 pipeline acceptance", () => {
  it("(a) no factual claims → passes in CLOSED mode, line produced", async () => {
    // Fresh state → allowedClaims=[] (CLOSED). Conversational text with no claims passes.
    const { req, provider } = ctx("臣侍告退，陛下早些歇息。", []);
    const r = await produceDialogueTurn(db, provider, req, state);
    expect(r.ok).toBe(true);
  });

  it("(b) claim contradicts belief → CLAIM_REJECTED, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const offered = firstOfferedMemoryId(ctx("臣侍知悉。", []).req);
    const { req, provider } = ctx("臣侍知悉。", [rankClaim("c2", wrongRank, [offered])]);
    const r = await produceDialogueTurn(db, provider, req, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(c) unknown source context → reject, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const { req, provider } = ctx("臣侍知悉。", [rankClaim("c3", correctRank, ["not_offered_xyz"])]);
    const r = await produceDialogueTurn(db, provider, req, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(d) forbidden text without claims → GATE_REJECTED, state.mentionLog unchanged", async () => {
    // Fresh state → CLOSED mode. Text gate fires on the forbidden term "皇上".
    const before = structuredClone(state.mentionLog);
    const { req, provider } = ctx("娘娘圣明。", []);
    const r = await produceDialogueTurn(db, provider, req, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("GATE_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });
});
