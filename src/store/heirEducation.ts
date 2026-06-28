/** 文昭殿教育互动：旁听授课（buildWenzhaoLesson）与询问先生（buildWenzhaoTutorReport）。 */
import { gestationRollRaw } from "../engine/characters/gestation";
import { heirPortraitSet, isWenzhaoStudent, listHeirsBySex } from "../engine/characters/heirs";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir, HeirSex } from "../engine/state/types";

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

const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
type Subject = (typeof SUBJECTS)[number];

/** 性别化课程名。底层 subject 不变，仅用于展示层与台词。 */
export function courseLabel(sex: HeirSex, subject: Subject): string {
  if (sex === "daughter") {
    if (subject === "scholarship") return "经史治术";
    if (subject === "martial") return "骑射兵略";
    return "礼法德行";
  }
  if (subject === "scholarship") return "经史诗书";
  if (subject === "martial") return "骑射强身";
  return "礼仪德行";
}

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

// ── 同窗片段（30% 概率，须有真实第二名在读皇嗣）────────────────────────────────

function peerFragment(
  state: GameState,
  heir: Heir,
  subject: Subject,
  seed: string,
): string {
  const p = peer(state, heir, seed);
  const peerName = displayName(state, p);
  const heirName = displayName(state, heir);
  const subjectCourse = courseLabel(heir.sex, subject);
  const bothSocial = heir.personality.sociability >= 65 && p.personality.sociability >= 65;
  const heirEmpathy = heir.personality.empathy >= 65;
  const peerWeak = p.personality.empathy < 40;
  const bothAssert = heir.personality.assertiveness >= 65 && p.personality.assertiveness >= 65;
  const heirGuile = heir.personality.guile >= 65;
  const peerGuile = p.personality.guile >= 65;

  if (subject === "scholarship") {
    if (bothSocial) return `课间${peerName}低声凑来，两人悄声讨论起一处典故，互相补充，引得先生侧目。`;
    if (heirEmpathy && peerWeak) return `${peerName}在旁卡住了半晌，${heirName}见状悄悄把思路写在小纸条上递了过去。`;
    if (bothAssert) return `${peerName}与${heirName}争论一处诠释，各执一词，声音不觉大了些，先生咳了一声才平息。`;
    if (heirGuile && !peerGuile) return `${peerName}抄了一段，被先生当场看穿，${heirName}悄悄撇开视线，不动声色。`;
    return `课后${peerName}围着追问${subjectCourse}的疑难，${heirName}耐心拆解，来回好一番交流。`;
  }
  if (subject === "martial") {
    if (bothSocial) return `演练间歇${peerName}拉着${heirName}比试拉弓，两人你追我赶，直到先生叫停才罢休。`;
    if (bothAssert) return `${peerName}下手偏重，两人切磋时险些绊倒，相视苦笑后各自重来，愈打愈起劲。`;
    if (heirEmpathy && peerWeak) return `${peerName}脚步踉跄，${heirName}悄悄让出半步位置，两人配合反倒流畅了许多。`;
    return `收课后${peerName}低声请教发力技巧，${heirName}演示了一遍，旁边几人凑来，围了一小圈。`;
  }
  // virtue
  if (bothSocial) return `礼仪课上${peerName}忍不住偷笑，两人对视一眼，先生板脸重讲，笑声才勉强压住。`;
  if (heirEmpathy && peerWeak) return `${peerName}行礼时踩错方位，${heirName}悄悄用眼神示意该怎么站，${peerName}如获救星。`;
  return `${peerName}行礼时袖子甩偏，碰到了${heirName}，两人面面相觑，忍笑复又整衣。`;
}

function peer(state: GameState, heir: Heir, seed: string): Heir {
  const peers = state.resources.bloodline.heirs.filter(
    (c) => c.id !== heir.id && isWenzhaoStudent(c, state.calendar),
  );
  const idx = gestationRollRaw(seed + ":peeridx") % peers.length;
  return peers[idx]!;
}

function maybePeerFragment(
  state: GameState,
  heir: Heir,
  subject: Subject,
  seed: string,
): string[] {
  const peers = state.resources.bloodline.heirs.filter(
    (c) => c.id !== heir.id && isWenzhaoStudent(c, state.calendar),
  );
  if (peers.length === 0) return [];
  const roll = gestationRollRaw(seed + ":peer") % 10;
  if (roll >= 3) return []; // 70% 无同窗片段
  return [peerFragment(state, heir, subject, seed)];
}

// ── 旁听授课台词 ──────────────────────────────────────────────────────────────

function buildLessonLines(name: string, subject: Subject, performance: Performance, heir: Heir): string[] {
  const subjectStr = courseLabel(heir.sex, subject);
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
  const peerLines = maybePeerFragment(state, heir, subject, seed);

  return {
    effects: [{ type: "heir_educate", heirId, subject, attrDelta, favorDelta: 0 }],
    lines: [...buildLessonLines(name, subject, performance, heir), ...peerLines],
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
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
    `三科详情：${courseLabel(heir.sex, "scholarship")} ${e.scholarship}·${courseLabel(heir.sex, "martial")} ${e.martial}·${courseLabel(heir.sex, "virtue")} ${e.virtue}，` +
      `${courseLabel(heir.sex, best)}最为见长，${courseLabel(heir.sex, worst)}尚需加强。`,
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
