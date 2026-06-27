import type { Epithet } from "../../engine/characters/epithetPool";

export function EpithetSuggest({
  candidates,
  onSelect,
  onCustom,
}: {
  candidates: Epithet[];
  onSelect: (char: string) => void;
  onCustom: () => void;
}) {
  return (
    <div className="epithet-suggest">
      <p className="epithet-suggest__prompt">
        乘风躬身道：「陛下，内务府已拟好几个封号，皆可取用。」
      </p>
      <ul className="epithet-suggest__list">
        {candidates.map((e) => (
          <li key={e.char}>
            <button
              type="button"
              className="epithet-suggest__card"
              onClick={() => onSelect(e.char)}
            >
              <span className="epithet-suggest__char">{e.char}</span>
              <span className="epithet-suggest__meaning">{e.meaning}</span>
              <span className="epithet-suggest__tags">
                {e.tags.map((t) => (
                  <span key={t} className="epithet-suggest__tag">{t}</span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="epithet-suggest__custom" onClick={onCustom}>
        朕来拟
      </button>
    </div>
  );
}
