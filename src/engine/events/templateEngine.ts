/**
 * 动态事件模板引擎（event-template-system）。
 *
 * 职责：
 *   1. 在 checkpoint 时筛选符合触发条件+冷却的模板（getEligibleTemplates）
 *   2. 为每个 role 从候选池中加权随机选人（selectParticipant）
 *   3. 加权随机选定隐藏真相（selectHiddenTruth）
 *   4. 生成 EventInstance（instantiateTemplate）
 *
 * 冷却追踪复用现有 eventLog：模板触发后在 eventLog 写入 { eventId: instanceId }，
 * 冷却检查同时看 eventLog 中 templateId 记录（此处读取 templateEventRecords）。
 *
 * 实例 ID 格式：tei_NNNNNN（六位零填充顺序号，由 state.templateEventNextSeq 提供）。
 * ID 由调用方在持久化 TemplateEventRecord 时同步递增 templateEventNextSeq，不依赖
 * 模块全局状态，保证相同行动序列在任何运行环境下产生相同 ID 序列。
 *
 * consort_alive_active 池：
 *   默认排除 deceased / candidate / 冷宫 / 禁足。
 *   必须满足 db.characters[id]?.kind === "consort" 或存在于 state.generatedConsorts。
 *   exclude 字段只处理模板额外限制（carrying_late / sick_or_critical）。
 *
 * 参与者权重因子：
 *   - attr_high / attr_low：通过 resolveConsortRuntimeAttrs 实时读取
 *   - has_grievance：检查角色是否持有 unresolved 的 grievance 记忆
 *   - days_since_interaction：Phase 1 fallback 以 0.5 权重系数估计
 *
 * participantConstraints：选完所有 role 后，验证跨 role 约束（rank_higher_than 等）。
 * 不满足则 instantiateTemplate 返回 null，pickTemplateEvent 跳过。
 */
import type { ContentDB } from "../content/loader";
import type { EventTemplate, TemplateParticipantRole, ParticipantConstraint } from "../content/schemas";
import { resolveConsortRuntimeAttrs } from "../characters/consortAttrs";
import { isInColdPalace } from "../characters/coldPalace";
import { activeConfinement } from "../characters/confinement";
import { evaluateCondition } from "./conditions";
import type { Checkpoint } from "./engine";
import type { GameState } from "../state/types";

// ── EventInstance ─────────────────────────────────────────────────────

/** 已实例化的事件模板：选好了参与者与隐藏真相，合成步骤用此生成 GameEventContent + SceneContent。 */
export interface EventInstance {
  /** 全局唯一 ID，格式 tei_NNNNNN（六位顺序号，来自 state.templateEventNextSeq）。 */
  instanceId: string;
  templateId: string;
  /** roleId → charId 映射。 */
  participants: Record<string, string>;
  hiddenTruthId: string;
  /** 实例化时刻（用于 TemplateEventRecord）。 */
  generatedAtDayIndex: number;
}

// ── RNG interface ─────────────────────────────────────────────────────

/** 轻量 RNG 接口：返回 [0, 1) 浮点数，与 Math.random 签名相同。测试可注入确定性 RNG。 */
export type RngFn = () => number;

// ── 冷却查找（复用 templateEventRecords）──────────────────────────────

