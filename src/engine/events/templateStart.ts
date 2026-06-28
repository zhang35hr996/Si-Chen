/**
 * 模板事件应用层启动入口。
 *
 * planTemplateEventStart   — auto checkpoint（time_advance / location_enter）用，排除 exploration 模板。
 * planSubLocationTemplateStart — 御花园子地点用，只考虑 hostLocationId + subLocationId 匹配的 exploration 模板。
 *
 * 两者均：
 *   1. 筛选 eligible 模板
 *   2. 以确定性种子（rngSeed + checkpoint + dayIndex + location + seq）实例化
 *   3. 合成 event/scene，注入 RuntimeContentDB
 *   4. 返回含 statePatch 的启动计划（store.beginTemplateEvent 写入 state）
 *
 * 同一 state 同一 checkpoint 始终产生同一实例，读档重放不随机。
 *
 * 调度顺序：
 *   1. 先尝试所有 pending 模板（100% 门，独立 RNG）；任意一个成功实例化即返回。
 *   2. 若无 pending 成功，才对 ambient 过一次概率门；通过后按优先级尝试 ambient。
 * Gate RNG 与 per-template instance RNG 各自独立派生，避免一个模板失败污染后续随机流。
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { EventTemplate } from "../content/schemas";
import { fnv1a64Hex } from "../save/canonical";
import type { GameState, TemplateEventRecord } from "../state/types";
import type { Checkpoint } from "./engine";
import { getEligibleTemplates, instantiateTemplate, type EligibleTemplate, type RngFn } from "./templateEngine";
import { shouldTriggerTemplate, type ScheduleDiagnostic } from "./templateScheduler";
import { createRuntimeDB, injectInstance, type RuntimeContentDB } from "./templateSynth";

export interface TemplateEventStartPlan {
  eventId: string;
  instanceId: string;
  templateId: string;
  runtimeDb: RuntimeContentDB;
  statePatch: {
    templateEventNextSeq: number;
    newRecord: TemplateEventRecord;
  };
  /** 调度诊断（可传入 trace，不进 GameState）。 */
  scheduleDiagnostic: ScheduleDiagnostic;
}

