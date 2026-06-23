/**
 * 场景人物条（scene-ui-narrative-refactor §5.3 / PR3 Task 3.1）。轻量人物选择器：
 * 只列「此刻实际在场」的人物（由调用方以 presentAt 物理在场为唯一来源填充），
 * 展示姓名 + 位分/身份 + 当前选中态；点击/键盘选择 → onFocus(id)。
 *
 * 边界：纯展示 + 回调，不读/改 store、不查事件、不承载完整属性面板，不渲染 CharacterCard。
 * 0 人显示自然空状态（非空卡框）。容器为 role="group"（非 dialog，避免移动端重复 dialog landmark）。
 * 键盘：每项为原生 button（Tab 可达、Enter/Space 选择）；← → ↑ ↓ 在条内移动焦点（roving）。
 */
import { useRef } from "react";

export interface SceneCharacterBarItem {
  id: string;
  name: string;
  /** 位分或身份（如「贵妃」「君卿」「宫人」）。 */
  role: string;
  /** 在场但不可作为交互对象（如原子操作进行中）。显示但禁用，不发 onFocus。 */
  disabled?: boolean;
  disabledReason?: string;
}

export interface SceneCharacterBarProps {
  characters: SceneCharacterBarItem[];
  selectedId?: string | null;
  onFocus: (id: string) => void;
  /** 0 人时的自然空状态文案。缺省「此处无人。」 */
  emptyHint?: string;
  ariaLabel?: string;
}

export function SceneCharacterBar({
  characters,
  selectedId,
  onFocus,
  emptyHint = "此处无人。",
  ariaLabel = "在场人物",
}: SceneCharacterBarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  if (characters.length === 0) {
    return (
      <div className="scene-character-bar scene-character-bar--empty" role="group" aria-label={ariaLabel}>
        <p className="scene-character-bar__empty">{emptyHint}</p>
      </div>
    );
  }

  const focusByOffset = (currentId: string, delta: number) => {
    const idx = characters.findIndex((c) => c.id === currentId);
    if (idx < 0) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-char-id]");
    if (!buttons) return;
    const next = (idx + delta + characters.length) % characters.length;
    buttons[next]?.focus();
  };

  return (
    <div className="scene-character-bar" role="group" aria-label={ariaLabel} ref={listRef}>
      <ul className="scene-character-bar__list">
        {characters.map((c) => {
          const selected = c.id === selectedId;
          return (
            <li key={c.id} className="scene-character-bar__item">
              <button
                type="button"
                data-char-id={c.id}
                className={`scene-character-bar__chip${selected ? " is-active" : ""}`}
                aria-pressed={selected}
                aria-label={`${c.name} · ${c.role}`}
                disabled={c.disabled}
                title={c.disabled ? c.disabledReason : undefined}
                onClick={() => {
                  if (!c.disabled) onFocus(c.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    focusByOffset(c.id, 1);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    focusByOffset(c.id, -1);
                  }
                }}
              >
                <span className="scene-character-bar__name">{c.name}</span>
                <span className="scene-character-bar__role">{c.role}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
