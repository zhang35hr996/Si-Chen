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

  // Resolve target rank order to determine if speaker is speaking UP or DOWN.
  const targetStanding = isTargetPlayer ? undefined : (state.standing[targetId] ?? db.characters[targetId]?.initialStanding);
  const targetRankId = targetStanding?.rank;
  const targetRank = targetRankId ? db.ranks[targetRankId] : undefined;
  const targetOrder = isTargetPlayer
    ? Number.MAX_SAFE_INTEGER // player (emperor) is always the highest
    : (targetRank?.order ?? 0);

  // Speaking UP (to someone of equal or higher rank): use the deferential toPlayer form.
  // Speaking DOWN (to someone of strictly lower rank): use the formal/titular form (本宫 allowed).
  const speakingUp = targetOrder >= speakerOrder;
  const selfRef = speakingUp
    ? (speakerSelfRefs?.toPlayer[0] ?? speakerSelfRefs?.formal[0] ?? "侍身")
    : (speakerSelfRefs?.formal[0] ?? speakerSelfRefs?.toPlayer[0] ?? "侍身");

  let targetAddress: string;
  let allowedAlternates: string[];
  const forbiddenInContext: string[] = [];

  if (isTargetPlayer) {
    targetAddress = EMPEROR_ADDRESS;
    allowedAlternates = EMPEROR_ALTERNATES;
  } else {
    const targetRule = db.lexicon.rankAddressRules.find((r) => r.rank === targetRankId);
    targetAddress = targetRule?.addressedAs ?? targetRank?.name ?? targetId;
    allowedAlternates = [];
  }

  // 本宫 is only appropriate when addressing someone of LOWER rank.
  // Add it to forbiddenInContext whenever the speaker is speaking UP (including to emperor).
  if (speakingUp && speakerSelfRefs?.formal.includes(BEN_GONG)) {
    forbiddenInContext.push(BEN_GONG);
  }

  return { selfRef, targetAddress, allowedAlternates, forbiddenInContext };
}
