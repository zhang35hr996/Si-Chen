/** PR3B 授官 selectors + 长期 sweep（exam → 授官 → lifecycle → save/load 恒绿）。 */
import { describe, expect, it } from "vitest";
import {
  getVacantPostsForCandidate,
  rankCandidatesForPost,
} from "../../src/engine/officials/candidateAppointmentSelectors";
import { appointOfficialCandidate } from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { gestationRoll } from "../../src/engine/characters/gestation";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("getVacantPostsForCandidate", () => {
  it("returns vacancies sorted by fit desc; empty for non-eligible / unknown candidate", () => {
    const s = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const c = getEligibleOfficialCandidates(s)[0]!;
    const v = getVacantPostsForCandidate(s, db, c.id);
    expect(v.length).toBeGreaterThan(0);
    for (let i = 1; i < v.length; i++) expect(v[i - 1]!.fit).toBeGreaterThanOrEqual(v[i]!.fit);
    expect(getVacantPostsForCandidate(s, db, "cand_ghost")).toEqual([]);
    const expired = { ...c, id: "cand_e", status: "expired" as const };
    const s2 = { ...s, officialCandidates: { ...s.officialCandidates, [expired.id]: expired } };
    expect(getVacantPostsForCandidate(s2, db, expired.id)).toEqual([]);
  });

  it("rankCandidatesForPost excludes non-eligible (appointed) candidates", () => {
    const base = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const c = getEligibleOfficialCandidates(base)[0]!;
    const postId = getVacantPosts(base, db)[0]!.postId;
    const r = appointOfficialCandidate(base, db, c.id, postId, at(1));
    if (!r.ok) throw new Error("appoint failed");
    expect(rankCandidatesForPost(r.value, db, postId).some((x) => x.candidate.id === c.id)).toBe(false);
  });
});

/** 确定性地选取约半数候补授任到适配最高的空缺。 */
function appointSomeDeterministically(s: GameState, year: number): GameState {
  let cur = s;
  for (const c of getEligibleOfficialCandidates(cur)) {
    if (gestationRoll(`test:appoint:${year}:${c.id}`) % 2 !== 0) continue; // ~半数
    const v = getVacantPostsForCandidate(cur, db, c.id);
    if (v.length === 0) break;
    const r = appointOfficialCandidate(cur, db, c.id, v[0]!.postId, at(year));
    if (r.ok) cur = r.value;
  }
  return cur;
}

describe("long sweep — exam + appointments stay valid across years", () => {
  it("seeds 1..12 over 12 years: schema + validator + seat capacity + save/load clean", () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = createNewGameState(db, seed);
      for (let y = 1; y <= 12; y++) {
        s = settleAnnualExamination(s, db, y, at(y));
        s = appointSomeDeterministically(s, y);
      }
      const errs = validateOfficialWorld(s, db);
      if (errs.length) throw new Error(`seed ${seed}: ${errs.map((e) => e.code).join(",")}`);
      expect(gameStateSchema.safeParse(s).success).toBe(true);
      // 席位不超额。
      const occ = new Map<string, number>();
      for (const o of Object.values(s.officials)) if (o.postId) occ.set(o.postId, (occ.get(o.postId) ?? 0) + 1);
      for (const [postId, n] of occ) expect(n).toBeLessThanOrEqual(db.officialPosts[postId]!.seatCount);
      // save/load round-trip 保留任命关系。
      const storage = createMemoryStorage();
      storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
      const loaded = readSlot(storage, db, "slot1", { now: () => seed });
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.state.officialCandidates).toEqual(s.officialCandidates);
    }
  });
});
