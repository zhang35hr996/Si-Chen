/**
 * 模板事件物化层 — 原子写入入口。
 *
 * 职责：
 *   planTemplateEventMaterialization — 将 EventTemplate + 选人结果合成完整的
 *     instance / event / scene，并返回 nextStatePatch，调用方可在一次 immer 草稿中
 *     原子写入（sequence 递增 + TemplateEventRecord 入库），避免部分写入导致的
 *     存档损坏。
 *
 *   resolveTemplateEventRecord — 结算阶段（玩家选择选项后）将记录状态标记为
 *     resolved，写入 selectedChoiceId 与 resolvedAt。
 *
 * 调用时序：
 *   1. store 选出模板后调用 planTemplateEventMaterialization，得到 plan。
 *   2. store 将 plan.nextStatePatch 写入 state（原子），同时注入 event/scene 到
 *      RuntimeContentDB。
 *   3. SceneRunner.start(plan.instance.instanceId)。
 *   4. 玩家选择 choiceId 后，SceneRunner.end 返回 effects。
 *   5. store 提交 effects，同时调用 resolveTemplateEventRecord 更新记录。
 */
import type { ContentDB } from "../content/loader";
import type { EventTemplate, GameEventContent, SceneContent } from "../content/schemas";
import type { GameTime } from "../calendar/time";
import type { TemplateEventRecord } from "../state/types";
import type { GameState } from "../state/types";
import type { RngFn } from "./templateEngine";
import { instantiateTemplate } from "./templateEngine";
import { synthesizeEventContent, synthesizeSceneContent } from "./templateSynth";

export interface TemplateMaterializationPlan {
  instance: {
    instanceId: string;
    templateId: string;
    participants: Record<string, string>;
    hiddenTruthId: string;
    generatedAtDayIndex: number;
  };
  event: GameEventContent;
  scene: SceneContent;
  /** 应原子写入 state 的字段补丁。 */
  nextStatePatch: {
    templateEventNextSeq: number;
    /** 新增记录，key = instanceId。 */
    newRecord: TemplateEventRecord;
  };
}

/**
 * 选出参与者、合成 event/scene，并计算 state 补丁。
 *
 * @param db          内容库（静态）
 * @param state       当前游戏状态
 * @param template    已选定的事件模板
 * @param locationId  事件发生地点 ID
 * @param rng         随机数生成器（可注入以支持确定性测试）
 * @param now         当前游戏时间（写入 generatedAt）
 * @returns           null 当候选池为空或约束无法满足时
 */
export function planTemplateEventMaterialization(
  db: ContentDB,
  state: GameState,
  template: EventTemplate,
  locationId: string,
  rng: RngFn,
  now: GameTime,
): TemplateMaterializationPlan | null {
  const nextSeq = state.templateEventNextSeq;
  const instance = instantiateTemplate(db, state, template, rng, nextSeq);
  if (!instance) return null;

  const event = synthesizeEventContent(template, instance);
  const scene = synthesizeSceneContent(db, state, template, instance, locationId);

  const newRecord: TemplateEventRecord = {
    id: instance.instanceId,
    templateId: instance.templateId,
    participants: instance.participants,
    hiddenTruthId: instance.hiddenTruthId,
    generatedAt: now,
    status: "generated",
  };

  return {
    instance,
    event,
    scene,
    nextStatePatch: {
      templateEventNextSeq: nextSeq + 1,
      newRecord,
    },
  };
}

/**
 * 将 TemplateEventRecord 标记为 resolved（不可变方式，返回新记录）。
 *
 * 调用方应将返回值写入 state.templateEventRecords[instanceId]，
 * 与 effects / eventLog / sceneHistory 写入置于同一原子事务中。
 */
export function resolveTemplateEventRecord(
  record: TemplateEventRecord,
  selectedChoiceId: string,
  resolvedAt: GameTime,
): TemplateEventRecord {
  return {
    ...record,
    status: "resolved",
    selectedChoiceId,
    resolvedAt,
  };
}
