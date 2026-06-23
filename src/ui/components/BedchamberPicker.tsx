/** 御书房「翻牌子」：全屏 fanpaizi 背景，居中托盘上排开宫中侍君竖刻名牌，点牌即召见。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { inPalaceConsorts } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import { canSummon } from "../../store/bedchamber";

export function BedchamberPicker({
  db,
  state,
  registry,
  onPick,
  onClose,
  mode = "bedchamber",
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  onPick: (charId: string) => void;
  onClose: () => void;
  /** 呈现语义：bedchamber=翻牌子（侍寝，默认）；summon=召见侍君（叙话/临场，不预设侍寝）。仅改标题，选人筛选不变。 */
  mode?: "bedchamber" | "summon";
}) {
  const consorts = inPalaceConsorts(db, state).filter((c) => canSummon(state, c.id));
  const bg = registry.background("bg.fanpaizi");
  const title = mode === "summon" ? "召见侍君" : "翻牌子";

  return (
    <div
      className="fanpaizi"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <button type="button" className="fanpaizi__close" onClick={onClose}>关闭</button>
      <h2 className="fanpaizi__title">{title}</h2>
      <div className="fanpaizi__tray">
        {consorts.map((c) => {
          const st = state.standing[c.id]!;
          return (
            <button key={c.id} type="button" className="fanpaizi-tablet" onClick={() => onPick(c.id)}>
              <span className="fanpaizi-tablet__name">{c.profile.name}</span>
              <span className="fanpaizi-tablet__rank">{db.ranks[st.rank]?.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
