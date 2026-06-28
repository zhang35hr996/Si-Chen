/**
 * 模板合成层（event-template-system）。
 *
 * 将 EventInstance + EventTemplate 合成为标准 GameEventContent + SceneContent，
 * 使现有 SceneRunner 可以无修改地驱动模板事件。
 *
 * 合成规则：
 *   - 每个 EventInstance 生成唯一的 eventId（= instance.instanceId）和 sceneId
 *   - 场景由 3 层节点构成：
 *       opening_line  →  choice_node  →  effect_n / response_n（各 choice 一条分支）
 *   - {roleId} 占位符在 text 字段中替换为实际角色名（via nameMap）
 *   - 模板化效果（TemplateEffect）转换为标准 EventEffect（role → charId）
 *   - 记忆条目中的 subjectIds 如果匹配 roleId 也做替换
 */
import type { ContentDB } from "../content/loader";
import type {
  EventEffect,
  EventTemplate,
  GameEventContent,
  SceneContent,
  SceneNode,
  TemplateEffect,
  TemplateMemoryEntry,
  TemplateOutcome,
} from "../content/schemas";
import type { GameState } from "../state/types";
import type { EventInstance } from "./templateEngine";
import { resolvePromptEntityName } from "../dialogue/promptPayload";

// ── RuntimeContentDB ──────────────────────────────────────────────────

/**
 * ContentDB 的运行时可变扩展层，允许注入合成 event/scene。
 * 通过 spread 创建（非 Object.freeze），TypeScript 结构兼容 ContentDB，
 * 现有 SceneRunner / resolveEvent 等无需修改即可使用。
 */
export type RuntimeContentDB = ContentDB & {
  events: Record<string, GameEventContent>;
  scenes: Record<string, SceneContent>;
};

/** 从冻结 ContentDB 创建可注入的运行时包装，events/scenes 做浅拷贝以允许写入。 */
export function createRuntimeDB(base: ContentDB): RuntimeContentDB {
  return {
    ...base,
    events: { ...base.events },
    scenes: { ...base.scenes },
  };
}

/** 将合成的 event+scene 注入 RuntimeContentDB（幂等：重复注入同 id 会覆盖）。 */
export function injectTemplateContent(
  runtimeDB: RuntimeContentDB,
  event: GameEventContent,
  scene: SceneContent,
): void {
  runtimeDB.events[event.id] = event;
  runtimeDB.scenes[scene.id] = scene;
}

// ── 角色名映射 ────────────────────────────────────────────────────────

/** 将 {roleId} 占位符替换为实际角色显示名。 */
function substituteRoles(text: string, nameMap: Record<string, string>): string {
  return text.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, roleId: string) => {
    return nameMap[roleId] ?? match;
  });
}

function buildNameMap(
  db: ContentDB,
  state: GameState,
  participants: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [roleId, charId] of Object.entries(participants)) {
    map[roleId] = resolvePromptEntityName(charId, db, state);
  }
  return map;
}

// ── TemplateEffect → EventEffect ─────────────────────────────────────

function resolveRole(roleId: string, participants: Record<string, string>): string {
  return participants[roleId] ?? roleId;
}

/** 将单个模板效果转换为标准 EventEffect，role → 实际 charId。 */
function resolveTemplateEffect(
  effect: TemplateEffect,
  participants: Record<string, string>,
): EventEffect {
  switch (effect.type) {
    case "favor":
      return { type: "favor", char: resolveRole(effect.role, participants), delta: effect.delta };
    case "adjust_consort_attr":
      return {
        type: "adjust_consort_attr",
        char: resolveRole(effect.role, participants),
        field: effect.field,
        delta: effect.delta,
      };
    case "resource":
      // resource 效果不含 role，字段值在内容层已 authored，cast 安全。
      return { type: "resource", pillar: effect.pillar, field: effect.field, delta: effect.delta } as EventEffect;
    case "flag":
      return { type: "flag", key: effect.key, value: effect.value };
  }
}

/**
 * 将模板记忆条目转换为 memory EventEffect，subjectIds 中的 roleId 占位符替换为实际 charId。
 */
function resolveTemplateMemory(
  entry: TemplateMemoryEntry,
  participants: Record<string, string>,
  nameMap: Record<string, string>,
): EventEffect {
  const charId = resolveRole(entry.forRole, participants);
  const subjectIds = entry.entry.subjectIds.map((id) =>
    id === "player" ? "player" : (participants[id] ?? id),
  );
  return {
    type: "memory",
    char: charId,
    entry: {
      ...entry.entry,
      summary: substituteRoles(entry.entry.summary, nameMap),
      subjectIds,
    },
  };
}

/** 将一个 outcome 的全部 effects + memories 转换为 EventEffect[]。 */
export function resolveOutcomeEffects(
  outcome: TemplateOutcome,
  participants: Record<string, string>,
  nameMap: Record<string, string> = {},
): EventEffect[] {
  const effects: EventEffect[] = outcome.effects.map((e) =>
    resolveTemplateEffect(e, participants),
  );
  const memories: EventEffect[] = outcome.memories.map((m) =>
    resolveTemplateMemory(m, participants, nameMap),
  );
  return [...effects, ...memories];
}

