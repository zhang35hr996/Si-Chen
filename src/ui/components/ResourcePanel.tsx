/** 只读国情面板：展示朝局/后宫/血脉资源，纯展示无写入。 */
import type { GameState } from "../../engine/state/types";

export function ResourcePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const { court, harem, bloodline } = state.resources;
  const row = (label: string, value: number) => (
    <li className="resource-panel__row">
      <span>{label}</span>
      <span className="resource-panel__val">{value}</span>
    </li>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="resource-panel" onClick={(e) => e.stopPropagation()}>
        <h2>国情</h2>
        <section>
          <h3>朝局</h3>
          <ul>
            {row("圣威", court.authority)}
            {row("民心", court.publicSupport)}
            {row("派系压力", court.factionPressure)}
          </ul>
        </section>
        <section>
          <h3>后宫</h3>
          <ul>
            {row("和睦", harem.harmony)}
            {row("妒意", harem.jealousy)}
          </ul>
        </section>
        <section>
          <h3>血脉</h3>
          <ul>{row("宗嗣合法性", bloodline.legitimacy)}</ul>
        </section>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
