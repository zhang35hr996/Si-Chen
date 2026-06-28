/**
 * 御花园子地点模板线索预览（只读，不实例化写 state）。
 *
 * 规则：
 * - 复用 selectSubLocationTemplateCandidate（含参与者实例化验证）
 * - 只暴露 authored eventHint，不暴露参与者身份、hiddenTruthId 或 instanceId
 * - 若候选人池为空，返回 null（与 planSubLocationTemplateStart 行为一致，避免 UI 误导）
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import { selectSubLocationTemplateCandidate } from "./templateStart";

export interface SubLocationTemplatePreview {
  templateId: string;
  eventHint: string;
  affordable: boolean;
}

/**
 * 若子地点存在通过条件检查且参与者可选的 exploration 模板，返回非剧透线索预览；否则返回 null。
 * 与 planSubLocationTemplateStart 使用同一候选选择逻辑，保证预览与实际触发结果一致。
 */
export function previewSubLocationTemplate(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): SubLocationTemplatePreview | null {
  const candidate = selectSubLocationTemplateCandidate(db, state, locationId, subLocationId);
  if (!candidate) return null;

  const { template, affordable } = candidate;
  const eventHint =
    template.presentation?.mode === "exploration"
      ? (template.presentation.eventHint ?? template.title)
      : template.title;

  return { templateId: template.id, eventHint, affordable };
}
