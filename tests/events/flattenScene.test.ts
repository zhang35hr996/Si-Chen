import { describe, expect, it } from "vitest";
import type { SceneContent } from "../../src/engine/content/schemas";
import { flattenScene } from "../../src/engine/events/flattenScene";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("flattenScene (interim PR 7 helper)", () => {
  it("flattens all three slice scenes: intro lines + per-choice effects + closing", () => {
    const neglect = flattenScene(db.scenes["sc_shen_neglect"]!);
    expect(neglect.ok).toBe(true);
    if (!neglect.ok) return;
    expect(neglect.value.intro).toHaveLength(1);
    expect(neglect.value.intro[0]?.speakerId).toBe("shen_chenghui");
    expect(neglect.value.options.map((o) => o.id)).toEqual(["c_comfort", "c_brush", "c_cold"]);
    const comfort = neglect.value.options[0]!;
    expect(comfort.effects).toHaveLength(3); // affinity + trust + memory
    expect(comfort.closing).toHaveLength(1);

    expect(flattenScene(db.scenes["sc_fenghou_rules"]!).ok).toBe(true);
    const rite = flattenScene(db.scenes["sc_menses_rite"]!);
    expect(rite.ok).toBe(true);
    if (rite.ok) expect(rite.value.options).toHaveLength(2);
  });

  it("refuses shapes it does not support instead of guessing", () => {
    const withBranch: SceneContent = {
      id: "sc_t",
      locationId: "yushufang",
      participants: ["sili_nvguan"],
      startNodeId: "n1",
      nodes: [
        { type: "line", id: "n1", speaker: "sili_nvguan", text: "……", next: "n2" },
        { type: "choice", id: "n2", choices: [{ id: "c1", text: "选", next: "n3" }] },
        { type: "branch", id: "n3", condition: { flagSet: "x" }, ifTrue: "n4", ifFalse: "n4" },
        { type: "line", id: "n4", speaker: "sili_nvguan", text: "完" },
      ],
    };
    const result = flattenScene(withBranch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SCENE_UNSUPPORTED");
  });
});
