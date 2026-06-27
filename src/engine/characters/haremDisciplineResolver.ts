/**
 * 后宫内部惩戒原子结算与御前裁断（PUNISH-4G-B）。
 *
 * resolveHaremDisciplineOccurrence — 月结算时由 planHaremDiscipline 的计划触发；
 *                                    写入 CourtEvent + memories + incident（pending_response）。
 * resolveHaremDiscipline            — 玩家御前裁断；写入裁断属性效果 + 决议 event + memories +
 *                                    incident.status=resolved。
 *
 * 两者均原子：全成功或全回滚（返回 err）。
 * 不写 JusticeState，不写 PunishmentRecord，不改 treasury。
 */
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import type {
  GameState,
  HaremDisciplineIncident,
  HaremDisciplineKind,
  HaremDisciplineResolution,
} from "../state/types";
import { toGameTime } from "../calendar/time";
import { err, ok, type Result } from "../infra/result";
import { stateError, type GameError } from "../infra/errors";
import { appendCourtEvent } from "../chronicle/append";
import { applyEffects } from "../effects/funnel";
import type { HaremDisciplinePlan } from "./haremDisciplinePlanner";

// ── 内部工具 ──────────────────────────────────────────────────────────────────

function incidentId(year: number, month: number): string {
  return `hdi_${year}_${String(month).padStart(2, "0")}`;
}

function disciplinePublicity(
  kind: HaremDisciplineKind,
  actorId: string,
  targetId: string,
): { publicity: GameState["chronicle"][0]["publicity"]; publicSalience: number } {
  if (kind === "copy_scripture") {
    return { publicity: { scope: "circle", circleIds: [actorId, targetId] }, publicSalience: 0 };
  }
  return {
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: kind === "slapping" ? 60 : 30,
  };
}

// ── 发生时原子结算 ────────────────────────────────────────────────────────────

export function resolveHaremDisciplineOccurrence(
  db: ContentDB,
  state: GameState,
  plan: HaremDisciplinePlan,
): Result<{ state: GameState; incident: HaremDisciplineIncident }, GameError[]> {
  const { actorId, targetId, disciplineKind, actorSnapshot, targetSnapshot, healthDelta } = plan;
  const now = toGameTime(state.calendar);
  const id = incidentId(now.year, now.month);

  // Guard: 同月同对不可重复。
  if (state.haremDisciplineIncidents.some((i) => i.id === id)) {
    return err([stateError("DUPLICATE_INCIDENT", `harem discipline incident ${id} already exists`)]);
  }

  // 1) 应用健康变化（仅 kneeling / slapping，且必须非致死）。
  //    favor / affection / fear / loyalty 全部留到御前裁断阶段，不在事件发生时提前改变。
  let cur = state;
  if (healthDelta !== 0) {
    const effResult = applyEffects(db, state, [{ type: "set_consort_health", char: targetId, healthDelta }], {
      allowInternalEffects: true,
    });
    if (!effResult.ok) return err(effResult.error);
    cur = effResult.value;
  }

  // 2) 追加 CourtEvent。
  const { publicity, publicSalience } = disciplinePublicity(disciplineKind, actorId, targetId);
  const evtDraft = {
    type: "conflict" as const,
    occurredAt: now,
    participants: [
      { charId: actorId, role: "discipliner" },
      { charId: targetId, role: "disciplined" },
    ],
    locationId: cur.standing[targetId]?.residence ?? undefined,
    payload: {
      subtype: "harem_discipline",
      incidentId: id,
      disciplineKind,
      actorRankId: actorSnapshot.rankId,
      targetRankId: targetSnapshot.rankId,
    },
    publicity,
    publicSalience,
    retention: "slow" as const,
    tags: ["harem_discipline", disciplineKind, "palace_conflict"],
  };
  const evtResult = appendCourtEvent(cur, evtDraft);
  if (!evtResult.ok) return err(evtResult.error);
  const { state: afterEvt, event } = evtResult.value;
  cur = afterEvt;

  // 4) 追加记忆效果（actor + target）。
  const memEffects: EventEffect[] = [
    {
      type: "memory",
      char: actorId,
      entry: {
        kind: "episodic",
        summary:
          disciplineKind === "slapping"
            ? "曾命其掌嘴受罚，以整肃宫规"
            : disciplineKind === "kneeling"
              ? "曾命其罚跪，以示训诫"
              : "曾命其抄写经文",
        subjectIds: [targetId],
        perspective: "actor",
        strength: 60,
        retention: "slow" as const,
        triggerTags: ["harem_discipline", disciplineKind],
        unresolved: false,
        emotions: { joy: 30 },
        sourceEventId: event.id,
      },
    },
    {
      type: "memory",
      char: targetId,
      entry: {
        kind: disciplineKind === "slapping" ? "trauma" : "episodic",
        summary:
          disciplineKind === "slapping"
            ? "被施罚者掌嘴，颜面尽失，羞耻难当"
            : disciplineKind === "kneeling"
              ? "被施罚者责令罚跪，委屈不平"
              : "被施罚者命令抄写经文，心中不忿",
        subjectIds: [actorId],
        perspective: "target",
        strength: disciplineKind === "slapping" ? 80 : disciplineKind === "kneeling" ? 55 : 35,
        retention: disciplineKind === "slapping" ? "permanent" : ("slow" as const),
        triggerTags: ["harem_discipline", disciplineKind, "humiliation"],
        unresolved: true,
        emotions:
          disciplineKind === "slapping"
            ? { shame: 80, anger: 60, fear: 50 }
            : disciplineKind === "kneeling"
              ? { shame: 50, anger: 40, fear: 30 }
              : { anger: 25, shame: 20 },
        sourceEventId: event.id,
      },
    },
  ];

  const memResult = applyEffects(db, cur, memEffects);
  if (!memResult.ok) return err(memResult.error);
  cur = memResult.value;

  // 5) 写入 incident。
  const incident: HaremDisciplineIncident = {
    id,
    actorId,
    targetId,
    disciplineKind,
    occurredAt: now,
    actorSnapshot,
    targetSnapshot,
    courtEventId: event.id,
    status: "pending_response",
  };
  cur = { ...cur, haremDisciplineIncidents: [...cur.haremDisciplineIncidents, incident] };

  return ok({ state: cur, incident });
}

