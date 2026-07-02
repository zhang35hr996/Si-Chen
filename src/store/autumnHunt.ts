/** 秋猎：9月中旬下午年度事件；按武力分档掉皮毛。 */
import { gestationRoll } from "../engine/characters/gestation";
import { AFTERNOON_SLOT } from "../engine/calendar/time";
import { shichenSlot } from "../engine/calendar/time";
import type { GameState } from "../engine/state/types";
import type { ChengFengPrompt } from "./prompt";

const LOW = ["tumao", "yezhiwei"];               // 兔毛 / 野雉尾羽
const MID = ["diaopi", "lupi", "lurong"];        // 貂皮 / 鹿皮 / 鹿茸
const HIGH = ["hulipi", "hupi", "yinlangpi"];    // 狐皮 / 虎皮 / 银狼皮

/** 按武力分档掉 2–3 件皮毛；高档 25% 额外掉一件下档。 */
export function huntFurs(martial: number, seedKey: string): string[] {
  const tier = martial >= 70 ? HIGH : martial >= 40 ? MID : LOW;
  const count = 2 + (gestationRoll(`hunt:n:${seedKey}`) % 2); // 2 或 3
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(tier[gestationRoll(`hunt:${i}:${seedKey}`) % tier.length]!);
  // 高/中档 25% 额外掉一件下一档
  const lower = tier === HIGH ? MID : tier === MID ? LOW : null;
  if (lower && gestationRoll(`hunt:extra:${seedKey}`) % 100 < 25) {
    out.push(lower[gestationRoll(`hunt:el:${seedKey}`) % lower.length]!);
  }
  return out;
}

export function autumnHuntFlagKey(year: number): string {
  return `autumnHunt:${year}`;
}

/** 9月中旬下午、当年未问过 → 询问 prompt；否则 null。 */
export function buildAutumnHuntPrompt(state: GameState, _seedKey: string): ChengFengPrompt | null {
  const cal = state.calendar;
  if (cal.month !== 9 || cal.period !== "mid") return null;
  if (shichenSlot(cal) !== AFTERNOON_SLOT) return null;
  if (state.flags[autumnHuntFlagKey(cal.year)]) return null;
  return {
    speakerId: "cheng_feng",
    line: "陛下，今年的秋猎将至，可要去松快下筋骨？",
    choices: [
      { label: "参加", action: { type: "huntJoin", year: cal.year } },
      { label: "不必了", action: { type: "huntDecline", year: cal.year } },
    ],
  };
}
