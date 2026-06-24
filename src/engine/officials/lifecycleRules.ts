/**
 * 官员年度生命周期的概率曲线（Phase 2 PR2A）。集中、纯函数，供年度 tick 与测试共用。
 * 第一版只用年龄曲线（Official 暂无健康字段，本阶段不引入）。所有随机由调用方用确定性
 * seed（`official:lifecycle:<year>:<id>` / `official:retire:<year>:<id>`）驱动，绝不消耗其它随机流。
 */

/** 年自然死亡几率（百分，0–100）。<50 极低；50–69 上升；70+ 明显上升；达 120 岁硬上限必死。 */
export function naturalDeathChance(age: number): number {
  if (age >= 120) return 100; // 年龄硬上限：保证不会产生 >120 的不可读档状态
  if (age < 50) return 1;
  if (age < 60) return 3;
  if (age < 70) return 8;
  if (age < 80) return 18;
  return 32;
}

/** 是否达到可自然告老年龄（55 岁起）。 */
export function isRetirementAgeEligible(age: number): boolean {
  return age >= 55;
}

/** 年告老请求几率（百分，0–100）。<55 不可；55–59 低；60–64 中；65+ 高。 */
export function retirementChance(age: number): number {
  if (age < 55) return 0;
  if (age < 60) return 10;
  if (age < 65) return 30;
  return 60;
}
