/** 御书房召见皇嗣 / 上书房问功课的装配层：纯台词 + effects，经子屏重放。 */
import { heirStage, heirPortraitSet, isEnrolled, listHeirsBySex } from "../engine/characters/heirs";
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

export interface HeirInteractionPlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: "child_baby" | "child_school";
  speakerName: string;
}

/** 该 heir 的「序号名（小名/正名）」用于子屏 speaker。 */
function heirDisplayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

/** 御书房召见：+20 宠爱 + 按阶段/恩宠的童趣台词。未知 heir 返回 null。 */
export function buildHeirSummon(_db: ContentDB, state: GameState, heirId: string): HeirInteractionPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir) return null;
  const stage = heirStage(heir, state.calendar);
  const name = heirDisplayName(state, heir);

  let lines: string[];
  if (stage === "infant") {
    lines = [
      `乳母抱来襁褓中的${name}，粉雕玉琢，见了陛下咯咯直笑，小手胡乱抓握。`,
      `陛下逗弄片刻，${name}伊伊呀呀，宫人皆道与陛下亲厚。`,
    ];
  } else if (stage === "toddler") {
    lines = heir.favor >= 50
      ? [
          `${name}迈着小短腿扑到陛下膝前，仰头脆生生道："父…父皇！"惹得满殿失笑。`,
          `奶声奶气说了半日宫里趣事，黏着陛下不肯走，天真烂漫。`,
        ]
      : [
          `${name}被乳母牵来，怯生生行了个不成样子的礼，偷眼打量陛下。`,
          `陛下温言相询，半晌才敢小声答话，渐渐放开了些。`,
        ];
  } else {
    lines = [
      `${name}规规矩矩上前请安，举止已有几分皇家气度，应对从容。`,
      `陛下问起近日起居，${name}一一作答，眉宇间难掩孺慕。`,
    ];
  }

  return {
    effects: [{ type: "heir_summon", heirId }],
    lines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}

const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
const SUBJECT_LABEL: Record<(typeof SUBJECTS)[number], string> = {
  scholarship: "学问", martial: "骑射", virtue: "品行",
};

/** 上书房问功课：仅开蒙皇嗣。轮换一科 +（确定性）并增宠爱。未开蒙返回 null。 */
export function buildHeirLesson(_db: ContentDB, state: GameState, heirId: string): HeirInteractionPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isEnrolled(heir, state.calendar)) return null;
  const roll = gestationRoll(`lesson:${state.rngSeed}:${heirId}:${heir.favor}`);
  const subject = SUBJECTS[roll % SUBJECTS.length]!;
  const name = heirDisplayName(state, heir);
  return {
    effects: [{ type: "heir_educate", heirId, subject, attrDelta: 6, favorDelta: 4 }],
    lines: [
      `陛下移驾上书房，考较${name}的${SUBJECT_LABEL[subject]}。`,
      `${name}凝神应答，引经据典，颇见用功。陛下颔首嘉许，${name}受宠若惊，愈发勤勉。`,
    ],
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}

/** 问先生该皇嗣读书情况：纯汇报，按三项属性高低分支，不改属性。未开蒙返回 null。 */
export function buildTutorReport(_db: ContentDB, state: GameState, heirId: string): string[] | null {
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
