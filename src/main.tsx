import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { consoleSink, createLogger } from "./engine/infra/logger";
import { createGameStore } from "./store/gameStore";
import { App } from "./ui/App";
import "./ui/styles.css";

const logger = createLogger({ sinks: import.meta.env.DEV ? [consoleSink] : [] });
const store = createGameStore({ logger });

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("index.html is missing #root");
}

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} logger={logger} />
  </StrictMode>,
);
