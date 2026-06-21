/** 乘风「报告+选择」的声明式数据；App 解释 action，纯函数不持有回调。 */
export type PromptAction =
  | { type: "stash"; itemId: string }        // 收进库房：grantItem
  | { type: "gift"; itemId: string }         // 赏赐：开选人弹窗 → grantItem+bestow
  | { type: "huntJoin"; year: number }       // 参加秋猎：扣 1AP + 掷皮毛
  | { type: "huntDecline"; year: number };   // 不参加：仅设年度 flag

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
  return t === "stash" || t === "gift" || t === "huntJoin" || t === "huntDecline";
}
