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

  /** 当前场景是否可被打断而传乘风；false → 传乘风入口禁用并显 interruptDisabledReason。透传给乘风，不在屏内重算。 */
  interruptible: boolean;
  interruptDisabledReason?: string;
  /** 外部交互进行中：禁用会开启新交互的屏级动作。 */
  busy?: boolean;

  onAdmitAudience: (eventId: string) => void;
  onDeferAudience: (eventId: string) => void;
  onAdmitPendingAudience: (eventId: string) => void;

  onReviewMemorials: () => void;
  onSummonConsort: () => void;
  onRest: () => void;
  onLeave: () => void;

  onManageRank: () => void;
  onRelocate: () => void;
  onBestow: () => void;
  onPhysician: () => void;
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
  interruptible,
  interruptDisabledReason,
  busy = false,
  onAdmitAudience,
  onDeferAudience,
  onAdmitPendingAudience,
  onReviewMemorials,
  onSummonConsort,
  onRest,
  onLeave,
  onManageRank,
  onRelocate,
  onBestow,
  onPhysician,
}: ZichendianScreenProps) {
  const [foreground, setForeground] = useState<ZichendianForeground>({ kind: "none" });
  const reasonId = useId();

  // busy = 外部业务面板（册封/搬迁/赏赐/请医/召见/批阅/事件/原子操作）已接管前景。屏内不得再持有任何前景对话：
  // 立即用 !busy 渲染门控（见下），并在 busy 起始时重置陈旧的本地前景，避免「旧内部对话 + 新外部模态」同帧并存。
  const internalSurfacesAllowed = !busy;
  useEffect(() => {
    if (busy) setForeground({ kind: "none" });
  }, [busy]);

  // 任一内部前景打开即视为本屏正进行一次交互会话——背景场景动作（含离开）一律禁用，由前景独占；busy 同理。
  const internalForegroundOpen = foreground.kind !== "none";
  const screenActionsLocked = busy || internalForegroundOpen;

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
          <p className="zichendian-summoned__who">
            <span className="zichendian-summoned__name">{summonedConsort.name}</span>
            {summonedConsort.role && <span className="zichendian-summoned__role">{summonedConsort.role}</span>}
          </p>
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
      <button type="button" className="action-btn action-btn--key" onClick={onReviewMemorials} disabled={screenActionsLocked}>
        批阅奏折
      </button>
      <button type="button" className="action-btn" onClick={onSummonConsort} disabled={screenActionsLocked}>
        召见侍君
      </button>
      <button
        type="button"
        className="action-btn"
        onClick={openChengfeng}
        disabled={screenActionsLocked || !interruptible}
        aria-describedby={showInterruptReason ? reasonId : undefined}
      >
        传乘风
      </button>
      <button type="button" className="action-btn" onClick={onRest} disabled={screenActionsLocked}>
        休息
      </button>
      <button type="button" className="action-btn" onClick={onLeave} disabled={screenActionsLocked}>
        离开
      </button>
      <button type="button" className="action-btn" onClick={openPending} disabled={screenActionsLocked}>
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
          onClose={closeForeground}
        />
      )}
    </>
  );
}
