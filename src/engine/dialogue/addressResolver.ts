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

  const isTargetPlayer = targetId === "player";
  const selfRef = isTargetPlayer
    ? (speakerSelfRefs?.toPlayer[0] ?? speakerSelfRefs?.formal[0] ?? "侍身")
    : (speakerSelfRefs?.formal[0] ?? speakerSelfRefs?.toPlayer[0] ?? "侍身");

  let targetAddress: string;
  let allowedAlternates: string[];
  const forbiddenInContext: string[] = [];

  if (isTargetPlayer) {
    targetAddress = EMPEROR_ADDRESS;
    allowedAlternates = EMPEROR_ALTERNATES;
  } else {
    const targetStanding = state.standing[targetId] ?? db.characters[targetId]?.initialStanding;
    const targetRankId = targetStanding?.rank;
    const targetRule = db.lexicon.rankAddressRules.find((r) => r.rank === targetRankId);
    const targetRank = targetRankId ? db.ranks[targetRankId] : undefined;
    targetAddress = targetRule?.addressedAs ?? targetRank?.name ?? targetId;
    allowedAlternates = [];

    // 本宫 is only appropriate when addressing someone of LOWER rank.
    // If target rank order >= speaker rank order, forbid 本宫.
    const speakerOrder = speakerRank?.order ?? 0;
    const targetOrder = targetRank?.order ?? 0;
    if (
      speakerSelfRefs?.formal.includes(BEN_GONG) &&
      targetOrder >= speakerOrder
    ) {
      forbiddenInContext.push(BEN_GONG);
    }
  }

  // 本宫 is never appropriate when addressing the emperor.
  if (isTargetPlayer && speakerSelfRefs?.formal.includes(BEN_GONG)) {
    forbiddenInContext.push(BEN_GONG);
  }

  return { selfRef, targetAddress, allowedAlternates, forbiddenInContext };
}
