/** 健康状态小工具。病情状态与数值 health 独立。 */
import type { HealthStatus } from "../state/types";

/** sick / critical 皆视为「病中」，供旧布尔调用方（太后侍疾/敲打）使用。 */
export function isIll(status: HealthStatus): boolean {
  return status !== "healthy";
}
