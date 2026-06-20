import { gestationRoll } from "../characters/gestation";
import type { OfficialPost } from "../content/schemas";

/** 权势随品级单调（0–100），同品按 official id 给确定性 ±3 人差。 */
export function powerOf(post: OfficialPost, officialId: string): number {
  const base = Math.round((post.gradeOrder / 18) * 92) + 5;
  const jitter = (gestationRoll(`power:${officialId}`) % 7) - 3; // [-3, +3]
  return Math.max(0, Math.min(100, base + jitter));
}
