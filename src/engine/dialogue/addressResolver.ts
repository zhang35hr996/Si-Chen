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
  /** Acceptable alternate forms (e.g. 皇上 alongside 陛下). */
  allowedAlternates: string[];
  /**
   * Terms that would normally be valid for this speaker but are forbidden in
   * this specific utterance due to target rank context.
   * Example: 本宫 is forbidden when the target outranks the speaker.
   */
  forbiddenInContext: string[];
}

const EMPEROR_ADDRESS = "陛下";
const EMPEROR_ALTERNATES = ["皇上", "圣上"];
const BEN_GONG = "本宫";

export function resolveAddress(
  db: ContentDB,
  state: GameState,
  speakerId: string,
  targetId: string,
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
    // Future: imperial heirs (taizi/wangzi kind) would call the emperor 母皇.
    if (char?.kind === "elder") {
      targetAddress = "皇帝";
      allowedAlternates = ["皇儿", "吾儿"];
    } else {
      targetAddress = EMPEROR_ADDRESS;
      allowedAlternates = EMPEROR_ALTERNATES;
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

  return { selfRef, targetAddress, allowedAlternates, forbiddenInContext };
}
