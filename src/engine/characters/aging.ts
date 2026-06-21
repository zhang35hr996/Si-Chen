/**
 * 角色当前年龄算法（各类不同，禁止一律 profile.age + year - 1）：
 *   皇帝 = startingAge + (year-1)；太后/预置侍君 = profile.age + (year-1)；
 *   皇嗣 = 由出生年计算；动态入宫侍君 = ageAtEntry + (year - enteredAtYear)。
 */
export function ageOver35(age: number): number {
  return Math.max(0, age - 35);
}

export function presetAge(profileAge: number, year: number): number {
  return profileAge + (year - 1);
}

export function heirAge(birthAt: { year: number }, now: { year: number }): number {
  return now.year - birthAt.year;
}

export function dynamicConsortAge(
  ageAtEntry: number,
  enteredAtYear: number,
  year: number,
): number {
  return ageAtEntry + (year - enteredAtYear);
}
