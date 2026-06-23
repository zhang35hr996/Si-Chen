/**
 * 官员/家族生成的集中年龄与身份规则（spec §8）。所有约束聚于此，生成器与校验器共用，
 * 杜绝散落到各处。纯函数，无随机。
 */

/** 官员入仕年龄下限（未成年人不得为官）。 */
export const OFFICIAL_MIN_AGE = 22;
/** 官员开局年龄上限（更老者本阶段不生成，留待后续告老流程）。 */
export const OFFICIAL_MAX_AGE = 62;

/** 母女（上下两代）最小年龄差：母亲至少年长子女这么多岁。 */
export const PARENT_CHILD_MIN_GAP = 16;
/** 母女最大年龄差（避免过老生育的离谱设定）。 */
export const PARENT_CHILD_MAX_GAP = 45;

/** 内卿（配偶）与官员的最大年龄差（绝对值）。 */
export const SPOUSE_MAX_GAP = 12;
/** 家族成员最低年龄（含幼儿）。 */
export const MEMBER_MIN_AGE = 1;

/** 母女年龄关系是否合理：母亲年长且差在合理区间。 */
export function isValidParentChildAge(parentAge: number, childAge: number): boolean {
  const gap = parentAge - childAge;
  return gap >= PARENT_CHILD_MIN_GAP && gap <= PARENT_CHILD_MAX_GAP;
}

/** 配偶年龄差是否合理（双方均成年、差不过大）。 */
export function isValidSpouseAge(a: number, b: number): boolean {
  return a >= 18 && b >= 18 && Math.abs(a - b) <= SPOUSE_MAX_GAP;
}

/** 官员年龄是否合规（成年、达入仕年龄、未超上限）。 */
export function isValidOfficialAge(age: number): boolean {
  return age >= OFFICIAL_MIN_AGE && age <= OFFICIAL_MAX_AGE;
}
