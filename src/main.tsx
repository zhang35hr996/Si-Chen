import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { consoleSink, createLogger } from "./engine/infra/logger";
import { createGameStore } from "./store/gameStore";
import { createDialogueProvider } from "./engine/dialogue/providers/remoteProvider";
import { createHttpAnthropicTransport } from "./engine/dialogue/providers/httpAnthropicTransport";
import { App } from "./ui/App";
import "./ui/styles.css";

const DEFAULT_MODEL = "claude-sonnet-4-5";

const logger = createLogger({ sinks: import.meta.env.DEV ? [consoleSink] : [] });
const store = createGameStore({ logger });

// Browser always creates the provider via HTTP transport — the relay (server) handles auth.
const dialogueProvider = createDialogueProvider({
  model: { provider: "anthropic", model: DEFAULT_MODEL },
  transport: createHttpAnthropicTransport(),
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("index.html is missing #root");
}

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} logger={logger} dialogueProvider={dialogueProvider} />
  </StrictMode>,
);
