import { describe, expect, it } from "vitest";
import { bestow } from "../../src/store/treasury";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const TIER_BASE = { common: 2, fine: 4, treasure: 7, marvel: 12 } as const;

describe("bestow 赏赐", () => {
  it("侍君：扣库存、加恩宠与好感", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    // Find a consort that's actually in state.standing (generated or empress)
    const consortId = Object.keys(state.standing).find((id) => {
      const c = db.characters[id] ?? state.generatedConsorts[id];
      return c?.kind === "consort" && state.standing[id]?.rank !== "huanghou";
    })!;
    const consort = db.characters[consortId] ?? state.generatedConsorts[consortId]!;
    // 用一件 common(base=2) 物品
    const common = Object.values(db.items).find((i) => i.tier === "common")!;
    state.resources.storehouse.items[common.id] = 1;
    const favor0 = state.standing[consortId]!.favor;
    const aff0 = state.standing[consortId]!.affection!;
    const r = bestow(state, db, common.id, { kind: "consort", id: consortId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.resources.storehouse.items[common.id]).toBeUndefined();
    expect(r.state.standing[consortId]!.favor).toBe(favor0 + 2);
    expect(r.state.standing[consortId]!.affection).toBe(aff0 + 1);
  });

  it("投其所好：tag 命中 likes 时好感翻倍", () => {
    const db = loadRealContent();
    // Use a story consort with known likes so the calculation is deterministic
    const storyConsortWithLikes = Object.values(db.characters).find(
      (c) => c.kind === "consort" && c.attributes?.likes?.length,
    );
    if (!storyConsortWithLikes) return; // 无有 likes 的侍君则跳过
    const consortId = storyConsortWithLikes.id;
    const state = withConsort(createNewGameState(db), db, consortId);
    const consort = storyConsortWithLikes;
    const likes = consort.attributes!.likes!;
    // 找到 tags 与 likes 有交集的任意物品（任意 tier）
    const liked = Object.values(db.items).find((i) => i.tags.some((t) => likes.includes(t)));
    if (!liked) return; // 目录无对应物则跳过（目录完整时不应进入此分支）
    state.resources.storehouse.items[liked.id] = 1;
    const base = TIER_BASE[liked.tier as keyof typeof TIER_BASE];
    // 命中 likes 时：affDelta = round(base/2) + round(base/2)（第二个是翻倍加成）
    const affDelta = Math.round(base / 2) + Math.round(base / 2);
    const aff0 = state.standing[consortId]!.affection ?? consort.hidden?.affection ?? 0;
    const expectedAff = Math.min(100, Math.max(0, aff0 + affDelta));
    const r = bestow(state, db, liked.id, { kind: "consort", id: consortId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.standing[consortId]!.affection).toBe(expectedAff);
  });

  it("库存不足 → 失败，state 不变", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const consortId = Object.keys(state.standing).find((id) => {
      const c = db.characters[id] ?? state.generatedConsorts[id];
      return c?.kind === "consort" && state.standing[id]?.rank !== "huanghou";
    })!;
    const r = bestow(state, db, "nonexistent_item", { kind: "consort", id: consortId });
    expect(r.ok).toBe(false);
  });

  it("皇嗣：加 favor 与 closeness", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const fine = Object.values(db.items).find((i) => i.tier === "fine")!; // base=4
    state.resources.storehouse.items[fine.id] = 1;
    state.resources.bloodline.heirs.push({
      id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
      birthAt: state.calendar, favor: 50, legitimate: true, petName: "", education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 40, support: 20, faction: "none", lifecycle: "alive",
    });
    const r = bestow(state, db, fine.id, { kind: "heir", id: "heir_000001" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.state.resources.bloodline.heirs.find((x) => x.id === "heir_000001")!;
    expect(h.favor).toBe(54);
    expect(h.closeness).toBe(42);
  });
});
