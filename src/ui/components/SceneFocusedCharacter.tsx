/**
 * 聚焦在场人物（scene-ui-narrative-refactor §5.3 / PR3）。选中场景人物条某人后，
 * 主体显示其立绘 + 姓名 + 位分/身份 + 当前允许的交互入口（叙话/查看详情/位分/搬迁/侍寝）。
 *
 * 纯展示 + 回调：组件不读/改 store、不查事件、不算 ap、不复制完整属性 grid（详情走既有 drawer）。
 * 交互可用性由调用方按既有业务门槛（actionable / unavailableReason）决定，UI 不另造规则。
 */
import { useState } from "react";
import type { FocusedCharacterView } from "../sceneView";

export interface SceneFocusedCharacterProps {
  view: FocusedCharacterView;
  background?: string;
  onConverse?: (id: string) => void;
  onBedchamber?: (id: string) => void;
  onViewProfile: (id: string) => void;
  onManage?: (id: string) => void;
  onRelocate?: (id: string) => void;
}

export function SceneFocusedCharacter({
  view,
  background,
  onConverse,
  onBedchamber,
  onViewProfile,
  onManage,
  onRelocate,
}: SceneFocusedCharacterProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = (onManage || onRelocate) && view.id !== "shen_zhibai";

  return (
    <section className="scene-focus" aria-label={`${view.name} · ${view.role}`}>
      <div
        className="scene-focus__sprite-wrap"
        style={background ? { backgroundImage: `url("${background}")` } : undefined}
      >
        {view.portraitSrc && (
          <img className="scene-focus__sprite" src={view.portraitSrc} alt={view.name} />
        )}
      </div>
      <div className="scene-focus__panel">
        <div className="scene-focus__nameplate">
          <span className="scene-focus__name">{view.name}</span>
          {view.role && <span className="scene-focus__role">{view.role}</span>}
        </div>
        <div className="action-dock">
          <div className="action-dock__primary">
            {view.isConsort && onConverse && view.actionable && (
              <button type="button" className="action-btn" onClick={() => onConverse(view.id)}>
                叙话
              </button>
            )}
            <button type="button" className="action-btn" onClick={() => onViewProfile(view.id)}>
              查看详情
            </button>
            {showMore && (
              <div className="action-more">
                <button
                  type="button"
                  className="action-btn"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  更多 ▾
                </button>
                {moreOpen && (
                  <div className="action-more__menu">
                    {onManage && (
                      <button type="button" onClick={() => { setMoreOpen(false); onManage(view.id); }}>
                        管理位分 / 封号
                      </button>
                    )}
                    {onRelocate && (
                      <button type="button" onClick={() => { setMoreOpen(false); onRelocate(view.id); }}>
                        安排迁居
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="action-dock__highlight">
            {view.isConsort && onBedchamber && view.actionable && (
              <button type="button" className="action-btn action-btn--key" onClick={() => onBedchamber(view.id)}>
                侍寝
              </button>
            )}
          </div>
        </div>
        {view.isConsort && !view.actionable && view.unavailableReason && (
          <p className="scene-focus__reason" role="note">{view.unavailableReason}</p>
        )}
      </div>
    </section>
  );
}
