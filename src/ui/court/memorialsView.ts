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
};

export interface MemorialOptionView {
  id: string;
  label: string;
  /** 后果摘要，如「民心 +8 · 宗室不满 -6」。 */
  effectSummary: string;
  /** 国库变动展示，如「国库 -900 两」或「国库 +600 两」；undefined 表示无国库变化。 */
  treasuryCost?: string;
  /** 是否禁用（国库不足时为 true）。 */
  disabled: boolean;
  /** 禁用原因（仅在因国库不足而禁用时设置），如「国库不足，尚缺 300 两」。 */
  disabledReason?: string;
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
  /** 当前国库余额展示，如「国库：10,000 两」。 */
  currentTreasury: string;
}

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/** 把整数格式化为千位逗号分隔字符串（不使用 toLocaleString，保证测试稳定性）。 */
export function formatSilver(n: number): string {
  const abs = Math.abs(n);
  const str = String(Math.floor(abs));
  const mod = str.length % 3;
  const parts: string[] = [];
  let i = 0;
  if (mod > 0) { parts.push(str.slice(0, mod)); i = mod; }
  while (i < str.length) { parts.push(str.slice(i, i + 3)); i += 3; }
  const formatted = parts.join(",");
  return n < 0 ? `-${formatted}` : formatted;
}

export function memorialCard(m: Memorial, currentTreasury: number): MemorialCardView {
  const options: MemorialOptionView[] = m.payload.options.map((o) => {
    let treasuryCost: string | undefined;
    let disabled = false;
    let disabledReason: string | undefined;

    if (o.treasuryDelta !== undefined) {
      if (o.treasuryDelta < 0) {
        treasuryCost = `国库 ${formatSilver(o.treasuryDelta)} 两`;
        const shortfall = Math.abs(o.treasuryDelta) - currentTreasury;
        if (shortfall > 0) {
          disabled = true;
          disabledReason = `国库不足，尚缺 ${formatSilver(shortfall)} 两`;
        }
      } else {
        treasuryCost = `国库 +${formatSilver(o.treasuryDelta)} 两`;
      }
    }

    return {
      id: o.id,
      label: o.label,
      effectSummary: o.effects.map((e) => `${fieldLabel(e.field)} ${e.delta >= 0 ? "+" : ""}${e.delta}`).join(" · "),
      treasuryCost,
      disabled,
      disabledReason,
    };
  });
  const base: MemorialCardView = {
    id: m.id,
    categoryLabel: MEMORIAL_CATEGORY_LABEL[m.category],
    title: m.title,
    summary: m.summary,
    options,
    currentTreasury: `国库：${formatSilver(currentTreasury)} 两`,
  };
  if (m.payload.category === "disaster") {
    base.regionName = DISASTER_REGIONS[m.payload.regionId] ?? m.payload.regionId;
    base.severityLabel = m.payload.severity === "major" ? "大灾" : "灾情";
  }
  return base;
}
