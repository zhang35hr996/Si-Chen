/** 全屏设置菜单（game_setting 背景）：读档 / 存档 / 音乐 / 返回主界面。读、存分屏。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { RingBufferLogger } from "../../engine/infra/logger";
import type { KVStorage } from "../../engine/save/storage";
import type { GameStore } from "../../store/gameStore";
import { audioController } from "../audio/AudioController";
import { SaveLoadScreen } from "../screens/SaveLoadScreen";

type Pane = "menu" | "load" | "save" | "audio";

export function SettingsMenu({
  db,
  store,
  storage,
  logger,
  registry,
  onLoaded,
  onReturnTitle,
  onClose,
}: {
  db: ContentDB;
  store: GameStore;
  storage: KVStorage | null;
  logger?: RingBufferLogger;
  registry: AssetRegistry;
  onLoaded: () => void;
  onReturnTitle: () => void;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<Pane>("menu");
  const [volume, setVolume] = useState(audioController.getVolume());
  const [muted, setMuted] = useState(audioController.isMuted());
  const bg = registry.background("bg.game_setting");

  return (
    <div
      className="settings-menu"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <button type="button" className="settings-menu__close" onClick={onClose}>返回游戏</button>
      <h1 className="settings-menu__title">设置</h1>

      {pane === "menu" && (
        <nav className="settings-menu__list">
          <button type="button" onClick={() => setPane("load")}>读档</button>
          <button type="button" onClick={() => setPane("save")}>存档</button>
          <button type="button" onClick={() => setPane("audio")}>音乐</button>
          <button type="button" onClick={onReturnTitle}>返回游戏主界面</button>
        </nav>
      )}

      {(pane === "load" || pane === "save") && (
        <SaveLoadScreen
          db={db}
          store={store}
          storage={storage}
          logger={logger}
          gameStarted
          mode={pane}
          embedded
          onClose={() => setPane("menu")}
          onLoaded={onLoaded}
        />
      )}

      {pane === "audio" && (
        <div className="settings-menu__audio">
          <label>
            音量
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); audioController.setVolume(v); }}
            />
          </label>
          <label>
            <input
              type="checkbox" checked={muted}
              onChange={(e) => { setMuted(e.target.checked); audioController.setMuted(e.target.checked); }}
            />
            静音
          </label>
          <button type="button" onClick={() => setPane("menu")}>返回</button>
        </div>
      )}
    </div>
  );
}