function lastFiredDayIndex(state: GameState, templateId: string): number | null {
  let latest: number | null = null;
  for (const rec of Object.values(state.templateEventRecords)) {
    if (rec.templateId === templateId) {
      // TemplateEventRecord.generatedAt is GameTime; use calendar dayIndex equivalent
      // We approximate by scanning eventLog for matching instanceId entries
      const logEntry = state.eventLog.find((e) => e.eventId === rec.id);
      if (logEntry) {
        const d = logEntry.firedAt.dayIndex;
        if (latest === null || d > latest) latest = d;
      }
    }
  }
  return latest;
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

/** 从候选池中取候选 charId 列表。 */
function buildCandidatePool(
  db: ContentDB,
  state: GameState,
  role: TemplateParticipantRole,
): string[] {
  const result: string[] = [];

  if (role.pool === "consort_alive_active") {
    for (const [charId, st] of Object.entries(state.standing)) {
      // 只取 consort 类型角色（含殿选生成的侍君）
      const charDef = db.characters[charId] ?? state.generatedConsorts[charId];
      if (charDef?.kind !== "consort") continue;
      if (st.lifecycle === "deceased") continue;
      if (st.lifecycle === "candidate") continue;
      // 默认排除冷宫和禁足（pool 级保证；模板 exclude 只处理额外限制）
      if (isInColdPalace(state, charId)) continue;
      if (activeConfinement(state, charId, state.calendar.dayIndex)) continue;
      // 模板额外排除（carrying_late / sick_or_critical 等）
      if (!meetsExcludeConditions(state, charId, role.exclude)) continue;
      result.push(charId);
    }
  } else if (role.pool === "court_official_active") {
    // 只选择在 db.characters 中有完整角色内容的官员，确保可作为 SceneRunner speaker。
    // 运行时动态生成的官员（official_fam_* 等）尚无 voice/expressions，暂不支持模板对话。
    for (const [officialId, official] of Object.entries(state.officials ?? {})) {
      if (official.status !== "active") continue;
      if (!db.characters[officialId]) continue;
      result.push(officialId);
    }
  } else if (role.pool === "empress_or_harem_admin") {
    const admin = state.haremAdministration;
    if (admin.mode === "empress") {
      const empressId = Object.keys(state.standing).find(
        (id) => {
          const charDef = db.characters[id] ?? state.generatedConsorts[id];
          return charDef?.kind === "consort" &&
            state.standing[id]!.rank === "huanghou" &&
            state.standing[id]!.lifecycle !== "deceased";
        },
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
          // Phase 1 fallback：以半权加成估计（Phase 2 按 sceneHistory 精化）
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

// ── 参与者约束校验 ────────────────────────────────────────────────────

function checkParticipantConstraints(
  db: ContentDB,
  state: GameState,
  participants: Record<string, string>,
  constraints: ParticipantConstraint[],
): boolean {
  for (const constraint of constraints) {
    if (constraint.type === "rank_higher_than") {
      const higherId = participants[constraint.higherRole];
      const lowerId = participants[constraint.lowerRole];
      if (!higherId || !lowerId) return false;
      const higherOrder = db.ranks[state.standing[higherId]?.rank ?? ""]?.order ?? 0;
      const lowerOrder = db.ranks[state.standing[lowerId]?.rank ?? ""]?.order ?? 0;
      if (higherOrder <= lowerOrder) return false;
    }
  }
  return true;
}

// ── 主入口 ────────────────────────────────────────────────────────────

/**
 * 为一个 EventTemplate 选好参与者和隐藏真相，生成 EventInstance。
 *
 * @param nextSeq - 来自 state.templateEventNextSeq 的当前顺序号，用于确定性 ID 生成。
 *   调用方负责在持久化记录时将 state.templateEventNextSeq 递增。
 *
 * 返回 null 的情况：
 *   - 任意 role 候选池为空
 *   - participantConstraints 不满足
 */
export function instantiateTemplate(
  db: ContentDB,
  state: GameState,
  template: EventTemplate,
  rng: RngFn,
  nextSeq: number,
): EventInstance | null {
  const participants: Record<string, string> = {};
  const usedIds = new Set<string>();

  for (const role of template.participantRoles) {
    const weighted = computeWeightedCandidates(db, state, role).filter(
      ({ charId }) => !usedIds.has(charId),
    );
    const chosen = weightedPick(
      weighted.map(({ charId, weight }) => ({ item: charId, weight })),
      rng,
    );
    if (!chosen) return null;
    participants[role.roleId] = chosen;
    usedIds.add(chosen);
  }

  // 跨 role 约束校验
  if (!checkParticipantConstraints(db, state, participants, template.participantConstraints)) {
    return null;
  }

  const hiddenTruthId = selectHiddenTruth(template, rng);
  const instanceId = `tei_${String(nextSeq).padStart(6, "0")}`;

  return {
    instanceId,
    templateId: template.id,
    participants,
    hiddenTruthId,
    generatedAtDayIndex: state.calendar.dayIndex,
  };
}

/**
 * 在当前 checkpoint 中挑选最高优先级、可承担且能成功实例化的模板。
 * 若无合适模板返回 null。
 *
 * 调用方须在使用返回的 instance 后将 state.templateEventNextSeq 递增。
 */
export function pickTemplateEvent(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
  rng: RngFn,
): { template: EventTemplate; instance: EventInstance } | null {
  const eligible = getEligibleTemplates(db, state, checkpoint);
  const nextSeq = state.templateEventNextSeq;
  for (const { template, affordable } of eligible) {
    if (!affordable) continue;
    const instance = instantiateTemplate(db, state, template, rng, nextSeq);
    if (instance) return { template, instance };
  }
  return null;
}
