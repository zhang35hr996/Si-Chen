/** 文昭殿教育互动：旁听授课（buildWenzhaoLesson）与询问先生（buildWenzhaoTutorReport）。 */
import { gestationRollRaw } from "../engine/characters/gestation";
import { heirPortraitSet, isWenzhaoStudent, listHeirsBySex } from "../engine/characters/heirs";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

export interface WenzhaoLessonPlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: string;
  speakerName: string;
  peerFragments: string[];
}

export interface WenzhaoTutorReport {
  summary: string[];
  warnings: string[];
}

const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
type Subject = (typeof SUBJECTS)[number];

const SUBJECT_LABEL: Record<Subject, string> = {
  scholarship: "学问", martial: "骑射", virtue: "品行",
};

function displayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

/** subject 对应性格特征权重：学问→curiosity，骑射→assertiveness，品行→restraint */
function relevantTrait(heir: Heir, subject: Subject): number {
  if (subject === "scholarship") return heir.personality.curiosity;
  if (subject === "martial") return heir.personality.assertiveness;
  return heir.personality.restraint;
}

type Performance = "excellent" | "good" | "mixed" | "poor";

function computeScore(heir: Heir, subject: Subject, seed: string): number {
  const noise = (gestationRollRaw(seed + ":noise") % 21) - 10;
  return (
    heir.education[subject] * 0.30 +
    heir.talent * 0.25 +
    heir.diligence * 0.25 +
    relevantTrait(heir, subject) * 0.15 +
    heir.health * 0.05 -
    heir.neglect * 0.15 +
    noise
  );
}

function scoreToPerformance(score: number): Performance {
  if (score >= 75) return "excellent";
  if (score >= 55) return "good";
  if (score >= 35) return "mixed";
  return "poor";
}

const ATTR_DELTA: Record<Performance, number> = {
  excellent: 4, good: 3, mixed: 2, poor: 1,
};

const PERF_LABEL: Record<Performance, string> = {
  excellent: "出色", good: "稳健", mixed: "尚可", poor: "欠佳",
};

// ── 同窗片段（30% 概率，确定性）────────────────────────────────────────────────

const PEER_FRAGMENTS: Record<Subject, string[]> = {
  scholarship: [
    "课间有同窗低声请教，两人凑在一起反复推敲，引得先生侧目。",
    "诵读时，隔壁座位的同窗跟不上进度，悄悄抄了一段——被先生当场看穿。",
    "课后同窗们争论一处典故，各执一词，吵得面红耳赤，无人让步。",
  ],
  martial: [
    "演练时有同窗脚步踉跄，险些撞上，两人相视苦笑，各自重头练起。",
    "课后同窗拉着一起比试拉弓，你追我赶，直到天色将暗才肯罢休。",
    "一位同窗偷偷向先生请教发力技巧，被旁边人听见，一下子围了一圈。",
  ],
  virtue: [
    "礼仪课上同窗忍不住偷笑，先生板着脸重讲了一遍，笑声才压下去。",
    "课后同窗们围在一起，把讲过的典故扒拉出来说故事，越说越离谱。",
    "一位同窗行礼时袖子甩到了邻座，两人面面相觑，忍笑复又整衣。",
  ],
};

function maybePeerFragment(_heir: Heir, subject: Subject, seed: string, dayIndex: number): string[] {
  const roll = gestationRollRaw(seed + ":peer:" + dayIndex) % 10;
  if (roll >= 3) return []; // 70% 无同窗片段
  const pool = PEER_FRAGMENTS[subject];
  const idx = gestationRollRaw(seed + ":peeridx") % pool.length;
  return [pool[idx]!];
}

// ── 旁听授课台词 ──────────────────────────────────────────────────────────────

