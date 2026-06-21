/** 健康状态 chip：健康/生病/重病 + 数值。与孕情 chip 分开显示。 */
import type { HealthStatus } from "../../engine/state/types";

export function healthStatusLabel(status: HealthStatus): string {
  return status === "healthy" ? "健康" : status === "sick" ? "生病" : "重病";
}

export function HealthStatusChip({ status, health }: { status: HealthStatus; health: number }) {
  return (
    <span className="health-chip" data-status={status}>
      {healthStatusLabel(status)}　{health}
    </span>
  );
}
