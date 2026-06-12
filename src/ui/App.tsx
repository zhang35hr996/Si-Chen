import type { GameStore } from "../store/gameStore";
import { DebugPanel } from "./debug/DebugPanel";
import { TitleScreen } from "./screens/TitleScreen";

export function App({ store }: { store: GameStore }) {
  return (
    <>
      <TitleScreen />
      <DebugPanel store={store} />
    </>
  );
}
