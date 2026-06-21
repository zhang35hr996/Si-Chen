/** 长期性格三轴（spec 第 5 类，MVP）。中性基线 50，标签增量叠加，clamp 0–100。 */
export interface SocialDisposition {
  statusConsciousness: number; // 门第/位分/礼序敏感度
  compassion: number;          // 同情/宽厚/顾念他人
  discretion: number;          // 克制/谨慎/看场合说话
}
export const DEFAULT_DISPOSITION: SocialDisposition = {
  statusConsciousness: 50, compassion: 50, discretion: 50,
};

type DispositionDelta = Partial<SocialDisposition>;

/** 集中式标签→三轴增量表（一标签可影响多轴；幅度弱±5–10/中±15–20/强±25–30）。 */
export const PERSONALITY_TRAIT_DELTAS: Record<string, DispositionDelta> = {
  高傲: { statusConsciousness: 25, compassion: -10 },
  重礼: { statusConsciousness: 20, discretion: 15 },
  势利: { statusConsciousness: 30, compassion: -20 },
  清高: { statusConsciousness: 15, discretion: 10 },
  仁厚: { compassion: 30 },
  温柔: { compassion: 20, discretion: 5 },
  心软: { compassion: 25, discretion: -5 },
  冷漠: { compassion: -30 },
  刻薄: { compassion: -25, discretion: -10 },
  谨慎: { discretion: 30 },
  克制: { discretion: 25 },
  圆滑: { discretion: 25, statusConsciousness: 10 },
  直率: { discretion: -20 },
  冲动: { discretion: -30 },
  口无遮拦: { discretion: -35 },
};

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

export interface DispositionDiagnostic { code: "unknown_personality_trait"; trait: string }

export function deriveDisposition(traits: readonly string[]): {
  disposition: SocialDisposition;
  diagnostics: DispositionDiagnostic[];
} {
  const acc = { ...DEFAULT_DISPOSITION };
  const diagnostics: DispositionDiagnostic[] = [];
  for (const trait of traits) {
    const delta = PERSONALITY_TRAIT_DELTAS[trait];
    if (!delta) {
      diagnostics.push({ code: "unknown_personality_trait", trait });
      continue; // 未映射标签忽略，不影响三轴、不致加载失败
    }
    acc.statusConsciousness += delta.statusConsciousness ?? 0;
    acc.compassion += delta.compassion ?? 0;
    acc.discretion += delta.discretion ?? 0;
  }
  return {
    disposition: {
      statusConsciousness: clamp(acc.statusConsciousness),
      compassion: clamp(acc.compassion),
      discretion: clamp(acc.discretion),
    },
    diagnostics,
  };
}
