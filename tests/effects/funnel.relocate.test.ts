import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { getCharacterLocation } from "../../src/engine/characters/presence";
import { chamberOf } from "../../src/engine/characters/chambers";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("funnel: relocate", () => {
  it("moves a consort to an empty chamber of another palace", () => {
    const s0 = createNewGameState(db);
    // lu_huaijin 初始住钟粹宫主殿。
    expect(getCharacterLocation(db, s0, "lu_huaijin")).toBe("zhongcui_gong");
    const r = applyEffects(db, s0, [
      { type: "relocate", char: "lu_huaijin", location: "chengqian_gong", chamber: "east_side" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getCharacterLocation(db, r.value, "lu_huaijin")).toBe("chengqian_gong");
    expect(chamberOf(r.value.standing.lu_huaijin)).toBe("east_side");
  });

  it("rejects relocating the 凤后 (empress)", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "relocate", char: "shen_zhibai", location: "chengqian_gong", chamber: "main" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a non-设宫室 target location", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "relocate", char: "lu_huaijin", location: "kunninggong", chamber: "main" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a chamber already occupied by another consort", () => {
    const s0 = createNewGameState(db);
    // xu_qinghuan 初始住咸福宫主殿；把 lu_huaijin 迁入同一格应被拒。
    expect(getCharacterLocation(db, s0, "xu_qinghuan")).toBe("xianfugong");
    const r = applyEffects(db, s0, [
      { type: "relocate", char: "lu_huaijin", location: "xianfugong", chamber: "main" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("allows moving within the same palace to a different chamber", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "relocate", char: "lu_huaijin", location: "zhongcui_gong", chamber: "west_annex" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(chamberOf(r.value.standing.lu_huaijin)).toBe("west_annex");
  });
});
