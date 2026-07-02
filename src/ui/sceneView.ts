/**
 * 场景人物呈现的纯决策层（scene-ui-narrative-refactor PR3）。
 *
 * 仓库惯例（见 zichendianView.ts）：App 依赖的判断抽成纯函数单测，组件只装配。
 * 本模块把「此刻在场人物 → 人物条/聚焦视图模型」「选中态调和」收敛为纯函数。
 *
 * 单一权威：可见人物一律以 presentAt（物理在场）为唯一来源，绝不用 getPresentAt（住处花名册）
 * 填充在场。住处花名册仅用于寝殿宫室归属 + 外出禀报（CharacterScene 内）。
 */
import type { AssetRegistry } from "../engine/assets/registry";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import { presentAt } from "../engine/characters/presence";
import { isEmpress } from "../engine/characters/empress";
import { canSummon } from "../store/bedchamber";
import type { SceneCharacterBarItem } from "./components/SceneCharacterBar";

/** 人物显示身份：侍君用「封号+位分名」或位分名；其余（官员等）用 profile.role。 */
export function displayRole(db: ContentDB, state: GameState, charId: string): string {
  const st = state.standing[charId];
  if (st) {
    const rank = db.ranks[st.rank];
    if (rank) return st.title ? `${st.title}${rank.name}` : rank.name;
  }
  return db.characters[charId]?.profile.role ?? "";
}

/** 此刻物理在场人物 → 人物条项（presentAt 唯一来源；不含住处花名册的外出住客）。 */
export function presentBarItems(db: ContentDB, state: GameState, locationId: string): SceneCharacterBarItem[] {
  return presentAt(db, state, locationId).map((c) => ({
    id: c.id,
    name: c.profile.name,
    role: displayRole(db, state, c.id),
  }));
}

export interface FocusedCharacterView {
  id: string;
  name: string;
  role: string;
  portraitSrc?: string;
  isConsort: boolean;
  isEmpress: boolean;
  /** 叙话/侍寝是否可用（与人物卡同门槛：有行动点且本旬可侍寝；仅侍君）。 */
  actionable: boolean;
  /** 不可用时的真实原因（沿用既有门槛，不另造）。 */
  unavailableReason?: string;
}

/** 聚焦在场人物 → 立绘交互视图模型（组件不读 DB / 不算 ap）。 */
export function focusedCharacterView(
  db: ContentDB,
  state: GameState,
  registry: AssetRegistry,
  charId: string,
): FocusedCharacterView | undefined {
  // Consorts are procedurally generated into state.generatedConsorts.
  const character = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!character) return undefined;
  const isConsort = character.kind === "consort";
  const hasAp = state.calendar.ap >= 1;
  const summonable = canSummon(state, charId);
  const actionable = isConsort && hasAp && summonable;
  const unavailableReason = !isConsort
    ? undefined
    : !hasAp
      ? "今旬行动力已尽。"
      : !summonable
        ? "她此刻不便承欢。"
        : undefined;
  return {
    id: charId,
    name: character.profile.name,
    role: displayRole(db, state, charId),
    portraitSrc: registry.portrait(character.portraitSet, "neutral").url,
    isConsort,
    isEmpress: isEmpress(state, charId),
    actionable,
    unavailableReason,
  };
}

/**
 * 选中态调和（纯决策）：在场人物列表变化后，当前选中须自我调和——
 *  - 当前选中仍在场 → 保持；
 *  - 不在场 → 取下一个真实在场人物（列表首位）；
 *  - 无人在场 → 清空（null）。
 * 绝不保留 stale charId。
 */
export function reconcileSelection(presentIds: readonly string[], selectedId: string | null | undefined): string | null {
  if (presentIds.length === 0) return null;
  if (selectedId && presentIds.includes(selectedId)) return selectedId;
  return presentIds[0]!;
}
