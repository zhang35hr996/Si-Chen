/**
 * 御花园探索总览（scene-ui-narrative-refactor §8 / PR3 Task 3.4）。御花园不再是普通地点人物卡页，
 * 而是四个真实子地点（绛雪轩/太液池/浮碧亭/堆秀山）的总览：每个子地点显示静态环境描述，可进入/返回。
 *
 * 单一权威：园中在场人物一律以 presentAt(御花园) 为唯一来源（presentBar / focusedCharacter 由 App 以
 * 物理在场算好喂入），绝不拼接住处花名册。子地点动态线索仅在存在符合条件的 exploration 事件时显示
 * （非剧透 eventHint），无事件只显普通环境，不虚构「有人影」。
 *
 * 纯展示 + 回调：组件不读/改 store、不查事件。SceneShell 由本屏注入；GameShell（顶栏/孕月/国情）由 App 外层提供。
 */
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
  /** 事件是否可承担（行动力）；false 时进入显「行动力不足」而非普通游览。 */
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
  /** 园中此刻在场人物（presentAt 唯一来源）。 */
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

  // 园中在场人物（presentAt 唯一来源）在总览与子地点皆可交互——人物在「御花园」而非具体子地点，
  // 故进入子地点后仍可与园中之人叙话（无事件≠无人）。聚焦立绘随选中呈现。
  const presence = (ariaLabel: string) =>
    props.presentBar.length > 0 ? (
      <SceneCharacterBar
        characters={props.presentBar}
        selectedId={props.selectedId}
        onFocus={props.onSelectCharacter}
        ariaLabel={ariaLabel}
      />
    ) : null;
  const focusPanel = props.focusedCharacter ? (
    <SceneFocusedCharacter
      view={props.focusedCharacter}
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
            {presence("园中之人")}
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
