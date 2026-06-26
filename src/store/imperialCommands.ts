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
import { eligibleHaremAdministrators } from "../engine/characters/haremAdministration";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { CourtEvent, GameState } from "../engine/state/types";

/** 皇后禁足时必须指定六宫主理者。 */
export type HaremAdministratorChoice =
  | { kind: "consort"; charId: string }
  | { kind: "neiwu_proxy" };

export type ImperialCommand =
  | {
      type: "impose_confinement";
      targetId: string;
      durationTurns: number | null;
      /** 皇后禁足时必须携带，指定接管六宫主理的人选；普通侍君禁足时不需要。 */
      administrator?: HaremAdministratorChoice;
      /** 当目标为当前协理者且存在其他合格候选时，须指定接任者。 */
      administratorReplacement?: HaremAdministratorChoice;
    }
  | { type: "lift_confinement"; targetId: string }
  | {
      type: "execute";
      targetId: string;
      /** 当目标为当前协理者且存在其他合格候选时，须指定接任者。 */
      administratorReplacement?: HaremAdministratorChoice;
    };

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

/**
 * 当目标是当前协理者时，校验并组装接任效果。
 *   - 若不存在其他合格候选 → 自动切内务府（无需玩家选择，直接返回效果）。
 *   - 若存在合格候选 → 必须提供 replacement，否则校验失败。
 */
function resolveActingAdminReplacement(
  db: ContentDB,
  state: GameState,
  charId: string,
  replacement: HaremAdministratorChoice | undefined,
  now: ReturnType<typeof toGameTime>,
): { ok: true; effect: import("../engine/content/schemas").EventEffect | null; note: string } | { ok: false; reason: string } {
  const admin = state.haremAdministration;
  if (admin.mode !== "acting_consort" || admin.charId !== charId) {
    return { ok: true, effect: null, note: "" };
  }
  // 合格接任候选（排除即将失格的当前协理者本身）。
  const eligible = eligibleHaremAdministrators(db, state).filter((c) => c.id !== charId);
  if (eligible.length === 0) {
    // 无候选 → 自动切内务府，无需玩家选。
    return {
      ok: true,
      effect: { type: "set_harem_administration", state: { mode: "neiwu_proxy", appointedAt: now, reason: "no_eligible_consort" } },
      note: "内务府总管暂代宫务。",
    };
  }
  // 有候选 → 玩家必须指定接任者。
  if (!replacement) {
    return { ok: false, reason: "现任协理者将失格，须指定新的六宫主理者。" };
  }
  if (replacement.kind === "neiwu_proxy") {
    return { ok: false, reason: "宫中尚有驸级以上侍君可接任，须选择侍君协理。" };
  }
  const chosen = eligible.find((c) => c.id === replacement.charId);
  if (!chosen) {
    return { ok: false, reason: "所选接任者不符合协理六宫资格。" };
  }
  const replacementName = targetName(db, state, replacement.charId);
  return {
    ok: true,
    effect: {
      type: "set_harem_administration",
      state: { mode: "acting_consort", charId: replacement.charId, appointedAt: now, reason: "empress_confined" },
    },
    note: `${replacementName}接任协理六宫。`,
  };
}

/**
 * 目标必须是仍存活、有 standing 的侍君。
 * 注意：皇后可以被禁足/解除禁足；仅赐死按 command type 单独禁止。
 */
