/**
 * 信念投影（spec §信念投影）：gate 与对话装配读取「角色相信的事实」的统一边界。
 * v1 = GroundTruthBeliefProjection：读角色【可见】的 ground truth（非全知）。
 * 必经 CurrentFactVisibility；接入 rumor/certainty 后只替换实现，本接口不变。
 * 系统效果（applyEffects）永远只用 ground truth，不经此处。
 */
import type { GameState } from "../state/types";
import { isCurrentlyPresent, characterExists } from "./presence";

export type FactPredicate = "resides_at" | "holds_rank" | "alive";
export interface FactKey {
  predicate: FactPredicate;
  subjectId: string;
}
export interface BelievedFact {
  value: string | boolean;
  certainty: number; // 0–100
}

export interface CurrentFactVisibility {
  canSee(state: GameState, viewerId: string, key: FactKey): boolean;
}

export { isCurrentlyPresent };

/** MVP：当前位分/住处是宫廷公开事实——viewer 须在场；subject 视谓词而定。 */
export const courtMemberVisibility: CurrentFactVisibility = {
  canSee(state, viewerId, key) {
    if (!isCurrentlyPresent(state, viewerId)) return false; // viewer 须在场
    // alive 可查死者（死者仍存在）；现状类谓词只查在场者
    return key.predicate === "alive"
      ? characterExists(state, key.subjectId)
      : isCurrentlyPresent(state, key.subjectId);
  },
};

export interface BeliefProjection {
  getFact(charId: string, key: FactKey): BelievedFact | undefined;
}

export class GroundTruthBeliefProjection implements BeliefProjection {
  constructor(
    private readonly state: GameState,
    private readonly visibility: CurrentFactVisibility = courtMemberVisibility,
  ) {}

  getFact(charId: string, key: FactKey): BelievedFact | undefined {
    if (!this.visibility.canSee(this.state, charId, key)) return undefined;
    // alive 谓词：先查 standing，再查 heirs（支持皇嗣 subject）
    if (key.predicate === "alive") {
      const standing = this.state.standing[key.subjectId];
      if (standing) return { value: standing.lifecycle !== "deceased", certainty: 100 };
      const heirEntry = this.state.resources.bloodline.heirs.find((h) => h.id === key.subjectId);
      return heirEntry ? { value: heirEntry.lifecycle !== "deceased", certainty: 100 } : undefined;
    }
    // 现状类谓词：subject 须有 standing（已由 canSee 保证在场）
    const st = this.state.standing[key.subjectId];
    if (!st) return undefined;
    switch (key.predicate) {
      case "holds_rank":
        return { value: st.rank, certainty: 100 };
      case "resides_at":
        return st.residence ? { value: st.residence, certainty: 100 } : undefined;
    }
  }
}
