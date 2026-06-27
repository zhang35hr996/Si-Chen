import { useState } from "react";
import { TITLE_EPITHETS } from "../../engine/characters/epithetPool";

export function EpithetPicker({ onSelect }: { onSelect: (char: string) => void }) {
  const [query, setQuery] = useState("");

  const q = query.trim();
  const filtered = q
    ? TITLE_EPITHETS.filter(
        (e) =>
          e.char.includes(q) ||
          e.meaning.includes(q) ||
          e.tags.some((t) => t.includes(q)),
      )
    : TITLE_EPITHETS;

  return (
    <div className="epithet-picker">
      <input
        className="epithet-picker__search"
        type="text"
        placeholder="搜字、释义或分类…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul className="epithet-picker__list" role="listbox">
        {filtered.length === 0 ? (
          <li className="epithet-picker__empty">无匹配封号</li>
        ) : (
          filtered.map((e) => (
            <li key={e.char}>
              <button
                type="button"
                className="epithet-picker__item"
                role="option"
                onClick={() => onSelect(e.char)}
              >
                <span className="epithet-picker__char">{e.char}</span>
                <span className="epithet-picker__meaning">{e.meaning}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
