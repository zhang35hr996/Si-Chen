/**
 * 紫宸殿场景屏（scene-ui-narrative-refactor §6 / Task 2.4）。把候见 / 召见 / 乘风落到本殿专用屏，移除人物卡。
 *
 * 纯展示屏：只消费已解析好的展示数据与回调，不查 store / ContentDB / 事件资格 / 候见标志 / 人物档案 / 导航。
 * 业务（批阅、召见、册封、搬迁、赏赐、传太医、宣见、结算）全部由父层在回调里负责。
 *
 * 单一前景 surface 状态机：pending-audience / chengfeng / none + activeAudience 三者互斥渲染，**至多一个**
 * role="dialog" landmark。三种前景组件都各自持有 document-level Escape；因此非活跃 surface 必须卸载（而非视觉隐藏），
 * 否则一次 Escape 会被多个组件处理。乘风谕令为业务交接：先关菜单，再在同一交互内发出对应回调（原子切换）。
 */
import { useEffect, useId, useState } from "react";
import { SceneShell } from "../components/SceneShell";
import { AudiencePrompt } from "../components/AudiencePrompt";
import { PendingAudienceDrawer, type PendingAudienceViewItem } from "../components/PendingAudienceDrawer";
import { ChengfengDispatch } from "../components/ChengfengDispatch";

export interface ZichendianAudienceView {
  eventId: string;
  visitorName: string;
  visitorTitle?: string;
  message: string;
  portraitSrc?: string;
  affordable: boolean;
  disabledReason?: string;
}

export interface ZichendianSummonedView {
  characterId: string;
  name: string;
  role?: string;
  portraitSrc?: string;
}

export interface ZichendianScreenProps {
  background: string;
  backgroundPosition?: string;
  isFallbackBackground?: boolean;

  audienceCount: number;
  deferredAudienceCount: number;
  activeAudience?: ZichendianAudienceView;
  pendingAudienceItems: readonly PendingAudienceViewItem[];

  summonedConsort?: ZichendianSummonedView;
  /** 被召见侍君的「叙话」入口（普通互动路径，可选）。 */
  onConverseSummonedConsort?: () => void;
  /** 叙话不可用原因（如行动力不足）；提供时叙话按钮禁用并显原因，杜绝「可点却静默无效」。 */
  summonedConverseDisabledReason?: string;
  /** 被召见侍君的「告退」结束入口（可选；提供时渲染告退按钮，由父层清 summoned 态）。 */
  onDismissSummonedConsort?: () => void;

  /** 当前场景是否可被打断而传乘风；false → 传乘风入口禁用并显 interruptDisabledReason。透传给乘风，不在屏内重算。 */
  interruptible: boolean;
  interruptDisabledReason?: string;
  /** 外部交互进行中：禁用会开启新交互的屏级动作。 */
  busy?: boolean;

  onAdmitAudience: (eventId: string) => void;
  onDeferAudience: (eventId: string) => void;
  onAdmitPendingAudience: (eventId: string) => void;

  onReviewMemorials: () => void;
  /** 人事奏折与请托裁决入口（PR3C-3b）；提供时渲染入口，badge 显待裁数。 */
  onReviewPersonnel?: () => void;
  /** 待裁人事决策数（badge）。 */
  personnelDecisionCount?: number;
  onSummonConsort: () => void;
  onRest: () => void;
  onLeave: () => void;

  onManageRank: () => void;
  onRelocate: () => void;
  onBestow: () => void;
  onPhysician: () => void;
  onTransferHaremAdministration?: () => void;
}

/** 单一前景 surface 判别联合：至多一个前景对话存在。 */
type ZichendianForeground =
  | { kind: "none" }
  | { kind: "pending-audience" }
  | { kind: "chengfeng" };

