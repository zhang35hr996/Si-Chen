/** 上书房功课装配层（旧版兼容，PR3 后由 heirEducation.ts 替代）。 */
import { isEnrolled, listHeirsBySex } from "../engine/characters/heirs";
import type { GameState, Heir } from "../engine/state/types";

function heirDisplayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
const SUBJECT_LABEL: Record<(typeof SUBJECTS)[number], string> = {
  scholarship: "学问", martial: "骑射", virtue: "品行",
};

/** 问先生该皇嗣读书情况：纯汇报，按三项属性高低分支，不改属性。未开蒙返回 null。
 * @deprecated 使用 buildWenzhaoTutorReport */
export function buildTutorReport(_db: unknown, state: GameState, heirId: string): string[] | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isEnrolled(heir, state.calendar)) return null;
  const name = heirDisplayName(state, heir);
  const e = heir.education;
  const best = SUBJECTS.reduce((a, b) => (e[b] > e[a] ? b : a));
  const total = e.scholarship + e.martial + e.virtue;
  const overall = total >= 180 ? "出类拔萃" : total >= 90 ? "稳步精进" : "尚需勤勉";
  return [
    `先生向陛下回禀${name}的功课：${overall}。`,
    `其中${SUBJECT_LABEL[best]}最为见长（学问${e.scholarship}·骑射${e.martial}·品行${e.virtue}），望陛下时加策励。`,
  ];
}
