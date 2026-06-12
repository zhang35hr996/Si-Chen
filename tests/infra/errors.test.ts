import { describe, expect, it } from "vitest";
import {
  aiError,
  assetError,
  contentError,
  formatErrorTag,
  gameError,
  saveError,
  stateError,
} from "../../src/engine/infra/errors";

describe("GameError", () => {
  it("builds the documented shape with severity defaulting to error", () => {
    const e = gameError("content", "SCHEMA", "bad character file");
    expect(e).toEqual({
      category: "content",
      code: "SCHEMA",
      severity: "error",
      message: "bad character file",
    });
  });

  it("carries severity, context, and cause when provided", () => {
    const cause = new Error("zod");
    const e = contentError("MISSING_REF", "scene not found", {
      severity: "fatal",
      context: { sceneId: "sc_missing", referencedBy: "ev_intro" },
      cause,
    });
    expect(e.severity).toBe("fatal");
    expect(e.context).toEqual({ sceneId: "sc_missing", referencedBy: "ev_intro" });
    expect(e.cause).toBe(cause);
  });

  it("omits context/cause keys entirely when absent", () => {
    const e = stateError("CALENDAR_INVARIANT", "ap below zero");
    expect("context" in e).toBe(false);
    expect("cause" in e).toBe(false);
  });

  it("category helpers stamp their category", () => {
    expect(contentError("X", "m").category).toBe("content");
    expect(assetError("X", "m").category).toBe("asset");
    expect(aiError("X", "m").category).toBe("ai");
    expect(saveError("X", "m").category).toBe("save");
    expect(stateError("X", "m").category).toBe("state");
  });

  it("formatErrorTag renders the stable grep-able tag", () => {
    expect(formatErrorTag(contentError("MISSING_REF", "m"))).toBe("ContentError:MISSING_REF");
    expect(formatErrorTag(saveError("CORRUPT", "m"))).toBe("SaveError:CORRUPT");
    expect(formatErrorTag(stateError("SCENE_LOOP", "m"))).toBe("StateError:SCENE_LOOP");
  });
});
