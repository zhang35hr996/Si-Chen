/** 共享 UI 格式化工具。 */

/** 铜钱千分位显示，如 10000 → "10,000"。 */
export function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}
