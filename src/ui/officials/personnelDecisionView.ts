/**
 * 人事决策的只读展示派生（UI 专用；引擎不依赖）。把 PersonnelDecision + state + db 解析为决策卡所需的
 * 来源/类型/相关人/官职/政绩/适配/标签/后果文案，以及各裁断选项的可用性与「行政/惩戒」标签。
 *
 * 行政升迁与皇帝亲发惩戒的边界在此明确标注；按钮可用性（空缺/目标）实时据 state 计算，杜绝「可点却失败」。
 */
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, PersonnelDecision, PersonnelDecisionResolution } from "../../engine/state/types";
import { candidatePostFit } from "../../engine/officials/fit";
import { isPostVacant } from "../../engine/officials/selectors";
import { resolveDisplayName } from "../../engine/characters/standing";

/** 裁断选项的性质：行政任用 / 皇帝亲发惩戒 / 中性（拒绝、罪止其身）。 */
export type DecisionTone = "administrative" | "punishment" | "neutral";

export const DECISION_KIND_LABEL: Record<PersonnelDecision["kind"], string> = {
  consort_petition_promotion: "侍君请托·擢拔亲族",
  family_implication: "获罪牵连·罪连家族",
  memorial_promotion: "人事奏折·荐升",
  memorial_demotion: "人事奏折·请降",
  memorial_dismissal: "人事奏折·请免",
};

export const ADMINISTRATIVE_NOTE = "此举属于行政任用，不记为惩罚。";
export const PUNISHMENT_NOTE = "此举属于皇帝亲发惩戒，将记入惩罚记录，并影响官员忠心与家族皇恩。";

export interface DecisionOptionView {
  resolution: PersonnelDecisionResolution;
  label: string;
  tone: DecisionTone;
  disabled: boolean;
  disabledReason?: string;
  /** 行政/惩戒提示文案（仅 administrative/punishment 提供）。 */
  note?: string;
}

export interface PersonnelDecisionCard {
  id: string;
  kind: PersonnelDecision["kind"];
  kindLabel: string;
  /** 来源叙述（请托侍君 / 获罪牵连 / 某衙奏折）。 */
  source: string;
  consortName?: string;
  officialName: string;
  familyName?: string;
  currentPostLabel: string;
  recommendedPostLabel?: string;
  /** 当前政绩 0–100（无则 —）。 */
  merit?: number;
  /** 当前官职能力适配 0–100（无职则 —）。 */
  aptitudeFit?: number;
  options: DecisionOptionView[];
}

function postLabel(db: ContentDB, postId: string | undefined | null): string | undefined {
  if (!postId) return undefined;
  const p = db.officialPosts[postId];
  return p ? `${p.grade}·${p.name}` : postId;
}

function consortName(db: ContentDB, state: GameState, consortId: string): string {
  const c = db.characters[consortId] ?? state.generatedConsorts[consortId];
  if (!c) return consortId;
  const st = state.standing[consortId];
  const rank = st ? db.ranks[st.rank] : undefined;
  return resolveDisplayName(c, st, rank);
}

/** 决策卡的来源叙述。 */
function sourceText(d: PersonnelDecision, consort: string | undefined, official: string): string {
  switch (d.kind) {
    case "consort_petition_promotion": return `${consort ?? "侍君"}私下恳请陛下擢拔其族中之人`;
    case "family_implication": return `${consort ?? "侍君"}获罪，是否牵连其族中官员${official}`;
    case "memorial_promotion": return `吏部上奏，荐${official}升迁`;
    case "memorial_demotion": return `御史上奏，请降${official}之职`;
    case "memorial_dismissal": return `御史弹劾，请免${official}之职`;
  }
}

/** 升迁/降职目标是否当前仍有空席（实时）。 */
function targetVacant(db: ContentDB, state: GameState, d: PersonnelDecision): boolean {
  return d.recommendedPostId !== undefined && isPostVacant(state, db, d.recommendedPostId);
}

