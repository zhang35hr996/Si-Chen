/**
 * v38 → v39 经真实 readSlot 加载链路（migration ladder → checksum → schema）。
 * 证明 MIGRATIONS[38] 接得通，且坏档（fatherId=undefined）被 schema 拒绝、不静默成 null。
 */
import { describe, expect, it } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** 把当前版本状态降级成 v38 形态（删新字段、heir 还原 adoptiveFatherId/faction）。 */
function makeV38Save(mutateHeir?: (h: Record<string, unknown>) => void): string {
  // The heir's bio father lu_huaijin is a procedurally-generated story consort; inject her
  // so the migrated save references a valid consort and passes readSlot validation.
  const s = withConsort(createNewGameState(db), db, "lu_huaijin");
  (s.resources.bloodline.heirs as unknown as Array<Record<string, unknown>>).push({
    id: "heir_000001", sex: "daughter", fatherId: "lu_huaijin", bearer: "lu_huaijin",
    birthAt: makeGameTime(1, 1, "early"), favor: 10, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50,
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive", healthStatus: "healthy",
  });
  const raw = structuredClone(s) as unknown as Record<string, unknown>;
  delete raw["parentage"]; delete raw["adoptionRecords"]; delete raw["royalResidences"];
  delete raw["adoptionNextSeq"]; delete raw["royalResidenceNextSeq"];
  for (const h of (raw["resources"] as any).bloodline.heirs as Array<Record<string, unknown>>) {
    h["adoptiveFatherId"] = h["custodianId"]; delete h["custodianId"];
    if (h["faction"] === "custodian") h["faction"] = "adoptive";
    mutateHeir?.(h);
  }
  const env = { ...createSaveData(db, s, "slot1"), formatVersion: 38, state: raw, checksum: checksumOf(raw as never) };
  return JSON.stringify(env);
}

describe("v38 → v39 经 readSlot 真实迁移", () => {
  it("合法 v38 档迁移并通过 schema", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const st = loaded.value.state;
    expect(st.parentage["heir_000001"]).toEqual({
      biologicalMotherId: "sovereign", biologicalFatherId: "lu_huaijin",
      legalMotherId: "sovereign", legalFatherId: "lu_huaijin",
    });
    const h0 = st.resources.bloodline.heirs[0] as unknown as Record<string, unknown>;
    expect(h0["adoptiveFatherId"]).toBeUndefined();
    expect(st.adoptionRecords).toEqual({});
    expect(st.adoptionNextSeq).toBe(1);
  });

  it("坏档 fatherId=undefined 迁移后被 schema 拒绝（不静默成 null）", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save((h) => { delete h["fatherId"]; }));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(false);
  });
});
