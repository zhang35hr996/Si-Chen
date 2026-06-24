/**
 * 官员年度生命周期 tick（Phase 2 PR2A）。由时间事务在「正月上旬进入」时统一执行一次：
 *   增龄 → 自然死亡（官员 + 家族成员）→ 生成告老请求。
 * 纯函数、确定性（seed 隔离，不消耗其它随机流）。死亡走正式 markOfficialDead（释放席位 +
 * 写历史）；告老只生成 pending request，批准/挽留由 store 命令处理（UI 留 PR2B）。
 */
import { gestationRoll } from "../engine/characters/gestation";
import type { GameTime } from "../engine/calendar/time";
import type { ContentDB } from "../engine/content/loader";
import { ageOfficialsOneYear } from "../engine/officials/aging";
import { markOfficialDead } from "../engine/officials/lifecycle";
import { isRetirementAgeEligible, naturalDeathChance, retirementChance } from "../engine/officials/lifecycleRules";
import type { GameState, PendingRetirement } from "../engine/state/types";

export function buildOfficialYearlyTick(state: GameState, _db: ContentDB, at: GameTime): GameState {
  const year = at.year;

  // 1) 增龄（dead 官员 / deceased 成员不增长）。
  let next = ageOfficialsOneYear(state);

  // 2) 官员自然死亡（按增龄后的年龄）。走正式 markOfficialDead → 释放席位 + 写历史 + 撤未决告老。
  for (const id of Object.keys(next.officials)) {
    const o = next.officials[id]!;
    if (o.status === "dead") continue;
    if (gestationRoll(`official:lifecycle:${year}:${id}`) < naturalDeathChance(o.age)) {
      const r = markOfficialDead(next, id, "natural_death", at);
      if (!r.ok) throw new Error(`official yearly tick: markOfficialDead failed for ${id}: ${r.error.message}`);
      next = r.value;
    }
  }

  // 3) 家族成员自然死亡：仅标记 deceasedAt（绝不删除——亲缘/家族关系保留）。
  let members = next.familyMembers;
  let membersChanged = false;
  for (const id of Object.keys(members)) {
    const m = members[id]!;
    if (m.deceasedAt) continue;
    if (gestationRoll(`official:lifecycle:${year}:${id}`) < naturalDeathChance(m.age)) {
      if (!membersChanged) { members = { ...members }; membersChanged = true; }
      members[id] = { ...m, deceasedAt: at };
    }
  }
  if (membersChanged) next = { ...next, familyMembers: members };

  // 4) 告老请求（活着的在任官员，达龄、按概率、且尚无未决请求）。
  const pendingIds = new Set(next.pendingRetirements.map((p) => p.officialId));
  const requests: PendingRetirement[] = [];
  for (const id of Object.keys(next.officials)) {
    const o = next.officials[id]!;
    if (o.status !== "active" || pendingIds.has(id) || !isRetirementAgeEligible(o.age)) continue;
    if (gestationRoll(`official:retire:${year}:${id}`) < retirementChance(o.age)) {
      requests.push({ officialId: id, requestedAt: at });
    }
  }
  if (requests.length > 0) {
    next = { ...next, pendingRetirements: [...next.pendingRetirements, ...requests] };
  }

  return next;
}
