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

  // 1) 组装效果列表。
  const effects: EventEffect[] = [];

  // 1a) 目标健康变化（仅 kneeling / slapping，且必须非致死）。
  if (healthDelta !== 0) {
    effects.push({
      type: "set_consort_health",
      char: targetId,
      healthDelta,
    });
  }

  // 1b) 目标恐惧上升。
  const fearDelta = disciplineKind === "slapping" ? 12 : disciplineKind === "kneeling" ? 7 : 3;
  effects.push({ type: "adjust_consort_attr", char: targetId, field: "fear", delta: fearDelta });

  // 1c) 目标好感下降。
  const affectionDelta = disciplineKind === "slapping" ? -15 : disciplineKind === "kneeling" ? -8 : -3;
  effects.push({ type: "adjust_consort_attr", char: targetId, field: "affection", delta: affectionDelta });

  // 1d) 施罚者目标忠诚小幅增加（威慑效果，仅对 kneeling/slapping）。
  if (disciplineKind !== "copy_scripture") {
    effects.push({ type: "adjust_consort_attr", char: actorId, field: "loyalty", delta: 3 });
  }

  // 2) 应用效果。
  const effResult = applyEffects(db, state, effects, { allowInternalEffects: true });
  if (!effResult.ok) return err(effResult.error);
  let cur = effResult.value;

  // 3) 追加 CourtEvent。
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
            ? "朕令其掌嘴受罚，威仪震慑宫闱"
            : disciplineKind === "kneeling"
              ? "朕令其罚跪，整肃后宫纲纪"
              : "朕令其抄写经文，以示训诫",
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
 * upheld        — 维持处分：施罚者忠诚+5；受罚者额外恐惧+8，好感−10。
 * protected     — 回护受罚者：受罚者好感+20，恐惧−5；施罚者好感−15，忠诚−8。
 * rebuked_both  — 各自申饬：施罚者恐惧+8，忠诚−5；受罚者恐惧+5，好感−5。
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
  const effects: EventEffect[] = [];

  switch (input.resolution) {
    case "upheld":
      effects.push(
        { type: "adjust_consort_attr", char: actorId, field: "loyalty", delta: 5 },
        { type: "adjust_consort_attr", char: targetId, field: "fear", delta: 8 },
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: -10 },
      );
      break;
    case "protected":
      effects.push(
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: 20 },
        { type: "adjust_consort_attr", char: targetId, field: "fear", delta: -5 },
        { type: "adjust_consort_attr", char: actorId, field: "affection", delta: -15 },
        { type: "adjust_consort_attr", char: actorId, field: "loyalty", delta: -8 },
      );
      break;
    case "rebuked_both":
      effects.push(
        { type: "adjust_consort_attr", char: actorId, field: "fear", delta: 8 },
        { type: "adjust_consort_attr", char: actorId, field: "loyalty", delta: -5 },
        { type: "adjust_consort_attr", char: targetId, field: "fear", delta: 5 },
        { type: "adjust_consort_attr", char: targetId, field: "affection", delta: -5 },
      );
      break;
  }

  // 裁断记忆。
  effects.push(
    {
      type: "memory",
      char: actorId,
      entry: {
        kind: "episodic",
        summary:
          input.resolution === "upheld"
            ? "陛下维持了朕的处分，威权得以彰显"
            : input.resolution === "protected"
              ? "陛下回护了受罚者，心中难免委屈不平"
              : "陛下对此事各打五十大板，颜面有所折损",
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
        sourceEventId: incident.courtEventId,
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
              ? "陛下维持了对朕的处分，甚是心寒"
              : "陛下对此事各打五十大板，尚有些许告慰",
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
        sourceEventId: incident.courtEventId,
      },
    },
  );

  const effResult = applyEffects(db, state, effects);
  if (!effResult.ok) return err(effResult.error);
  let cur = effResult.value;

  // 追加裁断 CourtEvent。
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
  cur = evtResult.value.state;

  // 更新 incident 状态。
  cur = {
    ...cur,
    haremDisciplineIncidents: cur.haremDisciplineIncidents.map((i) =>
      i.id === input.incidentId
        ? { ...i, status: "resolved" as const, resolution: input.resolution, resolvedAt: now }
        : i,
    ),
  };

  return ok(cur);
}
