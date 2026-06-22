/**
 * Eval-only style heuristics (PR3). These are NOT world lore — game lexicon lives
 * in content/lexicon.json. Term lists are deliberately heuristic; tuning them is
 * expected and isolated here, and never affects game runtime (eval/report only).
 */

/** Modern/anachronistic terms that should not appear in a court-drama line. */
export const ANACHRONISM_TERMS: string[] = [
  "手机", "电话", "电脑", "系统", "项目", "网络", "OK", "搞定", "数据", "信息化",
  "现代", "科技", "互联网", "视频", "拍照", "上线", "下线", "用户", "客户", "流量",
];

/**
 * Per-register marker words. `expected` raises the style score when present;
 * `incongruent` lowers it (markers that clash with the declared register).
 */
export const REGISTER_MARKERS: Record<
  "formal" | "casual" | "rough" | "poetic",
  { expected: string[]; incongruent: string[] }
> = {
  formal: { expected: ["谨", "敢", "万福", "恭", "请安"], incongruent: ["哈哈", "啦", "呗", "搞"] },
  casual: { expected: ["呀", "呢", "嘛"], incongruent: ["谨此", "伏惟", "顿首"] },
  rough: { expected: ["哼", "罢了", "少来"], incongruent: ["万福金安", "谨此"] },
  poetic: { expected: ["如", "似", "恰", "宛", "曾经"], incongruent: ["搞定", "OK"] },
};

export function findAnachronisms(text: string): string[] {
  return ANACHRONISM_TERMS.filter((t) => text.includes(t));
}
