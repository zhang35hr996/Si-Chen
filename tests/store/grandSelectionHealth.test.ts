import { describe, expect, it } from "vitest";
import { addGeneratedConsort } from "../../src/store/grandSelection";
import { createNewGameState } from "../../src/engine/state/newGame";
import { legacyConsortContent } from "../helpers/consortFixture";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("addGeneratedConsort seeds health/age", () => {
  it("writes health, healthStatus, ageAtEntry, enteredAtYear", () => {
    const s = createNewGameState(db);
    // 良家子（无 maternalClan）：health/age 播种与母族无关。
    const content = { ...legacyConsortContent("lu_huaijin"), id: "xiunan_y1_1", maternalClan: undefined } as any;
    const r = addGeneratedConsort(s, db, content, Object.keys(db.ranks)[0]!, 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.standing["xiunan_y1_1"]!;
    expect(st.health).toBe(content.attributes?.health ?? 100);
    expect(st.healthStatus).toBe("healthy");
    expect(st.ageAtEntry).toBe(content.profile.age);
    expect(st.enteredAtYear).toBe(s.calendar.year);
  });
});