// ── 御前裁断 ──────────────────────────────────────────────────────────────────

export interface ResolveHaremDisciplineInput {
  incidentId: string;
  resolution: HaremDisciplineResolution;
}

/**
 * 玩家御前裁断。
 *
 * upheld       — 维持处分：actor favor+2 / affection+3 / ambition+2；target favor-2 / affection-6 / fear+4
 * protected    — 回护受罚者：actor favor-3 / affection-6 / fear+5；target favor+3 / affection+5
 * rebuked_both — 各自申饬：actor favor-1 / affection-2 / fear+3；target affection-1 / fear+2
 *
 * 顺序：先应用属性效果 → 追加裁断 CourtEvent → 写入裁断记忆（sourceEventId=裁断事件）→ 持久化 resolutionEventId。
 */
export function resolveHaremDiscipline(
  db: ContentDB,
  state: GameState,
  input: ResolveHaremDisciplineInput,
): Result<GameState, GameError[]> {
  const incident = state.haremDisciplineIncidents.find((i) => i.id === input.incidentId);
  if (!incident) {
    return err([stateError("NOT_FOUND", `harem discipline incident ${input.incidentId} not found`)]);
  }
  if (incident.status !== "pending_response") {
    return err([stateError("ALREADY_RESOLVED", `incident ${input.incidentId} is already resolved`)]);
  }

  const { actorId, targetId } = incident;
  const now = toGameTime(state.calendar);

  // 1) 应用属性效果（favor / affection / fear / ambition）。
  const attrEffects: EventEffect[] = [];
  switch (input.resolution) {
    case "upheld":
      attrEffects.push(
        { type: "favor", char: actorId, delta: 2 },
        { type: "adjust_consort_attr", char: actorId, field: "affection", delta: 3 },
        { type: "adjust_consort_attr", char: actorId, field: "ambition", delta: 2 },
        { type: "favor", char: targetId, delta: -2 },
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: -6 },
        { type: "adjust_consort_attr", char: targetId, field: "fear", delta: 4 },
      );
      break;
    case "protected":
      attrEffects.push(
        { type: "favor", char: actorId, delta: -3 },
        { type: "adjust_consort_attr", char: actorId, field: "affection", delta: -6 },
        { type: "adjust_consort_attr", char: actorId, field: "fear", delta: 5 },
        { type: "favor", char: targetId, delta: 3 },
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: 5 },
      );
      break;
    case "rebuked_both":
      attrEffects.push(
        { type: "favor", char: actorId, delta: -1 },
        { type: "adjust_consort_attr", char: actorId, field: "affection", delta: -2 },
        { type: "adjust_consort_attr", char: actorId, field: "fear", delta: 3 },
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: -1 },
        { type: "adjust_consort_attr", char: targetId, field: "fear", delta: 2 },
      );
      break;
  }

  const attrResult = applyEffects(db, state, attrEffects);
  if (!attrResult.ok) return err(attrResult.error);
  let cur = attrResult.value;

  // 2) 追加裁断 CourtEvent（记忆必须在此之后创建，以获取 resolutionEvent.id）。
  const evtDraft = {
    type: "conflict" as const,
    occurredAt: now,
    participants: [
      { charId: "player", role: "arbitrator" },
      { charId: actorId, role: "discipliner" },
      { charId: targetId, role: "disciplined" },
    ],
    payload: {
      subtype: "harem_discipline_resolution",
      incidentId: incident.id,
      resolution: input.resolution,
      disciplineKind: incident.disciplineKind,
    },
    publicity: { scope: "palace" as const, persistence: "contemporaneous" as const },
    publicSalience: 50,
    retention: "slow" as const,
    tags: ["harem_discipline", "imperial_ruling", input.resolution],
  };
  const evtResult = appendCourtEvent(cur, evtDraft);
  if (!evtResult.ok) return err(evtResult.error);
  const { state: afterEvt, event: resolutionEvent } = evtResult.value;
  cur = afterEvt;

  // 3) 裁断记忆（sourceEventId 指向裁断事件，而非发生事件）。
  const memEffects: EventEffect[] = [
    {
      type: "memory",
      char: actorId,
      entry: {
        kind: "episodic",
        summary:
          input.resolution === "upheld"
            ? "陛下维持了这场处分，所施之罚得以彰显"
            : input.resolution === "protected"
              ? "陛下回护了受罚者，心中难免委屈不平"
              : "陛下对此事各自申饬，颜面有所折损",
        subjectIds: ["player", targetId],
        perspective: "actor",
        strength: 65,
        retention: "slow" as const,
        triggerTags: ["harem_discipline", "imperial_ruling"],
        unresolved: input.resolution !== "upheld",
        emotions:
          input.resolution === "upheld"
            ? { joy: 40 }
            : input.resolution === "protected"
              ? { anger: 50, shame: 30 }
              : { fear: 35, anger: 20 },
        sourceEventId: resolutionEvent.id,
      },
    },
    {
      type: "memory",
      char: targetId,
      entry: {
        kind: "episodic",
        summary:
          input.resolution === "protected"
            ? "陛下亲自回护，委屈终得舒解"
            : input.resolution === "upheld"
              ? "陛下维持了施罚者的处置，甚是心寒"
              : "陛下对此事各自申饬，尚有些许告慰",
        subjectIds: ["player", actorId],
        perspective: "target",
        strength: 70,
        retention: "slow" as const,
        triggerTags: ["harem_discipline", "imperial_ruling"],
        unresolved: input.resolution === "upheld",
        emotions:
          input.resolution === "protected"
            ? { relief: 70, joy: 40 }
            : input.resolution === "upheld"
              ? { anger: 40, grief: 30, fear: 20 }
              : { relief: 30, fear: 25 },
        sourceEventId: resolutionEvent.id,
      },
    },
  ];

  const memResult = applyEffects(db, cur, memEffects);
  if (!memResult.ok) return err(memResult.error);
  cur = memResult.value;

  // 4) 更新 incident（持久化 resolutionEventId）。
  cur = {
    ...cur,
    haremDisciplineIncidents: cur.haremDisciplineIncidents.map((i) =>
      i.id === input.incidentId
        ? {
            ...i,
            status: "resolved" as const,
            resolution: input.resolution,
            resolvedAt: now,
            resolutionEventId: resolutionEvent.id,
          }
        : i,
    ),
  };

  return ok(cur);
}
