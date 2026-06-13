/**
 * Save/load menu (skeleton-plan §9). Only reachable OUTSIDE scenes — that's
 * the structural mid-scene-save block. With storage unavailable, slots are
 * hidden and only file export/import remain (play continues, loudly).
 */
import { useRef, useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import { formatErrorTag, type GameError } from "../../engine/infra/errors";
import type { RingBufferLogger } from "../../engine/infra/logger";
import {
  ALL_SLOTS,
  MANUAL_SLOTS,
  exportSaveText,
  importSaveText,
  listSaves,
  readSlot,
  writeSave,
  type SaveSlot,
} from "../../engine/save/saveSystem";
import type { KVStorage } from "../../engine/save/storage";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function SaveLoadScreen({
  db,
  store,
  storage,
  logger,
  gameStarted,
  onClose,
  onLoaded,
}: {
  db: ContentDB;
  store: GameStore;
  storage: KVStorage | null;
  logger?: RingBufferLogger;
  gameStarted: boolean;
  onClose: () => void;
  onLoaded: () => void;
}) {
  useGameState(store); // re-render after load/save
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const report = (prefix: string, errors: GameError[]) =>
    setMessage(`${prefix}：${errors.map((e) => `${formatErrorTag(e)} — ${e.message}`).join("；")}`);

  const slots = storage ? listSaves(storage) : [];

  const save = (slot: SaveSlot) => {
    if (!storage) return;
    const result = writeSave(storage, db, store.getState(), slot, { logger });
    if (result.ok) setMessage(`已保存到 ${slot}（${result.value.bytes} 字节）`);
    else report("保存失败", [result.error]);
    setRefresh(refresh + 1);
  };

  const load = (slot: SaveSlot) => {
    if (!storage) return;
    const result = readSlot(storage, db, slot, { logger });
    if (result.ok) {
      store.loadState(result.value.state);
      setMessage(
        result.value.warnings.length > 0
          ? result.value.warnings.map((w) => w.message).join("；")
          : null,
      );
      onLoaded();
    } else {
      report("读取失败", [result.error]);
      setRefresh(refresh + 1); // slot may have been quarantined away
    }
  };

  const exportFile = () => {
    const text = exportSaveText(db, store.getState());
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fengsichen-save-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    const result = importSaveText(db, await file.text());
    if (result.ok) {
      store.loadState(result.value.state);
      setMessage(result.value.warnings.map((w) => w.message).join("；") || null);
      onLoaded();
    } else {
      report("导入失败", [result.error]);
    }
  };

  return (
    <main className="save-screen">
      <header className="hud">
        <span className="hud__time">存档 · 读档</span>
        <button type="button" className="hud__button" onClick={onClose}>
          返回
        </button>
      </header>

      {!storage && <p className="save-screen__banner">存档不可用——请使用导出备份进度。</p>}
      {message && <p className="save-screen__message">{message}</p>}

      {storage && (
        <ul className="save-screen__slots">
          {ALL_SLOTS.map((slot) => {
            const info = slots.find((s) => s.slot === slot);
            const manual = (MANUAL_SLOTS as readonly string[]).includes(slot);
            return (
              <li key={slot} className="save-screen__slot">
                <span className="save-screen__slot-name">
                  {slot === "auto" ? "自动" : slot === "auto.prev" ? "自动（上一份）" : slot}
                </span>
                <span className="save-screen__slot-meta">
                  {info?.status === "empty" && "（空）"}
                  {info?.status === "corrupt" && "（损坏）"}
                  {info?.status === "ok" && (info.createdAt ? new Date(info.createdAt).toLocaleString() : "")}
                </span>
                <span className="save-screen__slot-actions">
                  {manual && gameStarted && (
                    <button type="button" onClick={() => save(slot)}>
                      保存
                    </button>
                  )}
                  {info?.status !== "empty" && (
                    <button type="button" onClick={() => load(slot)}>
                      读取
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="save-screen__io">
        {gameStarted && (
          <button type="button" onClick={exportFile}>
            导出当前进度
          </button>
        )}
        <button type="button" onClick={() => fileInput.current?.click()}>
          从文件导入
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = "";
          }}
        />
      </div>
    </main>
  );
}
