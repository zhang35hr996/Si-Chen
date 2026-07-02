/**
 * 奉先殿抚养权核心逻辑。
 *
 * 职责：
 *   - eligibleCustodiansForHeir — 按皇嗣计算候选抚养人池
 *   - currentEligibleEmpress    — 当前正常皇后（可使皇嗣嫡出）
 *   - planHeirCustodyTransfer   — 纯函数，建构 effects/chronicle/reactions，不 mutate state
 *   - resolveHeirCustodyTransfer — 纯函数，apply effects + chronicle，供测试用
 *
 * 存储层原子事务由 GameStore.transferHeirCustodyAndAdvance 负责（扣 1 AP + settlePostAdvance）。
 */
import { isConfined } from "../engine/characters/confinement";
import { isInColdPalace } from "../engine/characters/coldPalace";
import {
  resolveCustodianAvailability,
  custodianUnlocksRecustody,
} from "../engine/characters/custodianAvailability";
export {
  resolveCustodianAvailability,
  custodianCanCareNow,
  custodianUnlocksRecustody,
  type CustodianAvailability,
  type CustodianAvailabilityResult,
} from "../engine/characters/custodianAvailability";
import { appendCourtEvent } from "../engine/chronicle/append";
import { applyEffects } from "../engine/effects/funnel";
import { stateError, type GameError } from "../engine/infra/errors";
import { err, ok, type Result } from "../engine/infra/result";
import { toGameTime } from "../engine/calendar/time";
import { resolveDisplayName } from "../engine/characters/standing";
import { getBiologicalParents } from "../engine/characters/parentage/parentageSelectors";
import type { ContentDB } from "../engine/content/loader";
import type { CharacterContent, EventEffect } from "../engine/content/schemas";
import type { ReactionBeat } from "../engine/punishments/types";
import type { CourtEvent, GameState, Heir } from "../engine/state/types";

// ── Candidate ────────────────────────────────────────────────────────────────

export interface CustodianCandidate {
  id: string;
  kind: "consort" | "elder";
  displayName: string;
  rankId?: string;
  becomesLegitimate: boolean;
}

// ── Command & Plan ───────────────────────────────────────────────────────────

export type CustodyTransferSource = "fengxiandian" | "birth" | "petition";

export interface HeirCustodyTransferCommand {
  heirId: string;
  toCustodianId: string;
  source: CustodyTransferSource;
}

