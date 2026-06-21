// src/ui/components/DescriptorStat.tsx
import { describe, tone, type DescriptorKind, type ScaleId } from "../format/descriptors";

export function DescriptorStat({
  label, scale, value, kind,
}: { label: string; scale: ScaleId; value: number; kind?: DescriptorKind }) {
  return (
    <div className="attr-line">
      <span className="attr-line__label">{label}</span>
      <span className="attr-line__value" data-tone={tone(scale, value)}>
        {describe(scale, value, kind)}
      </span>
    </div>
  );
}
