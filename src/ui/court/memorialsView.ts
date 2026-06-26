/**
 * 奏折的只读展示派生（UI 专用；引擎不依赖）。把 Memorial 解析为奏折卡所需的标题/正文/类别/地域/严重度，
 * 以及各选项的后果摘要（人读的属性增减）。
 */
import type { Memorial } from "../../engine/state/types";
import { DISASTER_REGIONS } from "../../engine/court/memorials";

export const MEMORIAL_CATEGORY_LABEL: Record<Memorial["category"], string> = {
  personnel: "人事",
  treasury: "度支",
  disaster: "灾情",
  military: "军务",
  justice: "刑名",
};

/** 后果摘要用的属性文案（仅本框架涉及的字段）。 */
const FIELD_LABEL: Record<string, string> = {
  publicSupport: "民心",
  clanDiscontent: "宗室不满",
  productivity: "生产力",
  rumor: "谣言",
  regimeSecurity: "皇权安全",
  governance: "朝政",
};

export interface MemorialOptionView {
  id: string;
  label: string;
  /** 后果摘要，如「民心 +8 · 宗室不满 -6」。 */
  effectSummary: string;
}

export interface MemorialCardView {
  id: string;
  categoryLabel: string;
  title: string;
  summary: string;
  /** 灾情地域显示名（仅 disaster）。 */
  regionName?: string;
  severityLabel?: string;
  options: MemorialOptionView[];
}

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

export function memorialCard(m: Memorial): MemorialCardView {
  const options: MemorialOptionView[] = m.payload.options.map((o) => ({
    id: o.id,
    label: o.label,
    effectSummary: o.effects.map((e) => `${fieldLabel(e.field)} ${e.delta >= 0 ? "+" : ""}${e.delta}`).join(" · "),
  }));
  const base: MemorialCardView = {
    id: m.id,
    categoryLabel: MEMORIAL_CATEGORY_LABEL[m.category],
    title: m.title,
    summary: m.summary,
    options,
  };
  if (m.payload.category === "disaster") {
    base.regionName = DISASTER_REGIONS[m.payload.regionId] ?? m.payload.regionId;
    base.severityLabel = m.payload.severity === "major" ? "大灾" : "灾情";
  }
  return base;
}
