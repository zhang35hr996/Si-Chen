/**
 * 太后训诫的「空间门控 + 乘风询问」纯逻辑（无副作用、无 React）。
 *
 * 流程：宫内行动按 5% 掷骰命中 → 不立即播放太后台词，先由乘风询问「陛下可要过去看看？」
 *  - 去看看：应用 effects + 以慈宁宫背景播放训诫过场（不迁移位置，不 setView）；
 *  - 不必了：应用同一份 effects（训诫已发生），不播放现场台词。
 * 宫外（京城/郊外/慈恩寺等）：不掷骰、不提示、不应用任何 effects。
 */
import { isGreetingSlot } from "../engine/calendar/time";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import { buildTaihouRebuke, type RebukePlan } from "./taihou";
import { isImperialInteriorZone } from "./presentedScene";
import type { ChengFengPrompt } from "./prompt";

/** 仅在宫内才掷太后训诫；宫外一律 null（不掷骰、不应用 effects）。 */
export function maybeBuildRebukeForAction(
  db: ContentDB,
  state: GameState,
  seedKey: string,
  presentedZone: string | undefined,
): RebukePlan | null {
  if (!isImperialInteriorZone(presentedZone)) return null;
  if (state.playerLocation === "kunninggong" && isGreetingSlot(state.calendar)) return null;
  return buildTaihouRebuke(db, state, seedKey);
}

/** 乘风询问 prompt：显示目标当前完整称谓 + 去看看/不必了。 */
export function buildTaihouRebukePrompt(plan: RebukePlan): ChengFengPrompt {
  return {
    speakerId: "cheng_feng",
    line: "陛下，太后似乎正在慈宁宫训诫" + plan.targetDisplayName + "。陛下可要过去看看？",
    choices: [
      { label: "去看看", action: { type: "taihouRebukeAttend" } },
      { label: "不必了", action: { type: "taihouRebukeDecline" } },
    ],
  };
}

export interface RebukeBeat {
  speakerId: string;
  lines: string[];
  backgroundKey: string;
}

/**
 * 「去看看」的过场节拍：太后与目标侍君的现场台词，统一以慈宁宫背景呈现。
 * 仅为临时背景过场——不 setView("cining_gong")、不改 playerLocation。
 */
export function rebukeAttendBeats(plan: RebukePlan, ciningBackgroundKey: string): RebukeBeat[] {
  return plan.beats.map((b) => ({ ...b, backgroundKey: ciningBackgroundKey }));
}
