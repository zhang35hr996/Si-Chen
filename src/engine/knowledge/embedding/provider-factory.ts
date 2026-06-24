/**
 * Factory for embedding providers.
 *
 * Reads API keys from environment variables; never accepts them as direct
 * configuration so they cannot accidentally appear in logs or error messages.
 */
import { createGeminiEmbeddingProvider } from "./gemini-embedding-provider";
import { createOpenAIEmbeddingProvider } from "./openai-embedding-provider";
import type { EmbeddingProvider } from "./provider";

export type SupportedEmbeddingProvider = "openai" | "gemini";

export interface EmbeddingProviderConfig {
  provider: SupportedEmbeddingProvider;
  model: string;
}

/**
 * Creates an EmbeddingProvider from environment variables.
 *
 * OpenAI: reads OPENAI_API_KEY
 * Gemini: reads GEMINI_API_KEY
 *
 * Throws if the required key is absent.
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  switch (config.provider) {
    case "openai": {
      const apiKey = process.env["OPENAI_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "[embedding] OPENAI_API_KEY environment variable is not set",
        );
      }
      return createOpenAIEmbeddingProvider({ apiKey, model: config.model });
    }
    case "gemini": {
      const apiKey = process.env["GEMINI_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "[embedding] GEMINI_API_KEY environment variable is not set",
        );
      }
      return createGeminiEmbeddingProvider({ apiKey, model: config.model });
    }
  }
}
