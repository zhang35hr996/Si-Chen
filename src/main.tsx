import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { consoleSink, createLogger } from "./engine/infra/logger";
import { createGameStore } from "./store/gameStore";
import { createDialogueProvider } from "./engine/dialogue/providers/remoteProvider";
import { createHttpAnthropicTransport } from "./engine/dialogue/providers/httpAnthropicTransport";
import { RemoteKnowledgeClient } from "./engine/knowledge/remote/client";
import type { DialogueRuntimeDeps } from "./engine/dialogue/runtimeDeps";
import { App } from "./ui/App";
import "./ui/styles.css";

const DEFAULT_MODEL = "claude-sonnet-4-5";

const logger = createLogger({ sinks: import.meta.env.DEV ? [consoleSink] : [] });
const store = createGameStore({ logger });

// Knowledge retrieval: same-origin /api path so Vite proxy routes to the local
// Node server without hardcoding localhost ports (avoids CORS in future deploys).
const knowledgeRetriever = new RemoteKnowledgeClient({ baseUrl: "/api" });

const dialogueRuntime: DialogueRuntimeDeps = {
  provider: createDialogueProvider({
    model: { provider: "anthropic", model: DEFAULT_MODEL },
    transport: createHttpAnthropicTransport(),
  }),
  logger,
  knowledgeRetriever,
  knowledgeFailureMode: "continue_without_knowledge",
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("index.html is missing #root");
}

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} dialogueRuntime={dialogueRuntime} />
  </StrictMode>,
);
