/**
 * 皇帝指令层（任务 §10）。禁足 / 解除禁足 / 赐死统一在此组装为
 * （效果批 + 编年史草稿 + 反应台词），紫宸殿与侍君宫殿两个 UI 入口只调用这里，
 * 绝不在 React 组件里直接拼装存档对象。位分调整仍复用 buildRankOp（rankOps.ts）。
 *
 * 执行（原子更新 + 写史 + 防重复）由 GameStore.applyImperialCommand 完成；本模块
 * 只做纯函数校验与组装，返回判别结果供 UI 直接展示。
 */
import { toGameTime } from "../engine/calendar/time";
import { isConfined } from "../engine/characters/confinement";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { CourtEvent, GameState } from "../engine/state/types";

export type ImperialCommand =
  | { type: "impose_confinement"; targetId: string; durationTurns: number | null }
  | { type: "lift_confinement"; targetId: string }
  | { type: "execute"; targetId: string };

export interface ImperialCommandPlan {
  command: ImperialCommand;
  charId: string;
  /** 走漏斗的原子效果批。 */
  effects: EventEffect[];
  /** 重大惩罚的结构化编年史草稿（GameStore 负责 append 派 id）。 */
  chronicle: Omit<CourtEvent, "id">[];
  /** UI 反应缝隙重放的台词。 */
  lines: string[];
}

export type ImperialCommandResult =
  | { ok: true; plan: ImperialCommandPlan }
  | { ok: false; reason: string };

const SOVEREIGN = "player";

function targetName(db: ContentDB, state: GameState, charId: string): string {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const st = state.standing[charId];
  if (!char) return charId;
  return resolveDisplayName(char, st, st ? db.ranks[st.rank] : undefined);
}

/** 目标必须是仍存活、有 standing 的侍君。返回错误文案或 null（合法）。 */
function consortGate(db: ContentDB, state: GameState, charId: string): string | null {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const st = state.standing[charId];
  if (!char || char.kind !== "consort" || !st) return "此人非可处置的侍君。";
  if (st.lifecycle === "deceased") return "斯人已逝，无从处置。";
  if (st.rank === "fenghou") return "凤后不受此令。";
  return null;
}

export function planImperialCommand(
  db: ContentDB,
  state: GameState,
  command: ImperialCommand,
): ImperialCommandResult {
  const charId = command.targetId;
  const gate = consortGate(db, state, charId);
  if (gate) return { ok: false, reason: gate };

  const now = toGameTime(state.calendar);
  const name = targetName(db, state, charId);
  const source = state.playerLocation || undefined;

  if (command.type === "impose_confinement") {
    if (isConfined(state, charId)) return { ok: false, reason: `${name}已在禁足中。` };
    if (command.durationTurns !== null && command.durationTurns <= 0) {
      return { ok: false, reason: "禁足期限无效。" };
    }
    const startTurn = state.calendar.dayIndex; // 当前旬即第一旬
    const endTurnExclusive = command.durationTurns === null ? null : startTurn + command.durationTurns;
    const indefinite = command.durationTurns === null;
    const effects: EventEffect[] = [
      {
        type: "confine",
        char: charId,
        startTurn,
        endTurnExclusive,
        imposedAt: now,
        ...(source ? { sourceLocation: source } : {}),
      },
      {
        type: "memory",
        char: charId,
        entry: {
          kind: "trauma",
          summary: indefinite
            ? "臣被皇帝下旨禁足，无诏不得出。"
            : "臣被皇帝下旨禁足，闭锁宫中，不得擅出。",
          strength: 75,
          retention: "permanent",
          subjectIds: [SOVEREIGN, charId],
          perspective: "target",
          triggerTags: [SOVEREIGN, "confinement"],
          unresolved: true,
          emotions: { fear: 35, shame: 25 },
        },
      },
    ];
    const chronicle: Omit<CourtEvent, "id">[] = [
      {
        type: "punished",
        occurredAt: now,
        participants: [{ charId, role: "confined" }],
        ...(source ? { locationId: source } : {}),
        payload: {
          decree: "confinement_imposed",
          targetId: charId,
          startTurn,
          endTurnExclusive,
          durationTurns: command.durationTurns,
          indefinite,
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 70,
        retention: "permanent",
        tags: ["imperial_decree", "confinement"],
      },
    ];
    return {
      ok: true,
      plan: { command, charId, effects, chronicle, lines: [`${name}惶恐领旨，自此闭锁宫中。`] },
    };
  }

  if (command.type === "lift_confinement") {
    if (!isConfined(state, charId)) return { ok: false, reason: `${name}当前并未禁足。` };
    const active = state.statusEffects.find(
      (e) => e.kind === "confinement" && e.characterId === charId && e.liftedTurn === undefined,
    );
    const effects: EventEffect[] = [
      { type: "lift_confinement", char: charId, at: now, reason: "lifted_by_emperor" },
      {
        type: "memory",
        char: charId,
        entry: {
          kind: "episodic",
          summary: "皇帝下旨解除臣的禁足，臣得以重见天日。",
          strength: 60,
          retention: "slow",
          subjectIds: [SOVEREIGN, charId],
          perspective: "target",
          triggerTags: [SOVEREIGN, "confinement_lifted"],
          unresolved: false,
          emotions: { relief: 35, joy: 20 },
        },
      },
    ];
    const chronicle: Omit<CourtEvent, "id">[] = [
      {
        type: "punished",
        occurredAt: now,
        participants: [{ charId, role: "confined" }],
        ...(source ? { locationId: source } : {}),
        payload: {
          decree: "confinement_lifted",
          targetId: charId,
          ...(active ? { originalConfinementId: active.id } : {}),
          reason: "lifted_by_emperor",
        },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 50,
        retention: "slow",
        tags: ["imperial_decree", "confinement_lifted"],
      },
    ];
    return {
      ok: true,
      plan: { command, charId, effects, chronicle, lines: [`${name}叩首谢恩。`] },
    };
  }

  // execute — 走统一死亡管线（consort_decease + enqueue_aftermath），并附结构化赐死史。
  const aftermathId = `death:consort:${charId}:${now.dayIndex}`;
  const effects: EventEffect[] = [
    { type: "consort_decease", char: charId, at: now, cause: "imperial_execution" },
    { type: "enqueue_aftermath", id: aftermathId, kind: "consort", subjectId: charId, at: now },
  ];
  const chronicle: Omit<CourtEvent, "id">[] = [
    {
      type: "punished",
      occurredAt: now,
      participants: [
        { charId, role: "executed" },
        { charId: SOVEREIGN, role: "ordered_by" },
      ],
      ...(source ? { locationId: source } : {}),
      payload: {
        decree: "execution",
        targetId: charId,
        cause: "imperial_execution",
        orderedBy: SOVEREIGN,
      },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 90,
      retention: "permanent",
      tags: ["imperial_decree", "execution"],
    },
  ];
  return {
    ok: true,
    plan: { command, charId, effects, chronicle, lines: [`${name}领旨谢恩，香消玉殒。`] },
  };
}
