/**
 * 对话场景 audience（spec §6）= 听众身份 + 在场人 + 私密度。gate 不只判「对陛下不能
 * 幸灾乐祸」，还判在场与私密度。MVP 在场人由调用方/scene 提供，不在此重算复杂推断。
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import type { AudienceRole } from "./reactionTypes";

export interface DialogueAudienceContext {
  targetId: string;
  targetRole: AudienceRole;
  presentCharacterIds: string[];
  privacy: "public" | "semi_private" | "private";
}

function classifyRole(state: GameState, targetId: string): AudienceRole {
  if (targetId === "player") return "sovereign";
  if (state.standing[targetId]) return "consort";
  if (state.resources.bloodline.heirs.some((h) => h.id === targetId)) return "heir";
  return "servant";
}

export function buildAudienceContext(
  state: GameState,
  _db: ContentDB,
  args: {
    speakerId: string;
    targetId: string;
    presentCharacterIds?: string[];
    privacy?: DialogueAudienceContext["privacy"];
  },
): DialogueAudienceContext {
  const present = new Set(args.presentCharacterIds ?? [args.targetId]);
  present.add(args.targetId);
  present.delete(args.speakerId);
  return {
    targetId: args.targetId,
    targetRole: classifyRole(state, args.targetId),
    presentCharacterIds: [...present].sort(),
    privacy: args.privacy ?? "semi_private",
  };
}
