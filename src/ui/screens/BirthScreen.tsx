/** 生产播报：经对话缝隙逐行播报生产结局，结束回调由 App 提交 birth 效果。 */
import { ReactionScreen } from "./ReactionScreen";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";

export function BirthScreen({
  db,
  store,
  registry,
  speakerId,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  onDone: () => void;
}) {
  return (
    <ReactionScreen db={db} store={store} registry={registry} speakerId={speakerId} lines={lines} onDone={onDone} />
  );
}
