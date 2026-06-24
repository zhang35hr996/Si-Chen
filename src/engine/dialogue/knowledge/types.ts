import type { KnowledgeSourceType } from "../../knowledge/model";

/**
 * A knowledge chunk as seen by the LLM.
 * Intentionally excludes: sourcePath, visibility, temporal bounds, scores,
 * vectors, hashes, model keys. Only safe display fields reach the model.
 */
export interface PromptKnowledgeChunk {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly sourceType: KnowledgeSourceType;
}

/**
 * Minimal retriever interface satisfied by KnowledgeHybridRetriever.
 * Defined here so the dialogue bridge does not import Node-side retriever classes.
 */
export interface KnowledgeRetriever {
  retrieve(query: import("../../knowledge/retrieval/types").KnowledgeHybridQuery): Promise<import("../../knowledge/retrieval/types").KnowledgeHybridResult>;
}
