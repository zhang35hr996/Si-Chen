/** 乘风「报告+选择」的声明式数据；App 解释 action，纯函数不持有回调。 */
export type PromptAction =
  | { type: "stash"; itemId: string }        // 收进库房：grantItem
  | { type: "gift"; itemId: string }         // 赏赐：开选人弹窗 → grantItem+bestow
  | { type: "huntJoin"; year: number }       // 参加秋猎：扣 1AP + 掷皮毛
  | { type: "huntDecline"; year: number }    // 不参加：仅设年度 flag
  | { type: "daxuanEnter"; year: number }    // 前往体元殿殿选：扣 1AP + 开殿选
  | { type: "daxuanDelegate"; year: number } // 让太后皇后决定：不扣 AP
  | { type: "taihouRebukeAttend" }           // 太后训诫·去看看：应用 effects + 慈宁宫背景过场
  | { type: "taihouRebukeDecline" };         // 太后训诫·不必了：应用 effects，不播现场台词

export interface PromptChoice {
  label: string;
  action: PromptAction;
}

export interface ChengFengPrompt {
  speakerId: string;
  line: string;
  choices: PromptChoice[];
}

export function isPromptAction(x: unknown): x is PromptAction {
  if (typeof x !== "object" || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return (
    t === "stash" || t === "gift" || t === "huntJoin" || t === "huntDecline" ||
    t === "daxuanEnter" || t === "daxuanDelegate" ||
    t === "taihouRebukeAttend" || t === "taihouRebukeDecline"
  );
}
