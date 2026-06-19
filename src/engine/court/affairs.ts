/**
 * 上朝会话（宣政殿）的事务抽取——纯逻辑、种子化确定性。
 *
 * 设计要点（见会话需求）：
 *   - 朝政事务是一组 checkpoint==="court" 的事件，永不参与自动 checkpoint，
 *     只由本模块在「上朝」时随机抽取 2–3 件，逐件处理。
 *   - 整场上朝只消耗 1 个行动点（由 UI 在进殿时一次性扣除）；每件事务事件
 *     本身 apCost 为 0，仅承载各自的资源影响。
 *   - 抽取确定性：同一 rngSeed + dayIndex 抽到同一组，避免重渲染时洗牌漂移。
 */
import { gestationRollRaw } from "../characters/gestation";
import type { ContentDB } from "../content/loader";

/** 朝政事务事件的专用挂载点。 */
export const COURT_CHECKPOINT = "court" as const;
/** 每场上朝抽取的事务数下/上限（含端点）。 */
export const COURT_MIN_AFFAIRS = 2;
export const COURT_MAX_AFFAIRS = 3;

/** 全部朝政事务事件 id（字典序，作为洗牌前的稳定基底）。 */
export function courtAffairPool(db: ContentDB): string[] {
  return Object.values(db.events)
    .filter((event) => event.checkpoint === COURT_CHECKPOINT)
    .map((event) => event.id)
    .sort();
}

/**
 * 为一场上朝抽取 2–3 件互不相同的事务 id。`seedKey` 应含 rngSeed 与当日
 * dayIndex，使每日朝议各异而同日稳定。池不足 2 件时尽数返回。
 */
export function pickCourtAffairs(db: ContentDB, seedKey: string): string[] {
  const pool = courtAffairPool(db);
  if (pool.length <= COURT_MIN_AFFAIRS) return pool;

  // 种子化 Fisher–Yates 洗牌
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = gestationRollRaw(`${seedKey}:shuffle:${i}`) % (i + 1);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  const span = COURT_MAX_AFFAIRS - COURT_MIN_AFFAIRS + 1; // 含端点
  const count = Math.min(
    pool.length,
    COURT_MIN_AFFAIRS + (gestationRollRaw(`${seedKey}:count`) % span),
  );
  return shuffled.slice(0, count);
}
