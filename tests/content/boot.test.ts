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

  it("contains the planned slice + cold-palace pack: 6 characters, 9 locations, 7 events, 7 scenes, 21 ranks", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(Object.keys(db.characters).sort()).toEqual(
      ["chu_jun", "feng_hou", "shen_chenghui", "sili_nvguan", "taihou", "wenya_shijun"].sort(),
    );
    expect(Object.keys(db.locations).sort()).toEqual(
      ["chaotang", "cining_gong", "fengxiandian", "kunninggong", "lenggong", "shangshufang", "xianfugong", "yushufang", "yuhuayuan"].sort(),
    );
    expect(Object.keys(db.events).sort()).toEqual(
      [
        "arc_lenggong__ev_aftermath",
        "arc_lenggong__ev_visit",
        "ev_chaohui",
        "ev_fenghou_rules",
        "ev_menses_rite",
        "ev_shen_neglect",
        "ev_taihou_converse",
      ].sort(),
    );
    expect(Object.keys(db.scenes)).toHaveLength(7);
    expect(Object.keys(db.ranks)).toHaveLength(21);
  });

  it("wires the slice correctly: domains, start location, heavy rite event", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(db.world.startingLocation).toBe("yushufang");
    expect(db.ranks[db.characters["feng_hou"]!.initialStanding!.rank]?.domain).toBe("harem");
    expect(db.ranks[db.characters["sili_nvguan"]!.initialStanding!.rank]?.domain).toBe("official");
    expect(db.events["ev_menses_rite"]?.apCost).toBe(1); // 召对是轻行动；真正的大祭（3+ AP 重行动）是未来单独的事件
    expect(db.characters["shen_chenghui"]?.defaultLocation).toBe("yuhuayuan");
  });
});
