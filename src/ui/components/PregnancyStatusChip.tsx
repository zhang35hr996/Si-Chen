/** 孕情 chip：可见文本（如「承嗣君 · 孕3月」「怀胎 · 孕3月」）。与 HealthStatusChip 分开，互不覆盖。 */
export function PregnancyStatusChip({ label }: { label: string }) {
  return (
    <span className="pregnancy-chip" data-status="pregnant">
      {label}
    </span>
  );
}
