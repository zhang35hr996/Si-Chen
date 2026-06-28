/**
 * 动态事件模板引擎（event-template-system）。
 *
 * 职责：
 *   1. 在 checkpoint 时筛选符合触发条件+冷却的模板（getEligibleTemplates）
 *   2. 为每个 role 从候选池中加权随机选人（selectParticipant）
 *   3. 加权随机选定隐藏真相（selectHiddenTruth）
 *   4. 生成 EventInstance（instantiateTemplate）
 *
 * 冷却追踪复用现有 eventLog：模板触发后在 eventLog 写入 { eventId: templateId }，
 * 与静态事件共用同一查找逻辑，无需新 state 字段，无需存档迁移。
 *
 * 参与者权重因子：
 *   - attr_high / attr_low：通过 resolveConsortRuntimeAttrs 实时读取
 *   - has_grievance：检查角色是否持有 unresolved 的 grievance 记忆
 *   - days_since_interaction：当前以默认权重兜底（Phase 2 可接 sceneHistory 实现精确逻辑）
 */
import type { ContentDB } from "../content/loader";
import type { EventTemplate, TemplateParticipantRole } from "../content/schemas";
import { resolveConsortRuntimeAttrs } from "../characters/consortAttrs";
import { isInColdPalace } from "../characters/coldPalace";
import { activeConfinement } from "../characters/confinement";
import { evaluateCondition } from "./conditions";
import type { Checkpoint } from "./engine";
import type { GameState } from "../state/types";

// ── EventInstance ─────────────────────────────────────────────────────

/** 已实例化的事件模板：选好了参与者与隐藏真相，合成步骤用此生成 GameEventContent + SceneContent。 */
export interface EventInstance {
  /** 全局唯一 ID，格式 inst_{templateId}_{dayIndex}_{nonce}（4 位十六进制）。 */
  instanceId: string;
  templateId: string;
  /** roleId → charId 映射。 */
  participants: Record<string, string>;
  hiddenTruthId: string;
  /** 实例化时刻（用于 eventLog 冷却追踪）。 */
  generatedAtDayIndex: number;
}

// ── RNG interface ─────────────────────────────────────────────────────

/** 轻量 RNG 接口：返回 [0, 1) 浮点数，与 Math.random 签名相同。测试可注入确定性 RNG。 */
export type RngFn = () => number;

// ── 冷却查找（复用 eventLog）────────────────────────────────────────

function lastFiredDayIndex(state: GameState, id: string): number | null {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const entry = state.eventLog[i]!;
    if (entry.eventId === id) return entry.firedAt.dayIndex;
  }
  return null;
}

function templateCooldownReady(state: GameState, template: EventTemplate): boolean {
  if (!template.cooldown) return true;
  const last = lastFiredDayIndex(state, template.id);
  if (last === null) return true;
  return state.calendar.dayIndex >= last + template.cooldown.actionDays;
}

// ── 触发条件 ──────────────────────────────────────────────────────────

export interface EligibleTemplate {
  template: EventTemplate;
  affordable: boolean;
}

/**
 * 返回当前 checkpoint 所有符合触发条件和冷却的模板，按 basePriority desc / id asc 排序。
 * 每项附带 affordable 标志（行动点是否充足）。
 */
export function getEligibleTemplates(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
): EligibleTemplate[] {
  return Object.values(db.templates)
    .filter((t) => t.checkpoint === checkpoint)
    .filter((t) => templateCooldownReady(state, t))
    .filter((t) => evaluateCondition(t.triggerCondition, { db, state }))
    .sort((a, b) => b.basePriority - a.basePriority || a.id.localeCompare(b.id))
    .map((t) => ({ template: t, affordable: t.apCost <= state.calendar.ap }));
}

// ── 参与者候选池筛选 ──────────────────────────────────────────────────

/**
 * 判断侍君是否通过排除条件过滤。
 * standing.lifecycle 候选/已逝/承嗣（carrying）均可由模板排除；
 * carrying_late 当前等同 carrying（承嗣侍君在事件中均回避，Phase 2 可精细化）。
 */
function meetsExcludeConditions(
  state: GameState,
  charId: string,
  excludes: TemplateParticipantRole["exclude"],
): boolean {
  const st = state.standing[charId];
  if (!st) return false;
  for (const exc of excludes) {
    switch (exc) {
      case "candidate":
        if (st.lifecycle === "candidate") return false;
        break;
      case "carrying_late":
        if (st.lifecycle === "carrying") return false;
        break;
      case "sick_or_critical":
        if (st.healthStatus === "sick" || st.healthStatus === "critical") return false;
        break;
      case "in_cold_palace":
        if (isInColdPalace(state, charId)) return false;
        break;
      case "grounded":
        if (activeConfinement(state, charId, state.calendar.dayIndex)) return false;
        break;
    }
  }
  return true;
}

