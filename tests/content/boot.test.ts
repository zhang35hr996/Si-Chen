/**
 * The boot test (skeleton-plan §11): the SHIPPED content files are themselves
 * fixtures. If this fails, a content PR broke the game.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/engine/content/loader";
import { readContentDir } from "../../tools/validate-content";

describe("real content/ boots", () => {
  const { raw, parseErrors } = readContentDir(join(process.cwd(), "content"));
  const result = loadContent(raw);

  it("parses as strict JSON and passes the full loader with zero errors", () => {
    expect(parseErrors).toEqual([]);
    if (!result.ok) {
      throw new Error(result.error.map((e) => e.message).join("\n"));
    }
  });

  it("contains the planned slice: 3 characters, 3 locations, 3 events, 3 scenes, 3 ranks", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(Object.keys(db.characters).sort()).toEqual(["feng_hou", "shen_chenghui", "sili_nvguan"]);
    expect(Object.keys(db.locations).sort()).toEqual(["hougong_zhudian", "yushufang", "yuhuayuan"].sort());
    expect(Object.keys(db.events).sort()).toEqual(["ev_fenghou_rules", "ev_menses_rite", "ev_shen_neglect"]);
    expect(Object.keys(db.scenes)).toHaveLength(3);
    expect(Object.keys(db.ranks)).toHaveLength(3);
  });

  it("wires the slice correctly: domains, start location, heavy rite event", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(db.world.startingLocation).toBe("yushufang");
    expect(db.ranks[db.characters["feng_hou"]!.initialStanding.rank]?.domain).toBe("harem");
    expect(db.ranks[db.characters["sili_nvguan"]!.initialStanding.rank]?.domain).toBe("official");
    expect(db.events["ev_menses_rite"]?.apCost).toBe(2); // heavy action per plan §6
    expect(db.characters["shen_chenghui"]?.defaultLocation).toBe("yuhuayuan");
  });
});