export interface HeirCustodyTransferPlan {
  effects: EventEffect[];
  chronicle: Omit<CourtEvent, "id">[];
  reactions: ReactionBeat[];
  fromCustodianId?: string;
  toCustodianId: string;
  becomesLegitimate: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 当前正常皇后：rank=huanghou + 在宫 + 未亡 + 非候选 + 未禁足 + 不在冷宫（含 authored defaultLocation）。
 * 不可硬编码皇后 charId。
 */
export function currentEligibleEmpress(db: ContentDB, state: GameState): CharacterContent | null {
  for (const [id, st] of Object.entries(state.standing)) {
    if (st.rank !== "huanghou") continue;
    if (st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    if (isConfined(state, id)) continue;
    if (isInColdPalace(state, id)) continue;
    const char = db.characters[id] ?? state.generatedConsorts[id];
    if (!char || char.kind !== "consort") continue;
    if (char.defaultLocation === "changmengong") continue;
    return char;
  }
  return null;
}

/**
 * 按皇嗣计算合法候选抚养人池。
 * 已是当前抚养人者排除。lifecycle===alive 方有候选。
 * 嫡出皇嗣仅在现抚养人**身故或入冷宫**（造成死锁）时才解锁重新指定；否则锁定（返回空）。
 */
export function eligibleCustodiansForHeir(
  db: ContentDB,
  state: GameState,
  heir: Heir,
): CustodianCandidate[] {
  if (!heir || heir.lifecycle !== "alive") return [];
  if (heir.legitimate) {
    const { availability } = resolveCustodianAvailability(db, state, heir);
    if (!custodianUnlocksRecustody(availability)) return [];
    // 现抚养人身故/入冷宫 → 解锁重新指定（皇嗣保持嫡出，新抚养人不必皇后）。
  }

  const guirenOrder = db.ranks["guiren"]?.order ?? 116;
  const changzaiOrder = db.ranks["changzai"]?.order ?? 84;
  const currentCustodianId = heir.custodianId;
  const empress = currentEligibleEmpress(db, state);

  const candidates: CustodianCandidate[] = [];

  // Merge authored + generated consorts
  const allChars = new Map<string, CharacterContent>();
  for (const [id, c] of Object.entries(db.characters)) allChars.set(id, c);
  for (const [id, c] of Object.entries(state.generatedConsorts)) allChars.set(id, c);

  for (const [, c] of allChars) {
    if (c.id === currentCustodianId) continue;

    if (c.kind === "elder") {
      if (c.id === "taihou" && !state.taihou.deceased) {
        candidates.push({ id: c.id, kind: "elder", displayName: "太后", becomesLegitimate: false });
      }
      continue;
    }

    if (c.kind !== "consort") continue;

    const st = state.standing[c.id];
    if (!st) continue;
    if (st.lifecycle === "deceased") continue;
    if (st.lifecycle === "candidate") continue;
    if (isConfined(state, c.id)) continue;
    if (c.defaultLocation === "changmengong" || isInColdPalace(state, c.id)) continue;

    const rank = db.ranks[st.rank];
    if (!rank || rank.domain !== "harem") continue;

    if (heir.sex === "daughter" && rank.order < guirenOrder) continue;
    if (heir.sex === "son" && rank.order <= changzaiOrder) continue;

    // 已嫡出皇嗣（解锁重指定）保持嫡出，不再因新抚养人是皇后而「转嫡」；
    // 仅庶出皇嗣交由当前皇后抚养时 becomesLegitimate。
    const becomesLegitimate = !heir.legitimate && empress !== null && c.id === empress.id;
    const displayName = resolveDisplayName(c, st, rank);

    candidates.push({ id: c.id, kind: "consort", displayName, rankId: st.rank, becomesLegitimate });
  }

  return candidates;
}

// ── Reactions ────────────────────────────────────────────────────────────────

function heirChildLabel(heir: Heir): string {
  return heir.sex === "daughter" ? "皇子" : "皇郎";
}

function heirNameLabel(heir: Heir): string {
  if (heir.givenName) return `${heirChildLabel(heir)}${heir.givenName}`;
  if (heir.petName) return `${heirChildLabel(heir)}（${heir.petName}）`;
  return heirChildLabel(heir);
}

function buildCustodyReactions(
  db: ContentDB,
  state: GameState,
  heir: Heir,
  plan: Pick<HeirCustodyTransferPlan, "fromCustodianId" | "toCustodianId" | "becomesLegitimate">,
): ReactionBeat[] {
  const { fromCustodianId, toCustodianId, becomesLegitimate } = plan;
  const reactions: ReactionBeat[] = [];
  const toChar = db.characters[toCustodianId] ?? state.generatedConsorts[toCustodianId];
  const childLabel = heirNameLabel(heir);

  // New custodian reaction
  if (toChar?.kind === "elder" && toChar.id === "taihou") {
    reactions.push({
      speakerId: "taihou",
      lines: [`太后含笑颔首：好，这${childLabel}就交给哀家，定当悉心教养，看着${heir.sex === "daughter" ? "她" : "他"}长大成人。`],
    });
  } else if (becomesLegitimate) {
    const toSt = state.standing[toCustodianId];
    const toRank = toSt ? db.ranks[toSt.rank] : undefined;
    const toName = toChar ? resolveDisplayName(toChar, toSt, toRank) : toCustodianId;
    reactions.push({
      speakerId: toCustodianId,
      lines: [
        `${toName}肃然领旨。`,
        `此事当告于宗庙，${childLabel}自此列为嫡出，由${toName}亲自抚育，不负天恩。`,
      ],
    });
  } else if (toChar?.kind === "consort" && toChar.id === getBiologicalParents(state, heir.id)?.fatherId) {
    const toSt = state.standing[toCustodianId];
    const toRank = toSt ? db.ranks[toSt.rank] : undefined;
    const toName = toChar ? resolveDisplayName(toChar, toSt, toRank) : toCustodianId;
    reactions.push({
      speakerId: toCustodianId,
      lines: [`${toName}叩首谢恩：陛下仍准臣亲自抚养，臣感激涕零，定当竭尽全力教养${childLabel}。`],
    });
  } else {
    const toSt = toChar?.kind === "consort" ? state.standing[toCustodianId] : undefined;
    const toRank = toSt ? db.ranks[toSt.rank] : undefined;
    const toName = toChar ? resolveDisplayName(toChar, toSt, toRank) : toCustodianId;
    reactions.push({
      speakerId: toCustodianId,
      lines: [
        `${toName}趋前叩谢天恩。`,
        `${toName}哽咽叩首：定当视如己出，悉心教养这${childLabel}，不负陛下托付。`,
      ],
    });
  }

  // Old custodian reaction — only when actually losing custody
  if (fromCustodianId && fromCustodianId !== toCustodianId) {
    const fromChar = db.characters[fromCustodianId] ?? state.generatedConsorts[fromCustodianId];
    const fromSt = fromChar?.kind === "consort" ? state.standing[fromCustodianId] : undefined;
    const isLivingConsort = fromChar?.kind === "consort" && fromSt && fromSt.lifecycle !== "deceased";
    if (isLivingConsort) {
      reactions.push({
        speakerId: "wei_sui",
        lines: [`司礼官低声回禀：皇嗣已搬到新住处，臣已告于宗庙。臣听闻……那位侍君闻讯，独在宫中，久久不语。`],
      });
    }
  }

  return reactions;
}

// ── Planner ──────────────────────────────────────────────────────────────────

export function planHeirCustodyTransfer(
  db: ContentDB,
  state: GameState,
  command: HeirCustodyTransferCommand,
): Result<HeirCustodyTransferPlan, GameError[]> {
  const { heirId, toCustodianId, source } = command;

  // Validate heir
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir) return err([stateError("INVALID_HEIR", `皇嗣 "${heirId}" 不存在`)]);
  if (heir.lifecycle !== "alive") return err([stateError("INVALID_HEIR", `该皇嗣已故`)]);
  // 嫡出皇嗣的抚养归属已定，仅当现抚养人**永久失效**（已故/无）时才解锁重新指定。
  if (heir.legitimate) {
    const { availability } = resolveCustodianAvailability(db, state, heir);
    if (!custodianUnlocksRecustody(availability)) {
      return err([stateError("LEGITIMATE_LOCKED", "嫡出皇嗣的抚养归属已定，不可在奉先殿更改。")]);
    }
  }

  // Same custodian
  if (toCustodianId === heir.custodianId) {
    return err([stateError("SAME_CUSTODIAN", "此人已是当前抚养人")]);
  }

  // Validate target is in candidate pool
  const candidates = eligibleCustodiansForHeir(db, state, heir);
  const candidate = candidates.find((c) => c.id === toCustodianId);
  if (!candidate) {
    const char = db.characters[toCustodianId] ?? state.generatedConsorts[toCustodianId];
    if (!char) return err([stateError("INVALID_CUSTODIAN", `抚养人 "${toCustodianId}" 不存在`)]);
    if (char.kind === "official") return err([stateError("INVALID_CUSTODIAN", "官员不可为抚养人")]);
    return err([stateError("INVALID_CUSTODIAN", "此人目前无法担任抚养人（位分不足、禁足、冷宫、候选或已故）")]);
  }

  const becomesLegitimate = candidate.becomesLegitimate;
  const fromCustodianId = heir.custodianId;
  const now = toGameTime(state.calendar);

  // Build effects
  const effects: EventEffect[] = [
    { type: "heir_custody", heirId, custodianId: toCustodianId },
  ];

  // Old custodian consequences (living consort only, not taihou)
  if (fromCustodianId && fromCustodianId !== toCustodianId) {
    const fromChar = db.characters[fromCustodianId] ?? state.generatedConsorts[fromCustodianId];
    const fromSt = fromChar?.kind === "consort" ? state.standing[fromCustodianId] : undefined;
    if (fromChar?.kind === "consort" && fromSt && fromSt.lifecycle !== "deceased") {
      effects.push({ type: "favor", char: fromCustodianId, delta: -10 });
      effects.push({ type: "adjust_consort_attr", char: fromCustodianId, field: "affection", delta: -10 });
      if (state.memories[fromCustodianId]) {
        effects.push({
          type: "memory",
          char: fromCustodianId,
          entry: {
            kind: "grievance",
            summary: "陛下将皇嗣交由他人抚养，被夺去了抚养之权。",
            subjectIds: [fromCustodianId, heirId, toCustodianId],
            perspective: "target",
            strength: 75,
            triggerTags: ["custody_loss"],
            unresolved: true,
            emotions: { grief: 75, anger: 40 },
            retention: "slow",
          },
        });
      }
    }
  }

  // Chronicle
  const chronicleParticipants: CourtEvent["participants"] = [
    { charId: heirId, role: "heir" },
    { charId: toCustodianId, role: "to_custodian" },
  ];
  if (fromCustodianId) {
    chronicleParticipants.push({ charId: fromCustodianId, role: "from_custodian" });
  }

  const chronicle: Omit<CourtEvent, "id">[] = [
    {
      type: "heir_custody_changed",
      occurredAt: now,
      participants: chronicleParticipants,
      payload: {
        heirId,
        fromCustodianId: fromCustodianId ?? null,
        toCustodianId,
        source,
        becameLegitimate: becomesLegitimate,
      },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: becomesLegitimate ? 90 : 70,
      retention: "permanent",
      tags: ["heir_custody", ...(becomesLegitimate ? ["legitimacy"] : [])],
    },
  ];

  // Reactions
  const reactions = buildCustodyReactions(db, state, heir, { fromCustodianId, toCustodianId, becomesLegitimate });

  return ok({ effects, chronicle, reactions, fromCustodianId, toCustodianId, becomesLegitimate });
}

// ── Pure resolver (for tests, no AP deduction) ───────────────────────────────

export function resolveHeirCustodyTransfer(
  db: ContentDB,
  state: GameState,
  command: HeirCustodyTransferCommand,
): Result<{ state: GameState; plan: HeirCustodyTransferPlan }, GameError[]> {
  const planResult = planHeirCustodyTransfer(db, state, command);
  if (!planResult.ok) return err(planResult.error);
  const plan = planResult.value;

  const effectResult = applyEffects(db, state, plan.effects);
  if (!effectResult.ok) return err(effectResult.error);
  let nextState = effectResult.value;

  for (const draft of plan.chronicle) {
    const ap = appendCourtEvent(nextState, draft);
    if (!ap.ok) return err(ap.error);
    nextState = ap.value.state;
  }

  return ok({ state: nextState, plan });
}