export function ZichendianScreen({
  background,
  backgroundPosition,
  isFallbackBackground,
  audienceCount,
  deferredAudienceCount,
  activeAudience,
  pendingAudienceItems,
  summonedConsort,
  onConverseSummonedConsort,
  summonedConverseDisabledReason,
  onDismissSummonedConsort,
  interruptible,
  interruptDisabledReason,
  busy = false,
  onAdmitAudience,
  onDeferAudience,
  onAdmitPendingAudience,
  onReviewMemorials,
  onReviewPersonnel,
  personnelDecisionCount = 0,
  onSummonConsort,
  onRest,
  onLeave,
  onManageRank,
  onRelocate,
  onBestow,
  onPhysician,
  onTransferHaremAdministration,
}: ZichendianScreenProps) {
  const [foreground, setForeground] = useState<ZichendianForeground>({ kind: "none" });
  const reasonId = useId();

  // 召见侍君临场也是一次独占会话：侍君在前，候见提示/抽屉/乘风及六个常规动作一律让位，仅留叙话/告退收场。
  const summonedSessionActive = summonedConsort !== undefined;

  // busy（外部业务面板）或召见会话进行中：屏内不得再持有任何前景对话。立即用渲染门控（见下），
  // 并在二者任一接管时重置陈旧的本地前景，避免「旧内部对话 + 新外部模态/召见临场」同帧并存。
  const internalSurfacesAllowed = !busy && !summonedSessionActive;
  useEffect(() => {
    if (busy || summonedSessionActive) setForeground({ kind: "none" });
  }, [busy, summonedSessionActive]);

  // 六个常规场景动作：busy / 内部前景 / 召见会话 任一进行中即禁用，由当前会话独占。
  const internalForegroundOpen = foreground.kind !== "none";
  const sceneActionsLocked = busy || internalForegroundOpen || summonedSessionActive;
  // 叙话/告退：不含 summonedSessionActive——它们正是结束召见会话的唯一控件，不可被召见态自锁。
  const summonedActionsLocked = busy || internalForegroundOpen;

  // 前景切换：开启 surface 仅可从 none 出发（守住单一前景不变量）；关闭一律回 none。
  const openPending = () => setForeground((f) => (f.kind === "none" ? { kind: "pending-audience" } : f));
  const openChengfeng = () => setForeground((f) => (f.kind === "none" ? { kind: "chengfeng" } : f));
  const closeForeground = () => setForeground({ kind: "none" });

  // 乘风谕令为业务交接：先关菜单，再在同一交互内发出对应回调（原子切换，便于父层接着开下一个业务面板）。
  const handoff = (callback: () => void) => {
    setForeground({ kind: "none" });
    callback();
  };
  // 抽屉宣见：先离开抽屉前景，再恰好一次发出宣见回调。
  const admitPending = (eventId: string) => {
    setForeground({ kind: "none" });
    onAdmitPendingAudience(eventId);
  };

  const showInterruptReason = !interruptible && Boolean(interruptDisabledReason);

  const stage = (
    <div className="zichendian-summary">
      {summonedConsort && (
        <div className="zichendian-summoned">
          {summonedConsort.portraitSrc && (
            <img className="zichendian-summoned__portrait" src={summonedConsort.portraitSrc} alt={summonedConsort.name} />
          )}
          <div className="zichendian-summoned__caption">
          <p className="zichendian-summoned__who">
            <span className="zichendian-summoned__name">{summonedConsort.name}</span>
            {summonedConsort.role && <span className="zichendian-summoned__role">{summonedConsort.role}</span>}
          </p>
          {(onConverseSummonedConsort || onDismissSummonedConsort) && (
            <div className="zichendian-summoned__actions">
              {onConverseSummonedConsort && (
                <button
                  type="button"
                  className="action-btn"
                  onClick={onConverseSummonedConsort}
                  disabled={summonedActionsLocked || Boolean(summonedConverseDisabledReason)}
                  title={summonedConverseDisabledReason}
                >
                  叙话
                </button>
              )}
              {onDismissSummonedConsort && (
                <button type="button" className="action-btn" onClick={onDismissSummonedConsort} disabled={summonedActionsLocked}>
                  告退
                </button>
              )}
              {summonedConverseDisabledReason && (
                <span className="zichendian-summoned__reason" role="note">{summonedConverseDisabledReason}</span>
              )}
            </div>
          )}
          </div>
        </div>
      )}
      <p className="zichendian-summary__line">候见之人 {audienceCount}</p>
      <p className="zichendian-summary__line zichendian-summary__line--muted">可批阅奏折</p>
    </div>
  );

  // narrative 槽仅在 !busy（外部未接管）、无内部前景对话、且仍有 activeAudience 时渲染候见提示——
  // 开抽屉/乘风或外部 busy 接管时立即卸载它。
  const narrative =
    internalSurfacesAllowed && foreground.kind === "none" && activeAudience ? (
      <AudiencePrompt
        promptId={activeAudience.eventId}
        visitorName={activeAudience.visitorName}
        visitorTitle={activeAudience.visitorTitle}
        message={activeAudience.message}
        portraitSrc={activeAudience.portraitSrc}
        affordable={activeAudience.affordable}
        disabledReason={activeAudience.disabledReason}
        busy={busy}
        onAdmit={() => onAdmitAudience(activeAudience.eventId)}
        onDefer={() => onDeferAudience(activeAudience.eventId)}
      />
    ) : undefined;

  const actions = (
    <>
      <button type="button" className="action-btn action-btn--key" onClick={onReviewMemorials} disabled={sceneActionsLocked}>
        批阅奏折
      </button>
      {onReviewPersonnel && (
        <button type="button" className="action-btn" onClick={onReviewPersonnel} disabled={sceneActionsLocked}>
          人事奏折{personnelDecisionCount > 0 ? ` · ${personnelDecisionCount}` : ""}
        </button>
      )}
      <button type="button" className="action-btn" onClick={onSummonConsort} disabled={sceneActionsLocked}>
        召见侍君
      </button>
      <button
        type="button"
        className="action-btn"
        onClick={openChengfeng}
        disabled={sceneActionsLocked || !interruptible}
        aria-describedby={showInterruptReason ? reasonId : undefined}
      >
        传乘风
      </button>
      <button type="button" className="action-btn" onClick={onRest} disabled={sceneActionsLocked}>
        休息
      </button>
      <button type="button" className="action-btn" onClick={onLeave} disabled={sceneActionsLocked}>
        离开
      </button>
      <button type="button" className="action-btn" onClick={openPending} disabled={sceneActionsLocked}>
        待宣 · {deferredAudienceCount}
      </button>
      {showInterruptReason && (
        <span id={reasonId} role="note" className="zichendian-actions__reason">
          {interruptDisabledReason}
        </span>
      )}
    </>
  );

  return (
    <>
      <SceneShell
        background={background}
        backgroundPosition={backgroundPosition}
        isFallback={isFallbackBackground}
        ariaLabel="紫宸殿"
        stage={stage}
        narrative={narrative}
        actions={actions}
      />
      {internalSurfacesAllowed && foreground.kind === "pending-audience" && (
        <PendingAudienceDrawer
          items={pendingAudienceItems}
          busy={busy}
          onAdmit={admitPending}
          onClose={closeForeground}
        />
      )}
      {internalSurfacesAllowed && foreground.kind === "chengfeng" && (
        <ChengfengDispatch
          interruptible={interruptible}
          disabledReason={interruptDisabledReason}
          onSummonConsort={() => handoff(onSummonConsort)}
          onManageRank={() => handoff(onManageRank)}
          onRelocate={() => handoff(onRelocate)}
          onBestow={() => handoff(onBestow)}
          onPhysician={() => handoff(onPhysician)}
          onTransferHaremAdministration={onTransferHaremAdministration ? () => handoff(onTransferHaremAdministration) : undefined}
          onClose={closeForeground}
        />
      )}
    </>
  );
}
