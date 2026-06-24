/**
 * Unit tests for DialogueRuntimeDeps and toDialogueTurnOptions.
 *
 * Invariants:
 *  1. provider-only → empty options (no logger, no retriever, no failureMode)
 *  2. logger propagates
 *  3. knowledgeRetriever propagates as options.retriever
 *  4. knowledgeFailureMode propagates
 *  5. no unexpected fields appear in the result
 *  6. undefined optional fields do NOT produce undefined keys in the result object
 */
import { describe, it, expect } from "vitest";
import { toDialogueTurnOptions, type DialogueRuntimeDeps } from "../../src/engine/dialogue/runtimeDeps";
import type { DialogueProvider, DialogueTurnOptions } from "../../src/engine/dialogue/types";
import type { KnowledgeRetriever } from "../../src/engine/dialogue/knowledge/types";
import { RingBufferLogger } from "../../src/engine/infra/logger";

const PROVIDER: DialogueProvider = {
  id: "test",
  kind: "scripted",
  capabilities: { strictTools: false, promptCaching: false, batch: false },
  generate: async () => { throw new Error("not used"); },
};

const RETRIEVER: KnowledgeRetriever = {
  retrieve: async () => { throw new Error("not used"); },
};

describe("toDialogueTurnOptions", () => {
  it("provider-only: result has no logger, retriever, or knowledgeFailureMode keys", () => {
    const deps: DialogueRuntimeDeps = { provider: PROVIDER };
    const opts = toDialogueTurnOptions(deps);
    expect(opts).not.toHaveProperty("logger");
    expect(opts).not.toHaveProperty("retriever");
    expect(opts).not.toHaveProperty("knowledgeFailureMode");
    expect(Object.keys(opts)).toHaveLength(0);
  });

  it("logger is passed through", () => {
    const logger = new RingBufferLogger();
    const deps: DialogueRuntimeDeps = { provider: PROVIDER, logger };
    const opts = toDialogueTurnOptions(deps);
    expect(opts.logger).toBe(logger);
  });

  it("knowledgeRetriever becomes options.retriever", () => {
    const deps: DialogueRuntimeDeps = { provider: PROVIDER, knowledgeRetriever: RETRIEVER };
    const opts = toDialogueTurnOptions(deps);
    expect(opts.retriever).toBe(RETRIEVER);
    expect(opts).not.toHaveProperty("knowledgeRetriever");
  });

  it("knowledgeFailureMode is passed through", () => {
    const deps: DialogueRuntimeDeps = { provider: PROVIDER, knowledgeFailureMode: "fail_turn" };
    const opts = toDialogueTurnOptions(deps);
    expect(opts.knowledgeFailureMode).toBe("fail_turn");
  });

  it("continue_without_knowledge failure mode is passed through", () => {
    const deps: DialogueRuntimeDeps = { provider: PROVIDER, knowledgeFailureMode: "continue_without_knowledge" };
    const opts = toDialogueTurnOptions(deps);
    expect(opts.knowledgeFailureMode).toBe("continue_without_knowledge");
  });

  it("all fields together produce all four option keys", () => {
    const logger = new RingBufferLogger();
    const deps: DialogueRuntimeDeps = {
      provider: PROVIDER,
      logger,
      knowledgeRetriever: RETRIEVER,
      knowledgeFailureMode: "fail_turn",
    };
    const opts: DialogueTurnOptions = toDialogueTurnOptions(deps);
    expect(opts.logger).toBe(logger);
    expect(opts.retriever).toBe(RETRIEVER);
    expect(opts.knowledgeFailureMode).toBe("fail_turn");
    expect(Object.keys(opts).sort()).toEqual(["knowledgeFailureMode", "logger", "retriever"]);
  });

  it("undefined optional fields do not add keys to the result", () => {
    const deps: DialogueRuntimeDeps = {
      provider: PROVIDER,
      logger: undefined,
      knowledgeRetriever: undefined,
      knowledgeFailureMode: undefined,
    };
    const opts = toDialogueTurnOptions(deps);
    expect(Object.keys(opts)).toHaveLength(0);
  });
});
