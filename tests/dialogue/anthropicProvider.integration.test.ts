// tests/dialogue/anthropicProvider.integration.test.ts
import { describe, it, expect } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { assembleDialogueRequest, buildDialoguePolicyContext, produceDialogueLineWithPolicy } from "../../src/engine/dialogue/orchestrator";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport } from "./fixtures/anthropic";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const correctRank = state.standing[SPEAKER]!.rank;                                   // real value from state
const wrongRank = Object.keys(db.ranks).find((r) => r !== correctRank)!;             // any other valid rank

function ctx(text: string, claims: ProposedClaim[]) {
  const req = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!req.ok) throw new Error(req.error.message);
  const policy = buildDialoguePolicyContext(db, state, req.value);
  const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: okTransport({ text, proposedClaims: claims }) });
  return { req: req.value, policy, provider };
}
const rankClaim = (id: string, object: string, sourceIds: string[]): ProposedClaim =>
  ({ claim: { id, predicate: "holds_rank", subjectId: SPEAKER, object, modality: "assert" }, sourceContextIds: sourceIds, modality: "assert", certainty: 90 });
function firstOffered(ids: ReadonlySet<string>): string {
  const offered = [...ids][0];
  expect(offered).toBeDefined();
  if (!offered) throw new Error("fixture must offer memory context (speaker initial memories changed?)");
  return offered;
}

describe("anthropic provider — full PR5 pipeline acceptance", () => {
  it("(a) valid claim with a real offered source → passes, mentionLog grows", async () => {
    const { req, policy, provider } = ctx("本宫累了，陛下早些歇息。", []);
    const offered = firstOffered(policy.offeredContextIds);
    const { req: r2, policy: p2, provider: pr2 } = ctx("本宫累了。", [rankClaim("c1", correctRank, [offered])]);
    void req; void policy; void provider;
    const r = await produceDialogueLineWithPolicy(db, pr2, r2, p2, state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nextState.mentionLog.length).toBeGreaterThan(state.mentionLog.length);
  });

  it("(b) claim contradicts belief → CLAIM_REJECTED, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const offered = firstOffered(ctx("本宫累了。", []).policy.offeredContextIds);
    const { req, policy, provider } = ctx("本宫累了。", [rankClaim("c2", wrongRank, [offered])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(c) unknown source context → reject, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const { req, policy, provider } = ctx("本宫累了。", [rankClaim("c3", correctRank, ["not_offered_xyz"])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(d) claim valid but text has a forbidden term → text reject, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const probe = ctx("本宫累了。", []);
    const offered = firstOffered(probe.policy.offeredContextIds);
    const { req, policy, provider } = ctx("皇上圣明。", [rankClaim("c4", correctRank, [offered])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("GATE_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });
});
