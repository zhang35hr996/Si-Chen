import type { KnowledgeVisibility, KnowledgeSourceType } from "../../knowledge/model";

/** A knowledge chunk as seen by the LLM — no sourcePath, no internal metadata. */
export interface PromptKnowledgeChunk {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly sourceType: KnowledgeSourceType;
  readonly visibility: KnowledgeVisibility;
}

/**
 * Minimal retriever interface satisfied by KnowledgeHybridRetriever.
 * Defined here so the dialogue bridge does not import Node-side retriever classes.
 */
export interface KnowledgeRetriever {
  retrieve(query: import("../../knowledge/retrieval/types").KnowledgeHybridQuery): Promise<import("../../knowledge/retrieval/types").KnowledgeHybridResult>;
}
