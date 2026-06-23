/**
 * SceneShell 舞台背景样式（纯函数，便于在 node 测试环境断言裁切焦点透传）。
 * 背景图铺满（cover，在 CSS 中设定）；backgroundPosition 控制裁切焦点，缺省 center。
 */
export interface SceneStageStyle {
  backgroundImage: string;
  backgroundPosition: string;
}

export function sceneStageStyle(background: string, backgroundPosition?: string): SceneStageStyle {
  return {
    backgroundImage: `url("${background}")`,
    backgroundPosition: backgroundPosition ?? "center",
  };
}
