/**
 * 御花园子地点模板线索预览（只读，不实例化）。
 *
 * 规则：
 * - 检查 trigger condition + cooldown（复用 getEligibleTemplates）
 * - 只暴露 authored eventHint，不暴露参与者身份、hiddenTruthId 或 instanceId
 * - 不写 state，不创建 TemplateEventRecord，不增加 templateEventNextSeq
 *
 * 注：参与者池的深度检查由 planSubLocationTemplateStart 在实际触发时执行。
 * 若极少数情况下预览显示 hint 而实际触发失败（无候选人），进入子地点显示普通游览即可。
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import { getEligibleTemplates } from "./templateEngine";

export interface SubLocationTemplatePreview {
  templateId: string;
  eventHint: string;
  affordable: boolean;
}

/**
 * 若子地点存在通过条件检查的 exploration 模板，返回非剧透线索预览；否则返回 null。
 */
export function previewSubLocationTemplate(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): SubLocationTemplatePreview | null {
  const eligible = getEligibleTemplates(db, state, "location_enter").filter(
    ({ template }) =>
      template.presentation?.mode === "exploration" &&
      template.presentation.hostLocationId === locationId &&
      template.presentation.subLocationId === subLocationId,
  );

  const first = eligible[0];
  if (!first) return null;

  const { template, affordable } = first;
  const eventHint =
    template.presentation?.mode === "exploration"
      ? (template.presentation.eventHint ?? template.title)
      : template.title;

  return { templateId: template.id, eventHint, affordable };
}
