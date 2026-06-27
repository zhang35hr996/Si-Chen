/**
 * 御花园探索总览（scene-ui-narrative-refactor §8 / PR3 Task 3.4）。御花园不再是普通地点人物卡页，
 * 而是四个真实子地点（绛雪轩/太液池/浮碧亭/堆秀山）的总览：每个子地点显示静态环境描述，可进入/返回。
 *
 * 单一权威：园中在场人物一律以 presentAt(御花园) 为唯一来源（presentBar / focusedCharacter 由 App 以
 * 物理在场算好喂入），绝不拼接住处花名册。进入具体子地点后，再按角色 id 将园中人物稳定地分配到唯一
 * 子地点；同一人不会在多个子地点重复出现，同一子地点可以有多人。子地点动态线索仅在存在符合条件的
 * exploration 事件时显示（非剧透 eventHint），无事件只显普通环境，不虚构「有人影」。
 *
 * 纯展示 + 回调：组件不读/改 store、不查事件。SceneShell 由本屏注入；GameShell（顶栏/孕月/国情）由 App 外层提供。
 */
import { gardenSubLocationForCharacter } from "../../engine/map/subLocations";
import { SceneShell } from "../components/SceneShell";
import { SceneCharacterBar, type SceneCharacterBarItem } from "../components/SceneCharacterBar";
import { SceneFocusedCharacter } from "../components/SceneFocusedCharacter";
import type { FocusedCharacterView } from "../sceneView";

export interface GardenSubAreaView {
  id: string;
  name: string;
  /** 静态环境描述（永久成立，无人物/事件暗示）。 */
  description: string;
  background: string;
  isFallbackBackground?: boolean;
  backgroundPosition?: string;
  /** 此刻该子地点是否有可探索事件（true 才显示 eventHint，不剧透身份/结果）。 */
  hasEvent: boolean;
  eventHint?: string;
  /** 事件是否可承担（行动力）；false 时进入显「行动力不足」而非「普通游览」。 */
  eventAffordable?: boolean;
  /** 事件存在但不可承担时的真实原因。 */
  eventReason?: string;
}

export interface GardenOverviewScreenProps {
  background: string;
  isFallbackBackground?: boolean;
  backgroundPosition?: string;
  subAreas: GardenSubAreaView[];
  /** 非空 = 已进入某子地点（普通游览：背景 + 静态描述 + 返回总览）；null/缺省 = 总览。 */
  activeSubArea?: GardenSubAreaView | null;
  /** 园中此刻在场人物（presentAt 唯一来源）；子地点内由本组件筛成唯一归属。 */
  presentBar: SceneCharacterBarItem[];
  selectedId?: string | null;
  focusedCharacter?: FocusedCharacterView;
  onSelectCharacter: (id: string) => void;
  onEnterSubArea: (subId: string) => void;
  onExitSubArea: () => void;
  onBack: () => void;
  onConverse?: (id: string) => void;
  onBedchamber?: (id: string) => void;
  onViewProfile: (id: string) => void;
  onManage?: (id: string) => void;
  onRelocate?: (id: string) => void;
  onHaremAdminManage?: (actorId: string) => void;
}

export function GardenOverviewScreen(props: GardenOverviewScreenProps) {
  const { activeSubArea } = props;
  const subLocationIds = props.subAreas.map((area) => area.id);
  const visiblePresentBar = activeSubArea
    ? props.presentBar.filter(
        (character) => gardenSubLocationForCharacter(character.id, subLocationIds) === activeSubArea.id,
      )
    : props.presentBar;
  const visibleIds = new Set(visiblePresentBar.map((character) => character.id));
  const visibleSelectedId = props.selectedId && visibleIds.has(props.selectedId) ? props.selectedId : null;
  const visibleFocusedCharacter =
    props.focusedCharacter && visibleIds.has(props.focusedCharacter.id) ? props.focusedCharacter : undefined;

  // 总览显示全部园中人物；进入子地点后只显示稳定分配到该处的人物。
  const presence = (ariaLabel: string) =>
    visiblePresentBar.length > 0 ? (
      <SceneCharacterBar
        characters={visiblePresentBar}
        selectedId={visibleSelectedId}
        onFocus={props.onSelectCharacter}
        ariaLabel={ariaLabel}
      />
    ) : null;
  const focusPanel = visibleFocusedCharacter ? (
    <SceneFocusedCharacter
      view={visibleFocusedCharacter}
      onConverse={props.onConverse}
      onBedchamber={props.onBedchamber}
      onViewProfile={props.onViewProfile}
      onManage={props.onManage}
      onRelocate={props.onRelocate}
    />
  ) : null;

  if (activeSubArea) {
    return (
      <SceneShell
        background={activeSubArea.background}
        isFallback={activeSubArea.isFallbackBackground}
        backgroundPosition={activeSubArea.backgroundPosition}
        ariaLabel={`御花园 · ${activeSubArea.name}`}
        stage={
          <div className="garden-subarea">
            <h1 className="garden-subarea__name">{activeSubArea.name}</h1>
            <p className="garden-subarea__desc">{activeSubArea.description}</p>
            {/* 有事件但行动力不足：明确告知（非伪装成普通游览）。 */}
            {activeSubArea.hasEvent && activeSubArea.eventAffordable === false && activeSubArea.eventReason && (
              <p className="garden-subarea__reason" role="note">{activeSubArea.eventReason}</p>
            )}
            {presence(`${activeSubArea.name}之人`)}
          </div>
        }
        narrative={focusPanel}
        actions={
          <button type="button" className="action-btn" onClick={props.onExitSubArea}>
            返回御花园
          </button>
        }
      />
    );
  }

  return (
    <SceneShell
      background={props.background}
      isFallback={props.isFallbackBackground}
      backgroundPosition={props.backgroundPosition}
      ariaLabel="御花园"
      stage={
        <div className="garden-overview">
          <h1 className="garden-overview__name">御花园</h1>
          {presence("园中之人")}
          <ul className="garden-overview__areas">
            {props.subAreas.map((sa) => (
              <li key={sa.id} className="garden-overview__area">
                <button type="button" className="garden-area-card" onClick={() => props.onEnterSubArea(sa.id)}>
                  <span className="garden-area-card__name">{sa.name}</span>
                  <span className="garden-area-card__desc">{sa.description}</span>
                  {sa.hasEvent && sa.eventHint && (
                    <span className="garden-area-card__hint">{sa.eventHint}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
      narrative={focusPanel}
      actions={
        <button type="button" className="action-btn" onClick={props.onBack}>
          离开御花园
        </button>
      }
    />
  );
}