// ── Scene 合成 ────────────────────────────────────────────────────────

/**
 * 合成 SceneContent。结构：
 *   n_open (line, speaker="narrator" 或指定角色)
 *     → n_choice (choice)
 *       → n_fx_{choiceId} (effect)  [optional n_resp_{choiceId} (line)]
 */
export function synthesizeSceneContent(
  db: ContentDB,
  state: GameState,
  template: EventTemplate,
  instance: EventInstance,
  locationId: string,
): SceneContent {
  const { participants } = instance;
  const nameMap = buildNameMap(db, state, participants);

  const nodes: SceneNode[] = [];

  // 开场段：narration mode → narration 节点（无 speaker）；dialogue mode → line 节点
  const opening = template.openingNarration;
  const openText = substituteRoles(opening.text, nameMap);
  if (opening.mode === "narration") {
    nodes.push({ type: "narration", id: "n_open", text: openText, next: "n_choice" });
  } else {
    nodes.push({
      type: "line",
      id: "n_open",
      speaker: participants[opening.speakerRole] ?? opening.speakerRole,
      text: openText,
      next: "n_choice",
    });
  }

  // 选项节点
  nodes.push({
    type: "choice",
    id: "n_choice",
    choices: template.choices.map((c) => ({
      id: c.id,
      text: c.text,
      tone: c.tone,
      next: `n_fx_${c.id}`,
    })),
  });

  // 每个选项的效果节点 + 可选回应台词
  for (const choice of template.choices) {
    const outcome = template.outcomes.find((o) => o.choiceId === choice.id);
    const effects = outcome ? resolveOutcomeEffects(outcome, participants, nameMap) : [];

    const hasResponse = !!outcome?.responseLine;
    const nextAfterEffect = hasResponse ? `n_resp_${choice.id}` : undefined;

    nodes.push({
      type: "effect",
      id: `n_fx_${choice.id}`,
      effects: effects.length > 0 ? effects : [{ type: "flag", key: `tpl_${template.id}_played`, value: true }],
      next: nextAfterEffect,
    });

    if (outcome?.responseLine) {
      const rl = outcome.responseLine;
      const speakerId = participants[rl.role] ?? rl.role;
      const responseText = substituteRoles(rl.text, nameMap);
      nodes.push({
        type: "line",
        id: `n_resp_${choice.id}`,
        speaker: speakerId,
        text: responseText,
        expression: rl.expression,
        // no next = terminal
      });
    }
  }

  const participantIds = Object.values(participants).filter((v): v is string => !!v);

  return {
    id: instance.instanceId,
    locationId,
    participants: participantIds.length > 0 ? participantIds : ["player"],
    startNodeId: "n_open",
    nodes,
  };
}

// ── Event 合成 ────────────────────────────────────────────────────────

/**
 * 合成 GameEventContent。condition 永远为 { flagSet: "..." } 始终 false
 * （实例已被选中，不再通过 condition 筛选），once: false，checkpoint 透传自模板。
 */
export function synthesizeEventContent(
  template: EventTemplate,
  instance: EventInstance,
): GameEventContent {
  // 合成事件的 condition 设为始终满足（flagSet 用不存在的 key 永不成立），
  // 因为引擎已在 instantiateTemplate 阶段完成 triggerCondition 检查。
  // 实际上合成事件只通过 store 直接 start，不走 getEligibleEvents 流程。
  // Map template presentation → GameEventContent presentation.
  // Template exploration requires subLocationId (enforced by schema) so cast is safe.
  type GamePresentation = GameEventContent["presentation"];
  let presentation: GamePresentation;
  if (template.presentation) {
    const tp = template.presentation;
    if (tp.mode === "exploration") {
      presentation = {
        mode: "exploration",
        hostLocationId: tp.hostLocationId,
        subLocationId: tp.subLocationId, // required by template schema
        ...(tp.eventHint ? { eventHint: tp.eventHint } : {}),
      };
    } else {
      presentation = tp;
    }
  }

  return {
    id: instance.instanceId,
    title: template.title,
    sceneId: instance.instanceId,
    checkpoint: template.checkpoint,
    condition: { flagSet: `__always_false_${instance.instanceId}` },
    priority: template.basePriority,
    once: false,
    apCost: template.apCost,
    ...(presentation! ? { presentation } : {}),
  };
}

// ── 一步完成 ─────────────────────────────────────────────────────────

/**
 * 便捷函数：合成 event + scene，注入 RuntimeContentDB，返回已注入的 eventId。
 * 调用方通过 eventId 启动 SceneRunner。
 */
export function injectInstance(
  db: ContentDB,
  state: GameState,
  runtimeDB: RuntimeContentDB,
  template: EventTemplate,
  instance: EventInstance,
  locationId: string,
): string {
  const event = synthesizeEventContent(template, instance);
  const scene = synthesizeSceneContent(db, state, template, instance, locationId);
  injectTemplateContent(runtimeDB, event, scene);
  return event.id;
}
