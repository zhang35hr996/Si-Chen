/**
 * 有效抚养人判定（共享 selector）。供抚养权转移、月度成长结算、毓庆宫 UI、养父事件统一调用，
 * 避免每个模块各写一套标准。纯函数，引擎层（不依赖 store）。
 *
 * 法律抚养关系（adoptiveFatherId）与「本月能否亲自照料」分离：
 *  - confined / cold_palace 表示**暂时**不能照料——绝不据此清除 adoptiveFatherId；
 *  - missing / deceased 为**永久**失效——嫡出皇嗣据此解锁重新指定抚养人。
 */
import { isConfined } from "./confinement";
import { isInColdPalace } from "./coldPalace";
import type { ContentDB } from "../content/loader";
import type { GameState, Heir } from "../state/types";

export type CustodianAvailability =
  | "available"    // 在宫、未亡、非候选、未禁足、不在冷宫
  | "missing"      // 无 adoptiveFatherId
  | "deceased"     // 养父已故（太后/侍君）
  | "candidate"    // 候选侍君尚未正式入宫
  | "confined"     // 禁足（暂时不能亲自照料）
  | "cold_palace"; // 冷宫

export interface CustodianAvailabilityResult {
  custodianId?: string;
  availability: CustodianAvailability;
}

export function resolveCustodianAvailability(
  db: ContentDB,
  state: GameState,
  heir: Heir,
): CustodianAvailabilityResult {
  const custodianId = heir.adoptiveFatherId;
  if (!custodianId) return { availability: "missing" };

  // 太后（elder）
  const char = db.characters[custodianId] ?? state.generatedConsorts[custodianId];
  if (custodianId === "taihou" || char?.kind === "elder") {
    if (state.taihou.deceased) return { custodianId, availability: "deceased" };
    return { custodianId, availability: "available" };
  }

  // 侍君（consort）
  const st = state.standing[custodianId];
  if (!st || st.lifecycle === "deceased") return { custodianId, availability: "deceased" };
  if (st.lifecycle === "candidate") return { custodianId, availability: "candidate" };
  if (isInColdPalace(state, custodianId)) return { custodianId, availability: "cold_palace" };
  if (isConfined(state, custodianId)) return { custodianId, availability: "confined" };
  return { custodianId, availability: "available" };
}

/** 抚养人是否能本月亲自照料（available 为真；其余皆否）。 */
export function custodianCanCareNow(availability: CustodianAvailability): boolean {
  return availability === "available";
}

/**
 * 嫡出皇嗣是否解锁重新指定抚养人。仅当**现有**抚养人身故或入冷宫时解锁
 * （皇后死亡/入冷宫造成的死锁）——adoptiveFatherId 死后不清除，故为 deceased/cold_palace，
 * 绝非 missing。"missing"（从无抚养人）属退化态，保持锁定；短期禁足不强制解锁。
 */
export function custodianUnlocksRecustody(availability: CustodianAvailability): boolean {
  return availability === "deceased" || availability === "cold_palace";
}