/** 各 kind 的裁断选项（含可用性与「行政/惩戒」标签）。 */
function optionsFor(db: ContentDB, state: GameState, d: PersonnelDecision): DecisionOptionView[] {
  const hasTarget = d.recommendedPostId !== undefined;
  const vacant = targetVacant(db, state, d);
  const promoteDisabled = !hasTarget || !vacant;
  const promoteReason = !hasTarget ? "无合适更高空缺官职" : !vacant ? "目标官职已无空席" : undefined;
  const demoteDisabled = !hasTarget || !vacant;
  const demoteReason = !hasTarget ? "无合适较低空缺官职" : !vacant ? "目标官职已无空席" : undefined;

  switch (d.kind) {
    case "consort_petition_promotion":
      return [
        { resolution: "approve", label: "准其所请·擢拔", tone: "administrative", disabled: promoteDisabled, ...(promoteReason ? { disabledReason: promoteReason } : {}), note: ADMINISTRATIVE_NOTE },
        { resolution: "reject", label: "回绝", tone: "neutral", disabled: false },
      ];
    case "memorial_promotion":
      return [
        { resolution: "approve", label: "准奏·升迁", tone: "administrative", disabled: promoteDisabled, ...(promoteReason ? { disabledReason: promoteReason } : {}), note: ADMINISTRATIVE_NOTE },
        { resolution: "reject", label: "驳回", tone: "neutral", disabled: false },
      ];
    case "family_implication":
      return [
        { resolution: "spare", label: "罪止其身·不牵连", tone: "neutral", disabled: false },
        { resolution: "demote", label: "牵连·降职", tone: "punishment", disabled: demoteDisabled, ...(demoteReason ? { disabledReason: demoteReason } : {}), note: PUNISHMENT_NOTE },
        { resolution: "dismiss", label: "牵连·免官", tone: "punishment", disabled: false, note: PUNISHMENT_NOTE },
      ];
    case "memorial_demotion":
      return [
        { resolution: "approve", label: "准奏·降职", tone: "punishment", disabled: demoteDisabled, ...(demoteReason ? { disabledReason: demoteReason } : {}), note: PUNISHMENT_NOTE },
        { resolution: "reject", label: "驳回", tone: "neutral", disabled: false },
      ];
    case "memorial_dismissal":
      return [
        { resolution: "approve", label: "准奏·免官", tone: "punishment", disabled: false, note: PUNISHMENT_NOTE },
        { resolution: "reject", label: "驳回弹劾", tone: "neutral", disabled: false },
      ];
  }
}

/** 把一条决策解析为完整决策卡（含选项）。 */
export function personnelDecisionCard(db: ContentDB, state: GameState, d: PersonnelDecision): PersonnelDecisionCard {
  const off = state.officials[d.officialId];
  const officialName = off ? `${off.surname}${off.givenName}` : d.officialId;
  const consort = d.consortId ? consortName(db, state, d.consortId) : undefined;
  const fam = d.familyId ? state.officialFamilies[d.familyId] : undefined;
  const currentPostId = off?.postId ?? d.fromPostId ?? null;
  const fitPost = off?.postId ? db.officialPosts[off.postId] : undefined;

  return {
    id: d.id,
    kind: d.kind,
    kindLabel: DECISION_KIND_LABEL[d.kind],
    source: sourceText(d, consort, officialName),
    ...(consort ? { consortName: consort } : {}),
    officialName,
    ...(fam ? { familyName: `${fam.surname}氏` } : {}),
    currentPostLabel: postLabel(db, currentPostId) ?? "无职",
    ...(postLabel(db, d.recommendedPostId) ? { recommendedPostLabel: postLabel(db, d.recommendedPostId)! } : {}),
    ...(off ? { merit: off.reviewState.merit } : {}),
    ...(off && fitPost ? { aptitudeFit: candidatePostFit(off, fitPost) } : {}),
    options: optionsFor(db, state, d),
  };
}