/** 从候选池（consort_alive_active / empress_or_harem_admin）中取候选 charId 列表。 */
function buildCandidatePool(
  db: ContentDB,
  state: GameState,
  role: TemplateParticipantRole,
): string[] {
  const result: string[] = [];

  void db;
  if (role.pool === "consort_alive_active") {
    for (const [charId, st] of Object.entries(state.standing)) {
      if (st.lifecycle === "deceased") continue;
      // 基础活跃排除（冷宫/禁足/候选始终排除；carrying 的排除由 exclude 字段控制）
      if (st.lifecycle === "candidate") continue;
      if (isInColdPalace(state, charId)) continue;
      if (!meetsExcludeConditions(state, charId, role.exclude)) continue;
      result.push(charId);
    }
  } else if (role.pool === "court_official_active") {
    for (const [officialId, official] of Object.entries(state.officials ?? {})) {
      if (official.status !== "active") continue;
      result.push(officialId);
    }
  } else if (role.pool === "empress_or_harem_admin") {
    const admin = state.haremAdministration;
    if (admin.mode === "empress") {
      // 找皇后
      const empressId = Object.keys(state.standing).find(
        (id) => state.standing[id]!.rank === "huanghou" && state.standing[id]!.lifecycle !== "deceased",
      );
      if (empressId && meetsExcludeConditions(state, empressId, role.exclude)) {
        result.push(empressId);
      }
    } else if (admin.mode === "acting_consort") {
      const id = admin.charId;
      const st = state.standing[id];
      if (st && st.lifecycle !== "deceased" && meetsExcludeConditions(state, id, role.exclude)) {
        result.push(id);
      }
    }
    // neiwu_proxy: 无人物实体，跳过
  }

  return result;
}

/** 检查角色是否持有 unresolved grievance 记忆。 */
function hasUnresolvedGrievance(state: GameState, charId: string): boolean {
  const mem = state.memories[charId];
  if (!mem) return false;
  return mem.entries.some((e) => e.kind === "grievance" && e.unresolved);
}

/** 为单个 role 计算候选池加权列表，返回 { charId, weight }[]。 */
function computeWeightedCandidates(
  db: ContentDB,
  state: GameState,
  role: TemplateParticipantRole,
): Array<{ charId: string; weight: number }> {
  const candidates = buildCandidatePool(db, state, role);
  return candidates.map((charId) => {
    let weight = 1;
    const attrs = resolveConsortRuntimeAttrs(db, state, charId);

    for (const factor of role.weightFactors) {
      switch (factor.type) {
        case "attr_high": {
          const val = attrValue(attrs, state, charId, factor.attr);
          if (val >= factor.threshold) weight += factor.weight;
          break;
        }
        case "attr_low": {
          const val = attrValue(attrs, state, charId, factor.attr);
          if (val < factor.threshold) weight += factor.weight;
          break;
        }
        case "has_grievance":
          if (hasUnresolvedGrievance(state, charId)) weight += factor.weight;
          break;
        case "days_since_interaction":
          // Phase 1 fallback: 以 minDays 权重加成近似（Phase 2 按 sceneHistory 精化）
          weight += Math.floor(factor.weight * 0.5);
          break;
      }
    }

    return { charId, weight };
  });
}

type AttrKey = "favor" | "affection" | "jealousy" | "pride" | "ambition";

function attrValue(
  attrs: ReturnType<typeof resolveConsortRuntimeAttrs>,
  state: GameState,
  charId: string,
  attr: AttrKey,
): number {
  switch (attr) {
    case "favor":
      return state.standing[charId]?.favor ?? 0;
    case "affection":
      return attrs.affection;
    case "jealousy":
      return attrs.personality.jealousy;
    case "pride":
      return attrs.personality.pride;
    case "ambition":
      return attrs.ambition;
  }
}

/** 加权随机选一人（O(n)，n 为候选池大小）。返回 null 表示候选池为空。 */
export function weightedPick<T>(
  items: Array<{ item: T; weight: number }>,
  rng: RngFn,
): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const { item, weight } of items) {
    r -= weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1]!.item;
}

// ── 隐藏真相 ─────────────────────────────────────────────────────────

function selectHiddenTruth(template: EventTemplate, rng: RngFn): string {
  const candidates = template.hiddenTruthCandidates.map((c) => ({ item: c.id, weight: c.weight }));
  return weightedPick(candidates, rng) ?? template.hiddenTruthCandidates[0]!.id;
}

// ── 主入口 ────────────────────────────────────────────────────────────

let nonceCounter = 0;

function nextNonce(): string {
  nonceCounter = (nonceCounter + 1) & 0xffff;
  return nonceCounter.toString(16).padStart(4, "0");
}

/**
 * 为一个 EventTemplate 选好参与者和隐藏真相，生成 EventInstance。
 * 任意 role 候选池为空时返回 null（当前 checkpoint 无法实例化该模板）。
 */
export function instantiateTemplate(
  db: ContentDB,
  state: GameState,
  template: EventTemplate,
  rng: RngFn,
): EventInstance | null {
  const participants: Record<string, string> = {};

  // 为每个 role 独立选人，已选中的 charId 不再参与后续 role 的选择
  const usedIds = new Set<string>();

  for (const role of template.participantRoles) {
    const weighted = computeWeightedCandidates(db, state, role).filter(
      ({ charId }) => !usedIds.has(charId),
    );
    const chosen = weightedPick(
      weighted.map(({ charId, weight }) => ({ item: charId, weight })),
      rng,
    );
    if (!chosen) return null; // 候选池耗尽，跳过该模板
    participants[role.roleId] = chosen;
    usedIds.add(chosen);
  }

  const hiddenTruthId = selectHiddenTruth(template, rng);
  const dayIndex = state.calendar.dayIndex;
  const instanceId = `inst_${template.id}_${dayIndex}_${nextNonce()}`;

  return {
    instanceId,
    templateId: template.id,
    participants,
    hiddenTruthId,
    generatedAtDayIndex: dayIndex,
  };
}

/**
 * 在当前 checkpoint 中挑选最高优先级、可承担且能成功实例化的模板。
 * 若无合适模板返回 null。
 */
export function pickTemplateEvent(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
  rng: RngFn,
): { template: EventTemplate; instance: EventInstance } | null {
  const eligible = getEligibleTemplates(db, state, checkpoint);
  for (const { template, affordable } of eligible) {
    if (!affordable) continue;
    const instance = instantiateTemplate(db, state, template, rng);
    if (instance) return { template, instance };
  }
  return null;
}