function buildLessonLines(name: string, subject: Subject, performance: Performance, heir: Heir): string[] {
  const subjectStr = SUBJECT_LABEL[subject];
  const perf = PERF_LABEL[performance];
  const { curiosity, restraint } = heir.personality;
  const guile = heir.personality.guile;
  const maskedWeakness = guile >= 65 && performance !== "excellent";

  const opening = `陛下移驾文昭殿，旁听${name}的${subjectStr}课。`;

  if (performance === "excellent") {
    return [
      opening,
      curiosity >= 65
        ? `${name}举一反三，课后还拉着先生追问了好几处，先生连连点头，面露赞许。`
        : `${name}条理清晰，一题未错，先生称赞表现${perf}，令陛下颔首。`,
    ];
  }
  if (performance === "good") {
    return [
      opening,
      maskedWeakness
        ? `${name}应答流畅，${perf}，只在几处生僻处巧妙绕开，并未露出明显破绽。`
        : `${name}回答稳当，偶有疏漏随即更正，先生评定表现${perf}。`,
    ];
  }
  if (performance === "mixed") {
    return [
      opening,
      maskedWeakness
        ? `${name}思路灵活，用措辞掩过了几处不熟之处，先生评定表现${perf}，仍有精进空间。`
        : restraint >= 65
        ? `${name}认真聆听，遇到不会之处沉默片刻才作答，表现${perf}，态度勤谨。`
        : `${name}勉力应答，几处明显生疏，先生说表现${perf}，须加倍温习。`,
    ];
  }
  // poor
  return [
    opening,
    maskedWeakness
      ? `${name}支吾数回后改口，终究未能掩过，先生叹道功课${perf}，还需从头补。`
      : `${name}答得吃力，卡在几处久久说不出，先生正色道功课${perf}，布了加倍的课业。`,
  ];
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

/** 文昭殿旁听授课（耗 1 AP）。非在读皇嗣返回 null。 */
export function buildWenzhaoLesson(
  state: GameState,
  heirId: string,
  subject: Subject,
): WenzhaoLessonPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isWenzhaoStudent(heir, state.calendar)) return null;

  const seed = `wenzhaolesson:${state.rngSeed}:${heirId}:${state.calendar.dayIndex}`;
  const score = computeScore(heir, subject, seed);
  const performance = scoreToPerformance(score);
  const attrDelta = ATTR_DELTA[performance];
  const name = displayName(state, heir);
  const peerFragments = maybePeerFragment(heir, subject, seed, state.calendar.dayIndex);

  return {
    effects: [{ type: "heir_educate", heirId, subject, attrDelta, favorDelta: 0 }],
    lines: buildLessonLines(name, subject, performance, heir),
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
    peerFragments,
  };
}

/** 询问先生功课情况（耗 1 AP）。非在读皇嗣返回 null。 */
export function buildWenzhaoTutorReport(
  state: GameState,
  heirId: string,
): WenzhaoTutorReport | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isWenzhaoStudent(heir, state.calendar)) return null;

  const name = displayName(state, heir);
  const e = heir.education;
  const total = e.scholarship + e.martial + e.virtue;
  const best = SUBJECTS.reduce((a, b) => (e[b] > e[a] ? b : a));
  const worst = SUBJECTS.reduce((a, b) => (e[b] < e[a] ? b : a));

  const overallLabel = total >= 180 ? "出类拔萃" : total >= 120 ? "稳步精进" : total >= 60 ? "中规中矩" : "尚需勤勉";

  const summary: string[] = [
    `先生向陛下禀报${name}近来的功课，总评：${overallLabel}。`,
    `三科详情：学问 ${e.scholarship}·骑射 ${e.martial}·品行 ${e.virtue}，` +
      `${SUBJECT_LABEL[best]}最为见长，${SUBJECT_LABEL[worst]}尚需加强。`,
  ];

  const warnings: string[] = [];
  if (heir.neglect >= 60) {
    warnings.push(`先生提及${name}近来似乎心绪不定，思路时有游离，望陛下多加关怀。`);
  }
  const balanceRatio = Math.max(...SUBJECTS.map((s) => e[s])) / Math.max(1, Math.min(...SUBJECTS.map((s) => e[s])));
  if (balanceRatio >= 3) {
    warnings.push(`三科差距悬殊，先生建议适当均衡，以免偏科影响日后造诣。`);
  }

  return { summary, warnings };
}