function consortGate(db: ContentDB, state: GameState, charId: string): string | null {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const st = state.standing[charId];
  if (!char || char.kind !== "consort" || !st) return "此人非可处置的侍君。";
  if (st.lifecycle === "deceased") return "斯人已逝，无从处置。";
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
  const st = state.standing[charId]!;
  const isEmpress = st.rank === "huanghou";

  if (command.type === "impose_confinement") {
    if (isConfined(state, charId)) return { ok: false, reason: `${name}已在禁足中。` };
    if (command.durationTurns !== null && command.durationTurns <= 0) {
      return { ok: false, reason: "禁足期限无效。" };
    }

    const startTurn = state.calendar.dayIndex;
    const endTurnExclusive = command.durationTurns === null ? null : startTurn + command.durationTurns;
    const indefinite = command.durationTurns === null;

    // ── 皇后禁足：必须携带六宫主理选择 ─────────────────────────────────
    if (isEmpress) {
      const eligible = eligibleHaremAdministrators(db, state);
      const admin = command.administrator;

      if (!admin) {
        return { ok: false, reason: "皇后禁足须同时指定六宫主理者。" };
      }
      if (admin.kind === "neiwu_proxy" && eligible.length > 0) {
        return { ok: false, reason: "宫中尚有驸级以上侍君，须指定侍君协理六宫，不得直接选择内务府代理。" };
      }
      if (admin.kind === "consort") {
        const chosen = eligible.find((c) => c.id === admin.charId);
        if (!chosen) {
          return { ok: false, reason: "所选侍君不符合协理六宫资格。" };
        }
      }

      // 组装管理权效果
      const adminName =
        admin.kind === "consort"
          ? targetName(db, state, admin.charId)
          : "内务府总管";

      const adminState =
        admin.kind === "consort"
          ? ({ mode: "acting_consort", charId: admin.charId, appointedAt: now, reason: "empress_confined" } as const)
          : ({ mode: "neiwu_proxy", appointedAt: now, reason: "no_eligible_consort" } as const);

      const effects: EventEffect[] = [
        {
          type: "confine",
          char: charId,
          startTurn,
          endTurnExclusive,
          imposedAt: now,
          ...(source ? { sourceLocation: source } : {}),
        },
        { type: "set_harem_administration", state: adminState },
        {
          type: "memory",
          char: charId,
          entry: {
            kind: "trauma",
            summary: indefinite
              ? "臣被皇帝下旨禁足，无诏不得出。"
              : "臣被皇帝下旨禁足，闭锁宫中，不得擅出。",
            strength: 90,
            retention: "permanent",
            subjectIds: [SOVEREIGN, charId],
            perspective: "target",
            triggerTags: [SOVEREIGN, "confinement"],
            unresolved: true,
            emotions: { fear: 45, shame: 35 },
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
          publicSalience: 90,
          retention: "permanent",
          tags: ["imperial_decree", "confinement", "empress"],
        },
        {
          type: "punished",
          occurredAt: now,
          participants: [
            ...(admin.kind === "consort" ? [{ charId: admin.charId, role: "appointed_administrator" as const }] : []),
          ],
          payload: {
            decree: admin.kind === "consort" ? "harem_administrator_appointed" : "neiwu_proxy_appointed",
            administrator: admin,
          },
          publicity: { scope: "palace", persistence: "institutional" },
          publicSalience: 80,
          retention: "permanent",
          tags: ["imperial_decree", "harem_administration"],
        },
      ];
      const adminLine =
        admin.kind === "consort"
          ? `${adminName}奉旨协理六宫，暂掌后宫诸事。`
          : "内务府总管奉旨暂代宫务。";
      return {
        ok: true,
        plan: {
          command,
          charId,
          effects,
          chronicle,
          lines: [`${name}惶恐领旨，自此闭锁宫中。${adminLine}`],
        },
      };
    }

    // ── 普通侍君禁足 ──────────────────────────────────────────────────
    // 若目标是当前协理者，须处理接任问题。
    const repResult = resolveActingAdminReplacement(db, state, charId, command.administratorReplacement, now);
    if (!repResult.ok) return { ok: false, reason: repResult.reason };

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
      ...(repResult.effect ? [repResult.effect] : []),
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
    const repNote = repResult.note ? ` ${repResult.note}` : "";
    return {
      ok: true,
      plan: { command, charId, effects, chronicle, lines: [`${name}惶恐领旨，自此闭锁宫中。${repNote}`] },
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

    // 皇后禁足解除：附加「复掌六宫」编年史
    if (isEmpress) {
      chronicle.push({
        type: "punished",
        occurredAt: now,
        participants: [{ charId, role: "confined" }],
        payload: { decree: "empress_administration_restored", targetId: charId },
        publicity: { scope: "palace", persistence: "institutional" },
        publicSalience: 70,
        retention: "permanent",
        tags: ["imperial_decree", "harem_administration", "empress_restored"],
      });
    }

    return {
      ok: true,
      plan: { command, charId, effects, chronicle, lines: [`${name}叩首谢恩。`] },
    };
  }

  // execute — 赐死皇后在本次范围外明确禁止。
  if (isEmpress) {
    return { ok: false, reason: "皇后不受赐死之令。" };
  }

  // 若目标是当前协理者，须处理接任问题。
  const execRepResult = resolveActingAdminReplacement(db, state, charId, command.administratorReplacement, now);
  if (!execRepResult.ok) return { ok: false, reason: execRepResult.reason };

  // execute — 走统一死亡管线（consort_decease + enqueue_aftermath），并附结构化赐死史。
  const aftermathId = `death:consort:${charId}:${now.dayIndex}`;
  const effects: EventEffect[] = [
    { type: "consort_decease", char: charId, at: now, cause: "imperial_execution" },
    { type: "enqueue_aftermath", id: aftermathId, kind: "consort", subjectId: charId, at: now },
    ...(execRepResult.effect ? [execRepResult.effect] : []),
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
  const execRepNote = execRepResult.note ? ` ${execRepResult.note}` : "";
  return {
    ok: true,
    plan: { command, charId, effects, chronicle, lines: [`${name}领旨谢恩，香消玉殒。${execRepNote}`] },
  };
}
