/** 种子化随机 2 字小名（确定性，复用 gestationRoll 的 hash）。 */
import { gestationRoll } from "./gestation";

/** 宫闱小名常用 2 字叠词/吉名。 */
export const PET_NAME_POOL: readonly string[] = [
  "环环", "团团", "圆圆", "安安", "宁宁", "乐乐", "阿福", "阿宝",
  "念念", "锦锦", "瑞瑞", "盼盼", "灵灵", "婉婉", "朗朗", "暖暖",
];

/** 取池中一名；种子 = rngSeed ⊕ heirId。 */
export function randomPetName(rngSeed: number, heirId: string): string {
  const roll = gestationRoll(`petname:${rngSeed}:${heirId}`);
  return PET_NAME_POOL[roll % PET_NAME_POOL.length]!;
}