/** fnv1a64Hex 种子派生线性同余 RNG。 */
export function makeSeededRng(seedStr: string): RngFn {
  let s = parseInt(fnv1a64Hex(seedStr).slice(0, 8), 16);
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function tryInstantiate(
  db: ContentDB,
  state: GameState,
  template: EventTemplate,
  affordable: boolean,
  instanceRng: RngFn,
  locationId: string,
  diagnostic: ScheduleDiagnostic,
): TemplateEventStartPlan | null {
  if (!affordable) return null;
  const instance = instantiateTemplate(db, state, template, instanceRng, state.templateEventNextSeq);
  if (!instance) return null;
  const runtimeDb = createRuntimeDB(db);
  const eventId = injectInstance(db, state, runtimeDb, template, instance, locationId);
  const newRecord: TemplateEventRecord = {
    id: instance.instanceId,
    templateId: instance.templateId,
    participants: instance.participants,
    hiddenTruthId: instance.hiddenTruthId,
    generatedAt: toGameTime(state.calendar),
    status: "generated",
  };
  return {
    eventId,
    instanceId: instance.instanceId,
    templateId: instance.templateId,
    runtimeDb,
    scheduleDiagnostic: diagnostic,
    statePatch: { templateEventNextSeq: state.templateEventNextSeq + 1, newRecord },
  };
}

function planFromEligible(
  db: ContentDB,
  state: GameState,
  eligible: readonly EligibleTemplate[],
  locationId: string,
  seedStr: string,
  checkpoint: Checkpoint,
): TemplateEventStartPlan | null {
  // 按调度类型分组（优先级排序已由 getEligibleTemplates 保证）
  const pending = eligible.filter(
    ({ template }) => (template.schedule?.kind ?? "ambient") === "pending",
  );
  const ambient = eligible.filter(
    ({ template }) => (template.schedule?.kind ?? "ambient") === "ambient",
  );

  // Gate RNG 与 per-template instance RNG 分开派生，避免失败时污染后续随机流。
  const gateRng = makeSeededRng(`${seedStr}:gate`);

  // 1. 先遍历 pending（100% 调度门，不受概率/频率上限约束）
  const pendingGate = shouldTriggerTemplate(db, state, checkpoint, "pending", gateRng);
  for (const { template, affordable } of pending) {
    const instanceRng = makeSeededRng(`${seedStr}:instance:${template.id}`);
    const plan = tryInstantiate(db, state, template, affordable, instanceRng, locationId, pendingGate.diagnostic);
    if (plan) return plan;
  }

  // 2. 没有 pending 成功实例化，才对 ambient 过一次调度门
  const ambientGate = shouldTriggerTemplate(db, state, checkpoint, "ambient", gateRng);
  if (!ambientGate.passed) return null;

  for (const { template, affordable } of ambient) {
    const instanceRng = makeSeededRng(`${seedStr}:instance:${template.id}`);
    const plan = tryInstantiate(db, state, template, affordable, instanceRng, locationId, ambientGate.diagnostic);
    if (plan) return plan;
  }

  return null;
}

/**
 * 为 auto checkpoint（time_advance / location_enter）物化模板事件。
 * exploration 和 manual 模板不在此处选取：exploration 须通过 planSubLocationTemplateStart，
 * manual 须由玩家主动触发。
 */
export function planTemplateEventStart(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
): TemplateEventStartPlan | null {
  const eligible = getEligibleTemplates(db, state, checkpoint).filter(({ template }) => {
    const mode = template.presentation?.mode;
    return mode === undefined || mode === "auto_on_enter";
  });
  const seedStr = `template:${state.rngSeed}:${checkpoint}:${state.calendar.dayIndex}:${state.playerLocation}:${state.templateEventNextSeq}`;
  return planFromEligible(db, state, eligible, state.playerLocation, seedStr, checkpoint);
}

/**
 * 御花园子地点 exploration 模板候选选择（共享逻辑）。
 * 返回第一个可实例化的候选（不写 state）；preview 和 plan 均从此函数读取。
 */
export interface SubLocationCandidate {
  template: EventTemplate;
  instanceId: string;
  participants: Record<string, string>;
  affordable: boolean;
}

export function selectSubLocationTemplateCandidate(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): SubLocationCandidate | null {
  const eligible = getEligibleTemplates(db, state, "location_enter").filter(
    ({ template }) =>
      template.presentation?.mode === "exploration" &&
      template.presentation.hostLocationId === locationId &&
      template.presentation.subLocationId === subLocationId,
  );
  const seedStr = `template:${state.rngSeed}:location_enter:${state.calendar.dayIndex}:${locationId}:${subLocationId}:${state.templateEventNextSeq}`;

  for (const { template, affordable } of eligible) {
    const instanceRng = makeSeededRng(`${seedStr}:instance:${template.id}`);
    const instance = instantiateTemplate(db, state, template, instanceRng, state.templateEventNextSeq);
    if (instance) {
      return { template, instanceId: instance.instanceId, participants: instance.participants, affordable };
    }
  }
  return null;
}

/**
 * 为御花园子地点物化 exploration 模板事件。
 * 与 previewSubLocationTemplate 共享 selectSubLocationTemplateCandidate，保证 UI 和实际触发一致。
 */
export function planSubLocationTemplateStart(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): TemplateEventStartPlan | null {
  const candidate = selectSubLocationTemplateCandidate(db, state, locationId, subLocationId);
  if (!candidate || !candidate.affordable) return null;

  const { template } = candidate;
  const seedStr = `template:${state.rngSeed}:location_enter:${state.calendar.dayIndex}:${locationId}:${subLocationId}:${state.templateEventNextSeq}`;
  const instanceRng = makeSeededRng(`${seedStr}:instance:${template.id}`);
  const instance = instantiateTemplate(db, state, template, instanceRng, state.templateEventNextSeq);
  if (!instance) return null;

  const runtimeDb = createRuntimeDB(db);
  const eventId = injectInstance(db, state, runtimeDb, template, instance, locationId);
  const newRecord: TemplateEventRecord = {
    id: instance.instanceId,
    templateId: instance.templateId,
    participants: instance.participants,
    hiddenTruthId: instance.hiddenTruthId,
    generatedAt: toGameTime(state.calendar),
    status: "generated",
  };
  const diagnostic: ScheduleDiagnostic = {
    checkpoint: "location_enter",
    kind: "ambient",
    probabilityRoll: 1,
    skippedReason: null,
    passed: true,
  };
  return {
    eventId,
    instanceId: instance.instanceId,
    templateId: instance.templateId,
    runtimeDb,
    scheduleDiagnostic: diagnostic,
    statePatch: { templateEventNextSeq: state.templateEventNextSeq + 1, newRecord },
  };
}
