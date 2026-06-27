/**
 * Pairwise address resolver — computes what speaker calls themselves (selfRef)
 * and what they should call the target (targetAddress) for a specific conversation.
 *
 * Fulfills docs/world/45-address-and-title-system.md runtime requirement:
 *   Prompt payload 必须把 runtime 解析后的 selfRef、targetAddress、
 *   allowedAlternates、forbiddenInContext 直接提供给模型。
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";

export interface PairwiseAddress {
  /** What the speaker says when referring to themselves in this conversation. */
  selfRef: string;
  /** The correct form of address for the target in this conversation. */
  targetAddress: string;
  /** Acceptable alternate forms (e.g. 皇上 alongside 陛下, 凤君 for authorized private). */
  allowedAlternates: string[];
  /**
   * Terms that would normally be valid for this speaker but are forbidden in
   * this specific utterance due to target rank context.
   * Example: 本宫 is forbidden when the target outranks the speaker.
   */
  forbiddenInContext: string[];
  /**
   * Forbidden terms lifted for this exact (speaker × target × register) triple.
   * Computed when speaker has permission, target is the emperor, and register is
   * private/intimate. Set on the NPC gate ctx; NOT on the player choice gate ctx
   * so NPC permissions never bleed into player choice text.
   */
  liftedForbiddenTerms: string[];
}

const EMPEROR_ADDRESS = "陛下";
// 皇上 is acceptable only in inner quarters (private/intimate); not in court or outer areas.
// 圣上 / 今上 / 圣驾 / 万岁 are solemn third-person or ceremonial forms — never direct-address alternates.
const INNER_QUARTERS_ALTERNATES = ["皇上"];
const BEN_GONG = "本宫";
const FENGJUN = "凤君";
const HUANGHOU_RANK_ID = "huanghou";
/** Registers that allow inner-quarters address forms (皇上, 凤君) when addressing the emperor. */
const PRIVATE_REGISTERS = new Set(["private", "intimate"]);

/** Options for resolveAddress — used by orchestrator to encode scene + character permissions. */
export interface ResolveAddressOptions {
  /** Scene register. If private/intimate and speaker is authorized, lifts 凤君 when target=player. */
  register?: string;
  /**
   * Typed permission keys from character's dialoguePolicy.addressPermissions.
   * "fengjun" — this character may address the emperor as 凤君 in private/intimate.
   */
  addressPermissions?: string[];
}

export function resolveAddress(
  db: ContentDB,
  state: GameState,
  speakerId: string,
  targetId: string,
  options: ResolveAddressOptions = {},
): PairwiseAddress {
  const char = db.characters[speakerId];
  const standing = state.standing[speakerId] ?? char?.initialStanding;
  const speakerRank = standing ? db.ranks[standing.rank] : undefined;
  const speakerSelfRefs = speakerRank?.selfRefs ?? char?.selfRefs;

  const speakerOrder = speakerRank?.order ?? 0;
  const isTargetPlayer = targetId === "player";

  // Resolve target rank for harem-domain address rules.
  const targetChar = isTargetPlayer ? undefined : db.characters[targetId];
  const targetStanding = isTargetPlayer ? undefined : (state.standing[targetId] ?? targetChar?.initialStanding);
  const targetRankId = targetStanding?.rank;
  const targetRank = targetRankId ? db.ranks[targetRankId] : undefined;
  const targetIsHarem = targetRank?.domain === "harem";

  // Non-harem targets (officials, elders, servants with no harem rank) get MAX order:
  // consorts must never use 本宫 when addressing officials or elders.
  const targetOrder = isTargetPlayer || !targetIsHarem
    ? Number.MAX_SAFE_INTEGER
    : (targetRank?.order ?? Number.MAX_SAFE_INTEGER);

  // Speaking UP (to equal or higher rank): deferential toPlayer form.
  // Speaking DOWN (to strictly lower rank): formal/titular form (本宫 allowed).
  const speakingUp = targetOrder >= speakerOrder;
  const selfRef = speakingUp
    ? (speakerSelfRefs?.toPlayer[0] ?? speakerSelfRefs?.formal[0] ?? "侍身")
    : (speakerSelfRefs?.formal[0] ?? speakerSelfRefs?.toPlayer[0] ?? "侍身");

  let targetAddress: string;
  let allowedAlternates: string[];
  const forbiddenInContext: string[] = [];

  if (isTargetPlayer) {
    // 太后（elder）calls the emperor 皇帝 + kinship terms, not 陛下.
    // 皇嗣→皇帝（母皇）and register-aware non-harem addressing are follow-up scope.
    if (char?.kind === "elder") {
      targetAddress = "皇帝";
      allowedAlternates = ["皇儿", "吾儿"];
    } else {
      targetAddress = EMPEROR_ADDRESS;
      // court register: strict protocol, 陛下 only.
      // public (default, fail-closed): 陛下 only — outer areas or unknown context.
      // private/intimate (inner quarters): 皇上 is acceptable.
      allowedAlternates = (options.register !== undefined && PRIVATE_REGISTERS.has(options.register))
        ? [...INNER_QUARTERS_ALTERNATES]
        : [];
    }
  } else if (targetIsHarem) {
    // Harem consort target: look up canonical address form from rankAddressRules.
    const targetRule = db.lexicon.rankAddressRules.find((r) => r.rank === targetRankId);
    targetAddress = targetRule?.addressedAs ?? targetRank?.name ?? targetId;
    allowedAlternates = [];
  } else {
    // Non-harem target (official, elder, palace servant): use display name.
    targetAddress = targetChar?.profile.name ?? targetId;
    allowedAlternates = [];
  }

  // 本宫 is only appropriate when addressing someone of LOWER rank.
  // Forbid it whenever the speaker is addressing upward (or equal, or non-harem target).
  if (speakingUp && speakerSelfRefs?.formal.includes(BEN_GONG)) {
    forbiddenInContext.push(BEN_GONG);
  }

  // 凤君 — lifted only when ALL conditions hold simultaneously:
  //   1. target is the emperor (player)
  //   2. register is private or intimate
  //   3. speaker is 皇后 (by rank) OR has the typed "fengjun" address permission
  //   4. speaker is not an elder (elders use kinship address, not 凤君)
  const liftedForbiddenTerms: string[] = [];
  if (
    isTargetPlayer &&
    char?.kind !== "elder" &&
    options.register !== undefined &&
    PRIVATE_REGISTERS.has(options.register)
  ) {
    const isHuanghou = standing?.rank === HUANGHOU_RANK_ID;
    const hasFengjunPermission = (options.addressPermissions ?? []).includes("fengjun");
    if (isHuanghou || hasFengjunPermission) {
      allowedAlternates.push(FENGJUN);
      liftedForbiddenTerms.push(FENGJUN);
    }
  }

  return { selfRef, targetAddress, allowedAlternates, forbiddenInContext, liftedForbiddenTerms };
}
