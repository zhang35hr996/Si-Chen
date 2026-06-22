/**
 * 结构化对话断言（spec §结构化 claim）。约束不靠自然语言：claim gate 校验的是
 * provider 声明的 ProposedClaim，而非从文本反解。claimToFactKey 把可投影的谓词
 * 桥接到 PR1 BeliefProjection 的 FactKey；无对应事实的谓词返回 undefined（gate 据此
 * 走 reveals_unknown_fact / 礼制 / 身份分支，而非误判 belief）。
 */
import { z } from "zod";
import type { FactKey } from "../chronicle/belief";

export type ClaimPredicate =
  | "resides_at" | "currently_same_residence" | "parent_of"
  | "responsible_for" | "holds_rank" | "alive" | "caused_event";
export type ClaimModality = "assert" | "suspect" | "rumor" | "deny";

export interface DialogueClaim {
  id: string;
  predicate: ClaimPredicate;
  subjectId: string;
  object?: string | boolean | number;
  modality: ClaimModality;
  certaintyCeiling?: number;
}

/**
 * Typed reference to a context item the LLM used as evidence for a claim.
 * Matches ContextRef in types.ts — duplicated here to keep claims.ts self-contained.
 */
export interface ContextRef {
  kind: "memory" | "event" | "fact";
  id: string;
}

export const contextRefSchema = z.object({
  kind: z.enum(["memory", "event", "fact"]),
  id: z.string().min(1),
});

export interface ProposedClaim {
  claim: DialogueClaim;
  /** Non-empty: each ref is a context item offered to the LLM that justifies this claim. */
  sourceRefs: ContextRef[];
  modality: ClaimModality;
  certainty: number; // 0–100
}

const claimModalitySchema = z.enum(["assert", "suspect", "rumor", "deny"]);

export const dialogueClaimSchema: z.ZodType<DialogueClaim> = z.strictObject({
  id: z.string().min(1),
  predicate: z.enum([
    "resides_at", "currently_same_residence", "parent_of",
    "responsible_for", "holds_rank", "alive", "caused_event",
  ]),
  subjectId: z.string().min(1),
  object: z.union([z.string(), z.boolean(), z.number()]).optional(),
  modality: claimModalitySchema,
  certaintyCeiling: z.number().min(0).max(100).optional(),
});

export const proposedClaimSchema: z.ZodType<ProposedClaim> = z.strictObject({
  claim: dialogueClaimSchema,
  sourceRefs: z.array(contextRefSchema).min(1),
  modality: claimModalitySchema,
  certainty: z.number().min(0).max(100),
}).superRefine((data, ctx) => {
  // Modality consistency: proposed modality must match claim.modality
  if (data.modality !== data.claim.modality) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modality"],
      message: `proposed modality "${data.modality}" must match claim.modality "${data.claim.modality}"`,
    });
  }
});

/** 仅可投影谓词桥接到 BeliefProjection；派生/关系/因果类谓词无单一 fact → undefined。 */
export function claimToFactKey(claim: DialogueClaim): FactKey | undefined {
  switch (claim.predicate) {
    case "resides_at":
    case "holds_rank":
    case "alive":
      return { predicate: claim.predicate, subjectId: claim.subjectId };
    default:
      return undefined;
  }
}
