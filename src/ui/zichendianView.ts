/**
 * 紫宸殿 App 接线的纯决策层（scene-ui-narrative-refactor Task 2.4b）。
 *
 * 仓库惯例：无 <App> 渲染测试基座，App 依赖的判断一律抽成纯函数在此单测（见 tests/ui/autoRouting.test.ts 说明）。
 * 本模块把「候见队列 → 视图模型映射」「主动提示选取」「提交后清账判定」「外部 busy 归属」收敛为纯函数，
 * App.tsx 只做装配与回调派发，不在组件里查 DB / 读 flags / 算 ap。
 */
import type { AssetRegistry } from "../engine/assets/registry";
import type { ContentDB } from "../engine/content/loader";
import type { GameEventContent } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import type { AudienceItem } from "../engine/events/audience";
import type { PendingAudienceViewItem } from "./components/PendingAudienceDrawer";
import type { ZichendianAudienceView, ZichendianSummonedView } from "./screens/ZichendianScreen";

/** 主动候见提示：队列内首个 status∈{available,pending}（队列已按 priority/id 确定性排序）；suppressed 永不主动弹。 */
export function selectActiveAudience(queue: readonly AudienceItem[]): AudienceItem | undefined {
  return queue.find((i) => i.status === "available" || i.status === "pending");
}

/** 不可承担时的确定性原因，基于事件真实 apCost（不另造资格规则）。 */
function affordReason(item: AudienceItem): string | undefined {
  return item.affordable ? undefined : `行动力不足（需 ${item.event.apCost} 行动点）`;
}

/** 候见者头衔：有册封/位分则用「封号+位分名」，否则退回官职 role（officials 无位分）。 */
function resolveVisitorTitle(db: ContentDB, state: GameState, characterId: string): string | undefined {
  const character = db.characters[characterId];
  const st = state.standing[characterId];
  if (st) {
    const rank = db.ranks[st.rank];
    if (rank) return st.title ? `${st.title}${rank.name}` : rank.name;
  }
  return character?.profile.role;
}

function visitorName(db: ContentDB, characterId: string): string {
  return db.characters[characterId]?.profile.name ?? characterId;
}

function neutralPortrait(db: ContentDB, registry: AssetRegistry, characterId: string): string | undefined {
  const character = db.characters[characterId];
  return character ? registry.portrait(character.portraitSet, "neutral").url : undefined;
}

/** AudienceItem → 候见提示视图模型（AudiencePrompt 消费）。组件不再读 DB。 */
export function audienceItemToView(
  db: ContentDB,
  state: GameState,
  registry: AssetRegistry,
  item: AudienceItem,
): ZichendianAudienceView {
  const charId = item.presentation.audienceCharacterId;
  return {
    eventId: item.event.id,
    visitorName: visitorName(db, charId),
    visitorTitle: resolveVisitorTitle(db, state, charId),
    message: item.presentation.audiencePrompt,
    portraitSrc: neutralPortrait(db, registry, charId),
    affordable: item.affordable,
    disabledReason: affordReason(item),
  };
}

/** AudienceItem → 待宣抽屉项（PendingAudienceDrawer 消费）。deferredLabel 暂省略（无既有日历格式器则不臆造）。 */
export function audienceItemToPendingView(
  db: ContentDB,
  state: GameState,
  registry: AssetRegistry,
  item: AudienceItem,
): PendingAudienceViewItem {
  const charId = item.presentation.audienceCharacterId;
  return {
    eventId: item.event.id,
    visitorName: visitorName(db, charId),
    visitorTitle: resolveVisitorTitle(db, state, charId),
    message: item.presentation.audiencePrompt,
    portraitSrc: neutralPortrait(db, registry, charId),
    status: item.status === "pending" ? "pending" : "suppressed",
    affordable: item.affordable,
    disabledReason: affordReason(item),
  };
}

/** 被召见侍君 → 临场呈现视图模型（立绘+名+位分），非人物卡。 */
export function summonedConsortToView(
  db: ContentDB,
  state: GameState,
  registry: AssetRegistry,
  characterId: string,
): ZichendianSummonedView | undefined {
  // Consorts are procedurally generated into state.generatedConsorts.
  const character = db.characters[characterId] ?? state.generatedConsorts[characterId];
  if (!character) return undefined;
  return {
    characterId,
    name: character.profile.name,
    role: resolveVisitorTitle(db, state, characterId),
    portraitSrc: registry.portrait(character.portraitSet, "neutral").url,
  };
}

/**
 * 提交完成后是否清候见账：仅当事件已提交、且该事件是「本 host 的 request_audience」。
 * 弃场 / 非本 host / 非候见 / 仅打开未提交 → 不清。绝不在此重建导航目标。
 */
export function shouldClearAudienceOnCommit(
  event: GameEventContent | undefined,
  committed: boolean,
  hostLocationId: string,
): boolean {
  if (!committed || !event) return false;
  const p = event.presentation;
  return p?.mode === "request_audience" && p.hostLocationId === hostLocationId;
}

/**
 * 紫宸殿外部 busy 归属：任一外部前景/原子流程进行中即视为本屏已被接管。
 * `atomicFlowInProgress` 直接复用 App 既有权威计算（含 activeEventId/rankAdmin/reaction/prompt/giftItemId/
 * dialogueInFlight 等），此处只补 atomicFlow 之外、紫宸殿仍可触达的浮层/选择器/全局中断。
 */
export interface ZichendianBusyInputs {
  atomicFlowInProgress: boolean;
  /**
   * 转旬后待结算（pendingTimeSettlement!==null）。**刻意独立于 atomicFlowInProgress**：结算 effect 正是
   * 在 atomicFlowInProgress===false 时才排空，把它并入 atomicFlow 会自锁死结算。故只在紫宸殿 busy 这一侧计入，
   * 防止「转旬→结算→全局中断→time_advance→最终恢复」之间候见提示/动作坞回插。
   */
  settlementPending: boolean;
  relocateOpen: boolean;
  consortPickerOpen: boolean;
  consortListOpen: boolean;
  physicianOpen: boolean;
  physicianPickerOpen: boolean;
  heirListOpen: boolean;
  resourcePanelOpen: boolean;
  storehouseOpen: boolean;
  profileOpen: boolean;
  settingsOpen: boolean;
  choicePending: boolean;
  globalInterruptActive: boolean;
}

export function zichendianExternalBusy(i: ZichendianBusyInputs): boolean {
  return (
    i.atomicFlowInProgress ||
    i.settlementPending ||
    i.relocateOpen ||
    i.consortPickerOpen ||
    i.consortListOpen ||
    i.physicianOpen ||
    i.physicianPickerOpen ||
    i.heirListOpen ||
    i.resourcePanelOpen ||
    i.storehouseOpen ||
    i.profileOpen ||
    i.settingsOpen ||
    i.choicePending ||
    i.globalInterruptActive
  );
}
