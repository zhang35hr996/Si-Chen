/**
 * 后宫对称网格（§四）。取代散点宫道图：左右两列 + 中央宫道主轴，
 * 长门宫置底部「冷宫·偏僻区」。每个宫殿只显示名称 + 住客(位分) + 至多两枚状态图标，
 * 不把人物卡/完整数据放进地图。点击宫殿→选中（右侧信息栏负责「进入」）。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { LocationContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { getPresentAt } from "../../engine/characters/presence";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { canSummon } from "../../store/bedchamber";

const COLD_PALACE = "changmengong"; // 长门宫 · 冷宫
/** 偏好排布顺序（仅视觉对称，无玩法含义）；未列出的宫殿排在其后。 */
const PREFERRED = [
  "zhaoning_gong",
  "yanhe_gong",
  "kunninggong",
  "chuxiu_gong",
  "jingren_gong",
  "zhongcui_gong",
  "xianfugong",
  "jiyue_gong",
  "chenghui_gong",
];

interface PalaceView {
  loc: LocationContent;
  resident?: string;
  statuses: Array<{ icon: string; label: string; tone: string }>;
  empty: boolean;
}

function viewOf(db: ContentDB, state: GameState, loc: LocationContent): PalaceView {
  const present = getPresentAt(db, state, loc.id);
  const consort = present.find((c) => c.kind === "consort");
  const statuses: PalaceView["statuses"] = [];
  if (consort) {
    const standing = state.standing[consort.id];
    const rank = standing ? db.ranks[standing.rank] : undefined;
    const lifecycle = standing?.lifecycle;
    if (lifecycle === "carrying") statuses.push({ icon: "孕", label: "怀胎", tone: "warn" });
    else if (lifecycle === "delivered") statuses.push({ icon: "育", label: "育嗣", tone: "jade" });
    else if (lifecycle === "candidate") statuses.push({ icon: "候", label: "候选承嗣", tone: "jade" });
    else if (lifecycle === "deceased") statuses.push({ icon: "故", label: "已故", tone: "dim" });
    if (lifecycle !== "deceased") {
      if (canSummon(state, consort.id)) statuses.push({ icon: "寝", label: "可侍寝", tone: "gold" });
      else statuses.push({ icon: "话", label: "可对话", tone: "gold" });
    }
    return {
      loc,
      resident: resolveIdentityLabel(consort, standing, rank),
      statuses: statuses.slice(0, 2),
      empty: false,
    };
  }
  return { loc, statuses: [{ icon: "空", label: "无人居住", tone: "dim" }], empty: true };
}

function PalaceCard({
  view,
  selected,
  onSelect,
}: {
  view: PalaceView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`harem-node${selected ? " is-selected" : ""}${view.empty ? " harem-node--empty" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="harem-node__name">{view.loc.name}</span>
      <span className="harem-node__resident">{view.resident ?? "暂无侍君"}</span>
      <span className="harem-node__status">
        {view.statuses.map((s) => (
          <i key={s.icon} className={`harem-status harem-status--${s.tone}`} title={s.label}>
            {s.icon}
          </i>
        ))}
      </span>
    </button>
  );
}

export function HaremGrid({
  db,
  state,
  locations,
  selectedId,
  onSelect,
}: {
  db: ContentDB;
  state: GameState;
  locations: LocationContent[];
  selectedId: string | null;
  onSelect: (loc: LocationContent) => void;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");

  const cold = locations.find((l) => l.id === COLD_PALACE);
  const rest = locations
    .filter((l) => l.id !== COLD_PALACE)
    .sort((a, b) => {
      const ia = PREFERRED.indexOf(a.id);
      const ib = PREFERRED.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  const half = Math.ceil(rest.length / 2);
  const left = rest.slice(0, half);
  const right = rest.slice(half);
  const card = (loc: LocationContent) => (
    <PalaceCard key={loc.id} view={viewOf(db, state, loc)} selected={selectedId === loc.id} onSelect={() => onSelect(loc)} />
  );

  return (
    <section className="harem" aria-label="后宫">
      <div className="harem__bar">
        <button
          type="button"
          className={`harem__toggle${view === "grid" ? " is-active" : ""}`}
          onClick={() => setView("grid")}
        >
          网格视图
        </button>
        <button
          type="button"
          className={`harem__toggle${view === "list" ? " is-active" : ""}`}
          onClick={() => setView("list")}
        >
          列表视图
        </button>
      </div>

      {view === "grid" ? (
        <div className="harem-grid">
          <div className="harem-grid__col">{left.map(card)}</div>
          <div className="harem-grid__axis" aria-hidden="true">
            <span className="harem-grid__axis-label">宫道</span>
          </div>
          <div className="harem-grid__col">{right.map(card)}</div>
          {cold && (
            <div className="harem-grid__cold">
              <span className="harem-grid__cold-label">冷宫 · 偏僻区</span>
              {card(cold)}
            </div>
          )}
        </div>
      ) : (
        <ul className="harem-list">
          {[...rest, ...(cold ? [cold] : [])].map((loc) => {
            const v = viewOf(db, state, loc);
            return (
              <li key={loc.id}>
                <button
                  type="button"
                  className={`harem-list__row${selectedId === loc.id ? " is-selected" : ""}`}
                  onClick={() => onSelect(loc)}
                >
                  <span className="harem-list__name">{loc.name}</span>
                  <span className="harem-list__resident">{v.resident ?? "暂无侍君"}</span>
                  <span className="harem-node__status">
                    {v.statuses.map((s) => (
                      <i key={s.icon} className={`harem-status harem-status--${s.tone}`} title={s.label}>
                        {s.icon}
                      </i>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
