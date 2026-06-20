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
  type LoadedSave,
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
  mode = "load",
  embedded = false,
  onClose,
  onLoaded,
}: {
  db: ContentDB;
  store: GameStore;
  storage: KVStorage | null;
  logger?: RingBufferLogger;
  gameStarted: boolean;
  mode?: "load" | "save";
  /** 嵌入设置界面：省去 .save-screen 整页外壳/页眉，沿用设置背景，槽位取代中间按钮。 */
  embedded?: boolean;
  onClose: () => void;
  onLoaded: () => void;
}) {
  useGameState(store); // re-render after load/save
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // An imported file is validated and PREVIEWED — never auto-loaded and never
  // allowed to clobber the autosave. The player explicitly writes it to a manual
  // slot (or loads it) after seeing what it is (user feedback, plan §9).
  const [pendingImport, setPendingImport] = useState<LoadedSave | null>(null);
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
      setPendingImport(result.value); // preview first — no live state touched yet
      setMessage(null);
    } else {
      setPendingImport(null);
      report("导入失败", [result.error]);
    }
  };

  // Commit a previewed import into a manual slot. Never writes auto / auto.prev.
  const writeImportToSlot = (slot: SaveSlot) => {
    if (!storage || !pendingImport) return;
    const result = writeSave(storage, db, pendingImport.state, slot, { logger });
    if (result.ok) {
      setMessage(`已将导入的存档写入 ${slot}（请从该槽读取以载入）`);
      setPendingImport(null);
      setRefresh(refresh + 1);
    } else {
      report("写入失败", [result.error]);
    }
  };

  const loadImportNow = () => {
    if (!pendingImport) return;
    store.loadState(pendingImport.state);
    setPendingImport(null);
    onLoaded();
  };

  const body = (
    <>
      {!storage && <p className="save-screen__banner">存档不可用——请使用导出备份进度。</p>}
      {message && <p className="save-screen__message">{message}</p>}

      {mode === "load" && pendingImport && (
        <div className="save-screen__import-preview">
          <p>
            待导入存档 · 创建于 {new Date(pendingImport.meta.createdAt).toLocaleString()} · 内容版本{" "}
            {pendingImport.meta.contentVersion}
          </p>
          {pendingImport.warnings.length > 0 && (
            <p className="save-screen__banner">{pendingImport.warnings.map((w) => w.message).join("；")}</p>
          )}
          <p className="save-screen__import-hint">导入不会覆盖自动存档；请选择写入哪个手动槽，或直接载入。</p>
          <div className="save-screen__import-actions">
            {storage &&
              MANUAL_SLOTS.map((slot) => (
                <button key={slot} type="button" onClick={() => writeImportToSlot(slot)}>
                  写入 {slot}
                </button>
              ))}
            <button type="button" onClick={loadImportNow}>
              直接载入到当前游戏
            </button>
            <button type="button" onClick={() => setPendingImport(null)}>
              取消
            </button>
          </div>
        </div>
      )}

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
                  {mode === "save" && manual && gameStarted && (
                    <button type="button" onClick={() => save(slot)}>
                      保存
                    </button>
                  )}
                  {mode === "load" && info?.status !== "empty" && (
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
        {mode === "save" && gameStarted && (
          <button type="button" onClick={exportFile}>
            导出当前进度
          </button>
        )}
        {mode === "load" && (
          <>
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
          </>
        )}
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="settings-menu__saveload">
        <h2 className="settings-menu__subtitle">{mode === "load" ? "读档" : "存档"}</h2>
        {body}
        <button type="button" className="settings-menu__back" onClick={onClose}>
          返回
        </button>
      </div>
    );
  }

  return (
    <main className="save-screen">
      <header className="hud">
        <span className="hud__time">{mode === "load" ? "读档" : "存档"}</span>
        <button type="button" className="hud__button" onClick={onClose}>
          返回
        </button>
      </header>
      {body}
    </main>
  );
}
