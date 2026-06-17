/** 御书房·子嗣列表：皇子/皇郎两表，显示承嗣者/年龄/生日/宠爱度 + ± 调整 + 嫡标记。 */
import { formatGameTime } from "../../engine/calendar/time";
import { listHeirsBySex, heirAge, isEnrolled } from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, Heir } from "../../engine/state/types";

export function HeirListModal({
  db,
  state,
  onAdjust,
  onSummon,
  canSummon,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onAdjust: (heirId: string, delta: number) => void;
  onSummon?: (heirId: string) => void;
  canSummon: boolean;
  onClose: () => void;
}) {
  const heirs = state.resources.bloodline.heirs;

  const nameOf = (charId: string): string => {
    const c = db.characters[charId];
    if (!c) return charId;
    const st = state.standing[charId];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };

  const bearerLabel = (h: Heir): string => {
    if (h.fatherId === null) return "自孕";
    const c = db.characters[h.fatherId];
    if (!c) return h.fatherId;
    const st = state.standing[h.fatherId];
    const name = resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
    return st?.lifecycle === "deceased" ? `${name}（已故）` : name;
  };

  const renderTable = (sex: "daughter" | "son", title: string) => {
    const rows = listHeirsBySex(heirs, sex);
    return (
      <section className="heir-list__table">
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="heir-list__empty">暂无。</p>
        ) : (
          <ul>
            {rows.map(({ heir, name }) => (
              <li key={heir.id} className="heir-list__row">
                <span className="heir-list__name">
                  {name}
                  {heir.legitimate ? "（嫡）" : ""}：
                  {heir.givenName ?? "—"}
                  {heir.petName ? `（${heir.petName}）` : ""}
                </span>
                <span>承嗣：{bearerLabel(heir)}</span>
                {heir.adoptiveFatherId && <span>养父：{nameOf(heir.adoptiveFatherId)}</span>}
                <span>
                  {heirAge(heir, state.calendar)}岁 · {formatGameTime(heir.birthAt)}
                </span>
                {isEnrolled(heir, state.calendar) && (
                  <span className="heir-list__edu">
                    学问{heir.education.scholarship}·骑射{heir.education.martial}·品行{heir.education.virtue}
                  </span>
                )}
                {onSummon && (
                  <button type="button" disabled={!canSummon} onClick={() => onSummon(heir.id)}>
                    召见
                  </button>
                )}
                <span className="heir-list__favor">
                  宠爱 {heir.favor}
                  <button type="button" onClick={() => onAdjust(heir.id, 5)}>＋</button>
                  <button type="button" onClick={() => onAdjust(heir.id, -5)}>－</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>皇嗣</h2>
        {renderTable("daughter", "皇子")}
        {renderTable("son", "皇郎")}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
