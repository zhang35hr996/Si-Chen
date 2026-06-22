/** 健康系统的角色解析：当前年龄分派 + 在世侍君集合（含动态选秀）。 */
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import type { HealthSubject } from "./health";
import { presetAge, heirAge, dynamicConsortAge } from "../engine/characters/aging";

/** #8 — 解析失败必须显式抛错（不静默回退年龄）；健康 tick 是全局事务，遇坏状态宁可整次拒绝 + 诊断。 */
export function currentAgeOf(db: ContentDB, state: GameState, subject: HealthSubject): number {
  const year = state.calendar.year;
  switch (subject.kind) {
    case "sovereign": return db.world.sovereign.startingAge + (year - 1);
    case "taihou": {
      const t = db.characters["taihou"];
      if (!t) throw new Error("currentAgeOf: missing 太后 content");
      return presetAge(t.profile.age, year);
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === subject.id);
      if (!h) throw new Error(`currentAgeOf: missing heir ${subject.id}`);
      return heirAge(h.birthAt, { year });
    }
    case "consort": {
      const st = state.standing[subject.id];
      if (st?.ageAtEntry !== undefined && st.enteredAtYear !== undefined)
        return dynamicConsortAge(st.ageAtEntry, st.enteredAtYear, year);
      const content = db.characters[subject.id] ?? state.generatedConsorts[subject.id];
      if (!content) throw new Error(`currentAgeOf: missing consort content ${subject.id}`);
      return presetAge(content.profile.age, year);
    }
  }
}

export function livingConsortIds(db: ContentDB, state: GameState): string[] {
  const ids = new Set<string>();
  for (const [id, st] of Object.entries(state.standing)) {
    const c = db.characters[id] ?? state.generatedConsorts[id];
    if (c?.kind !== "consort") continue;
    if (st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    ids.add(id);
  }
  return [...ids].sort();
}
