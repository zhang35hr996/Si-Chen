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
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
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

function planFromEligible(
  db: ContentDB,
  state: GameState,
  eligible: readonly EligibleTemplate[],
  locationId: string,
  seedStr: string,
  checkpoint: Checkpoint,
): TemplateEventStartPlan | null {
  const rng = makeSeededRng(seedStr);

  // 第一个候选的调度门（按 pending/ambient 分类）。
  // 子地点点击（location_enter）100% 通过；time_advance 走概率门。
  const firstEligible = eligible.find(({ affordable }) => affordable);
  if (!firstEligible) return null;

  const kind = firstEligible.template.schedule?.kind ?? "ambient";
  const { passed, diagnostic } = shouldTriggerTemplate(state, checkpoint, kind, rng);
  if (!passed) return null;

  for (const { template, affordable } of eligible) {
    if (!affordable) continue;
    const instance = instantiateTemplate(db, state, template, rng, state.templateEventNextSeq);
    if (!instance) continue;
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
 * 为御花园子地点物化 exploration 模板事件。
 * 只考虑 hostLocationId === locationId 且 subLocationId 完全匹配的模板。
 */
export function planSubLocationTemplateStart(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): TemplateEventStartPlan | null {
  const eligible = getEligibleTemplates(db, state, "location_enter").filter(
    ({ template }) =>
      template.presentation?.mode === "exploration" &&
      template.presentation.hostLocationId === locationId &&
      template.presentation.subLocationId === subLocationId,
  );
  const seedStr = `template:${state.rngSeed}:location_enter:${state.calendar.dayIndex}:${locationId}:${subLocationId}:${state.templateEventNextSeq}`;
  return planFromEligible(db, state, eligible, locationId, seedStr, "location_enter");
}
