/**
 * 官员世界完整性接入存档加载链路（review F3）：损坏的官员/家族/亲缘数据经 readSlot 应被
 * 拒绝并 quarantine（OFFICIAL_INTEGRITY），而非静默载入。所有用例修改 state 后由 createSaveData
 * 重算 checksum，确保命中的是 world validator 而非 checksum/schema 闸门。
 */
import { describe, it, expect } from "vitest";
import {
  CORRUPT_KEY_PREFIX,
  createSaveData,
  readSlot,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function expectQuarantineAfter(mutate: (s: GameState) => void, now: number) {
  const storage = createMemoryStorage();
  const state = createNewGameState(db, 1);
  mutate(state);
  storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
  const loaded = readSlot(storage, db, "slot1", { now: () => now });
  expect(loaded.ok).toBe(false);
  if (loaded.ok) return;
  expect(loaded.error.code).toBe("OFFICIAL_INTEGRITY");
  expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
  expect(storage.get(`${CORRUPT_KEY_PREFIX}${now}`)).not.toBeNull();
}

describe("readSlot rejects a save with a broken official world", () => {
  it("missing official family", () => {
    expectQuarantineAfter((s) => {
      const id = Object.keys(s.officials)[0]!;
      s.officials[id] = { ...s.officials[id]!, familyId: "fam_9999" };
    }, 1001);
  });

  it("missing official post", () => {
    expectQuarantineAfter((s) => {
      const id = Object.keys(s.officials)[0]!;
      s.officials[id] = { ...s.officials[id]!, postId: "no_such_post" };
    }, 1002);
  });

  it("missing kinship endpoint", () => {
    expectQuarantineAfter((s) => {
      s.kinship = [...s.kinship, { fromPersonId: "ghost", toPersonId: "ghost2", type: "sibling" }];
    }, 1003);
  });

  it("seat overflow", () => {
    expectQuarantineAfter((s) => {
      const [a, b] = Object.keys(s.officials);
      s.officials[a!] = { ...s.officials[a!]!, postId: "chengxiang" };
      s.officials[b!] = { ...s.officials[b!]!, postId: "chengxiang" };
    }, 1004);
  });

  it("two mothers", () => {
    expectQuarantineAfter((s) => {
      const me = s.kinship.find((k) => k.type === "mother")!;
      const other = Object.keys(s.officials).find((id) => id !== me.toPersonId)!;
      s.kinship = [...s.kinship, { fromPersonId: me.fromPersonId, toPersonId: other, type: "mother" }];
    }, 1005);
  });

  it("dead seated official", () => {
    expectQuarantineAfter((s) => {
      const seated = Object.values(s.officials).find((o) => o.postId !== null)!;
      s.officials[seated.id] = { ...seated, status: "dead" };
    }, 1006);
  });

  it("record-key / id mismatch", () => {
    expectQuarantineAfter((s) => {
      const [k, o] = Object.entries(s.officials)[0]!;
      s.officials[k] = { ...o, id: "official_relabelled" };
    }, 1007);
  });

  it("consort birthFamilyId moved to another family while mother edge kept", () => {
    expectQuarantineAfter((s) => {
      s.standing["shen_zhibai"] = { ...s.standing["shen_zhibai"]!, birthFamilyId: "fam_lu_main" };
    }, 1008);
  });

  it("mother edge crossing family lines", () => {
    expectQuarantineAfter((s) => {
      const child = s.kinship.find((k) => k.type === "mother")!.fromPersonId;
      const otherOfficial = Object.values(s.officials).find(
        (o) => o.familyId !== (s.officials[s.kinship.find((k) => k.fromPersonId === child && k.type === "mother")!.toPersonId]?.familyId),
      )!;
      s.kinship = s.kinship
        .filter((k) => !(k.fromPersonId === child && k.type === "mother"))
        .concat([{ fromPersonId: child, toPersonId: otherOfficial.id, type: "mother" }]);
    }, 1009);
  });

  it("male child with a daughter reverse edge", () => {
    expectQuarantineAfter((s) => {
      const sonEdge = s.kinship.find((k) => k.type === "son");
      if (!sonEdge) {
        // 兜底：制造一条 daughter 指向男性侍君的边。
        s.kinship = [...s.kinship, { fromPersonId: "official_fam_shen_main", toPersonId: "shen_zhibai", type: "daughter" }];
        return;
      }
      s.kinship = s.kinship.map((k) =>
        k.fromPersonId === sonEdge.fromPersonId && k.toPersonId === sonEdge.toPersonId && k.type === "son"
          ? { ...k, type: "daughter" as const }
          : k,
      );
    }, 1010);
  });

  it("maternalClan.familyId disagreeing with birthFamilyId", () => {
    expectQuarantineAfter((s) => {
      s.standing["shen_zhibai"] = { ...s.standing["shen_zhibai"]!, birthFamilyId: "fam_lu_main" };
    }, 1011);
  });

  it("a male person used as a mother", () => {
    expectQuarantineAfter((s) => {
      const child = Object.values(s.officials)[0]!.id;
      s.kinship = [...s.kinship, { fromPersonId: child, toPersonId: "shen_zhibai", type: "mother" }];
    }, 1012);
  });

  it("a clean fresh save still loads", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db, 1);
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 9000 });
    expect(loaded.ok).toBe(true);
  });
});
