/** 文昭殿教育互动：旁听授课与询问先生。Phase 3 完整实现，本文件为 Phase 1 存根。 */
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export interface WenzhaoLessonPlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: string;
  speakerName: string;
}

export interface WenzhaoTutorReport {
  summary: string[];
  warnings: string[];
}

export function buildWenzhaoLesson(
  _state: GameState,
  _heirId: string,
  _subject: "scholarship" | "martial" | "virtue",
): WenzhaoLessonPlan | null {
  return null; // Phase 3 TODO
}

export function buildWenzhaoTutorReport(
  _state: GameState,
  _heirId: string,
): WenzhaoTutorReport | null {
  return null; // Phase 3 TODO
}
