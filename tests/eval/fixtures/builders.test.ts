/**
 * Golden scenario smoke tests (T5, LLM-2).
 *
 * Runs 5 representative golden scenarios through the full eval pipeline to
 * verify that fixture builders wire up correctly end-to-end.
 *
 * Scenarios exercised:
 *   sc001 — base_palace: gate passes, expectations pass
 *   sc013 — gate_reject_test: gate fails, raw text preserved
 *   sc006 — consort_with_grievance: cites injected memory (requiredSourceContextIds)
 *   sc011 — wrong_speaker_test: WRONG_SPEAKER → gateStatus=fail
 *   sc008 — demoted_consort: wenya compliant line passes gate
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEvalScenario } from "../../../src/engine/dialogue/eval/evalRunner";
import { evalFixtures, GRIEVANCE_MEMORY_ID } from "./builders";
import type { EvalScenario } from "../../../src/engine/dialogue/eval/types";

// ── Load scenarios from JSONL ─────────────────────────────────────────────────

function loadScenarios(): EvalScenario[] {
  const raw = readFileSync(
    join(import.meta.dirname, "../golden/scenarios.jsonl"),
    "utf-8",
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvalScenario);
}

const allScenarios = loadScenarios();

function getScenario(id: string): EvalScenario {
  const s = allScenarios.find((sc) => sc.id === id);
  if (!s) throw new Error(`scenario ${id} not found`);
  return s;
}

function getFixture(id: string) {
  const f = evalFixtures[id];
  if (!f) throw new Error(`fixture ${id} not found`);
  return f;
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

describe("golden scenarios smoke", () => {
  it("sc001: base_palace passes gate and expectations", async () => {
    const scenario = getScenario("sc001");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 0);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.expectationStatus).toBe("pass");
    expect(result.text).toBeDefined();
    expect(result.servedText).toBeDefined();
  });

  it("sc013: gate_reject_test fails gate, raw text preserved", async () => {
    const scenario = getScenario("sc013");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 1);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    // Raw text is preserved even when gate fails
    expect(result.text).toBe("皇上圣明，臣侍领旨。");
    expect(result.servedText).toBeUndefined();
    // textFindings should contain the forbidden_lexicon finding
    expect(result.textFindings.length).toBeGreaterThan(0);
    // gatePass=false expectation is satisfied → expectationStatus=pass
    expect(result.expectationStatus).toBe("pass");
  });

  it("sc006: consort_with_grievance cites injected grievance memory", async () => {
    const scenario = getScenario("sc006");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 2);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    // The fixture proposes a claim citing GRIEVANCE_MEMORY_ID
    // expectations.requiredSourceRefs = [{ kind: "memory", id: GRIEVANCE_MEMORY_ID }] → pass
    expect(result.expectationStatus).toBe("pass");
    expect(GRIEVANCE_MEMORY_ID).toBe("mem_eval_grievance_001");
  });

  it("sc011: wrong_speaker_test returns gateStatus=fail (WRONG_SPEAKER)", async () => {
    const scenario = getScenario("sc011");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 3);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    // gatePass=false expectation → expectationStatus=pass
    expect(result.expectationStatus).toBe("pass");
  });

  it("sc008: demoted_consort wenya compliant line passes gate", async () => {
    const scenario = getScenario("sc008");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 4);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.text).toBe("侍身领命，不敢有怨。");
    expect(result.expectationStatus).toBe("pass");
  });
});

// ── Scenario count validation ─────────────────────────────────────────────────

describe("scenarios.jsonl coverage", () => {
  it("has ≥20 scenarios", () => {
    expect(allScenarios.length).toBeGreaterThanOrEqual(20);
  });

  it("has ≥4 different speakerIds", () => {
    const speakers = new Set(allScenarios.map((s) => s.speakerId));
    expect(speakers.size).toBeGreaterThanOrEqual(4);
  });

  it("has ≥5 different fixtureIds", () => {
    const fixtures = new Set(allScenarios.map((s) => s.fixtureId));
    expect(fixtures.size).toBeGreaterThanOrEqual(5);
  });

  it("has ≥5 scenarios with sceneDirective", () => {
    const withDirective = allScenarios.filter((s) => s.sceneDirective !== undefined);
    expect(withDirective.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥5 scenarios with transcript", () => {
    const withTranscript = allScenarios.filter(
      (s) => s.transcript !== undefined && s.transcript.length > 0,
    );
    expect(withTranscript.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥5 scenarios with expectations.gatePass=true", () => {
    const withGatePassTrue = allScenarios.filter(
      (s) => s.expectations?.gatePass === true,
    );
    expect(withGatePassTrue.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥2 scenarios with expectations.gatePass=false", () => {
    const withGatePassFalse = allScenarios.filter(
      (s) => s.expectations?.gatePass === false,
    );
    expect(withGatePassFalse.length).toBeGreaterThanOrEqual(2);
  });

  it("has ≥4 scenarios with expectations.forbiddenTexts", () => {
    const withForbiddenTexts = allScenarios.filter(
      (s) => s.expectations?.forbiddenTexts !== undefined && s.expectations.forbiddenTexts.length > 0,
    );
    expect(withForbiddenTexts.length).toBeGreaterThanOrEqual(4);
  });

  it("has ≥2 scenarios with expectations.requiredSourceRefs citing GRIEVANCE_MEMORY_ID", () => {
    const withRequired = allScenarios.filter(
      (s) =>
        s.expectations?.requiredSourceRefs !== undefined &&
        s.expectations.requiredSourceRefs.some((r) => r.id === GRIEVANCE_MEMORY_ID),
    );
    expect(withRequired.length).toBeGreaterThanOrEqual(2);
  });
});
