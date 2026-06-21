/**
 * 信念投影（spec §信念投影）：gate 与对话装配读取「角色相信的事实」的统一边界。
 * v1 = GroundTruthBeliefProjection：读角色【可见】的 ground truth（非全知）。
 * 必经 CurrentFactVisibility；接入 rumor/certainty 后只替换实现，本接口不变。
 * 系统效果（applyEffects）永远只用 ground truth，不经此处。
 */
import type { GameState } from "../state/types";
import { isCurrentlyPresent } from "./presence";

export type FactPredicate = "resides_at" | "holds_rank";
export interface FactKey {
  predicate: FactPredicate;
  subjectId: string;
}
export interface BelievedFact {
  value: string;
  certainty: number; // 0–100
}

export interface CurrentFactVisibility {
  canSee(state: GameState, viewerId: string, key: FactKey): boolean;
}

export { isCurrentlyPresent };

/** MVP：当前位分/住处是宫廷公开事实——viewer 与 subject 均须【此刻在场】。 */
export const courtMemberVisibility: CurrentFactVisibility = {
  canSee(state, viewerId, key) {
    return isCurrentlyPresent(state, viewerId) && isCurrentlyPresent(state, key.subjectId);
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
