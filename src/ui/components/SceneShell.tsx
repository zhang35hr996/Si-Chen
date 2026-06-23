/**
 * 统一场景外壳（scene-ui-narrative-refactor §4）。置于 GameShell 之内（`.shell` 已是纵向 flex、
 * `.shell__body` flex:1），故本壳 `flex:1; min-height:0` 占满顶部栏以下剩余高度，**不用裸 100dvh**。
 * 背景铺满主视口（cover）+ 底部渐变遮罩保证文字对比度；stage/narrative/actions 三槽由各屏注入。
 * 背景裁切焦点 backgroundPosition 可选（缺省 center），避免超宽/360px 主体被裁。
 */
import type { ReactNode } from "react";
import { sceneStageStyle } from "./sceneShellStyle";

export function SceneShell({
  background,
  isFallback,
  backgroundPosition,
  stage,
  narrative,
  actions,
  ariaLabel,
}: {
  background: string;
  isFallback?: boolean;
  backgroundPosition?: string;
  stage?: ReactNode;
  narrative?: ReactNode;
  actions?: ReactNode;
  ariaLabel: string;
}) {
  return (
    <section className="scene-shell" aria-label={ariaLabel}>
      <div
        className="scene-shell__stage"
        style={sceneStageStyle(background, backgroundPosition)}
        data-fallback={isFallback || undefined}
      >
        {stage && <div className="scene-shell__stage-content">{stage}</div>}
        {narrative && <div className="scene-shell__narrative">{narrative}</div>}
      </div>
      {actions && <footer className="scene-shell__actions">{actions}</footer>}
    </section>
  );
}
