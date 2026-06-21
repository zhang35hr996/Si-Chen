/**
 * 后宫对称网格（§四/§七）。坤宁宫（皇后居所）置顶；中部 7 座居所分两列 + 中央宫道主轴；
 * 底部一排：长门宫（冷宫）｜储秀宫（待选秀男）。每座居所只显示名称 + 住客(本名·位分) +
 * 至多 3 枚状态图标（病/禁足/孕 及 育/候/故），不把人物卡/完整数据放进地图。
 * 点击宫殿→选中（右侧信息栏负责「进入」）。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { LocationContent } from "../../engine/content/schemas";
import type { CharacterStanding, GameState } from "../../engine/state/types";
import { getPresentAt } from "../../engine/characters/presence";
import { CHAMBERED_PALACE_ORDER } from "../../engine/characters/chambers";
import { resolveIdentityLabel } from "../../engine/characters/standing";

const EMPRESS_PALACE = "kunninggong"; // 坤宁宫 · 皇后（凤后）居所，置顶
const COLD_PALACE = "changmengong"; // 长门宫 · 冷宫
const CANDIDATE_PALACE = "chuxiu_gong"; // 储秀宫 · 待选秀男
/** 设宫室的居所排序（与 chambers.ts 同一来源）。 */
const RESIDENTIAL_ORDER = CHAMBERED_PALACE_ORDER;

interface Status {
  icon: string;
  label: string;
  tone: string;
}

/** 单名侍君的状态标：仅 病 / 禁足 / 孕。不标注「可侍寝/可对话」，也不标 育/候/故。 */
function statusesOf(standing: CharacterStanding | undefined): Status[] {
  const out: Status[] = [];
  if (standing?.lifecycle === "carrying") out.push({ icon: "孕", label: "怀胎", tone: "warn" });
  if (standing?.healthStatus && standing.healthStatus !== "healthy") out.push({ icon: "病", label: "凤体违和", tone: "warn" });
  if (standing?.confined) out.push({ icon: "禁", label: "禁足", tone: "dim" });
  return out;
}

interface PalaceView {
  loc: LocationContent;
  /** 住客（按位分降序）。 */
  residents: { id: string; label: string }[];
  statuses: Status[];
  /** 角色标签：冷宫 / 待选秀男 / 皇后居所 / undefined。 */
  role?: string;
  /** 设宫室居所的容量（5）；否则 undefined。 */
  capacity?: number;
}

function viewOf(db: ContentDB, state: GameState, loc: LocationContent, role?: string, capacity?: number): PalaceView {
  const consorts = getPresentAt(db, state, loc.id).filter((c) => c.kind === "consort");
  const residents = consorts.map((c) => ({
    id: c.id,
    label: resolveIdentityLabel(c, state.standing[c.id], state.standing[c.id] ? db.ranks[state.standing[c.id]!.rank] : undefined),
  }));
  // 汇总住客状态标，去重后至多 3 枚。
  const seen = new Set<string>();
  const statuses: Status[] = [];
  for (const c of consorts) {
    for (const s of statusesOf(state.standing[c.id])) {
      if (seen.has(s.icon)) continue;
      seen.add(s.icon);
      statuses.push(s);
    }
  }
  return { loc, residents, statuses: statuses.slice(0, 3), role, capacity };
}

function residentText(view: PalaceView): string {
  if (view.role === "待选秀男") return "待选秀男";
  if (view.residents.length === 0) return "暂无侍君";
  if (view.residents.length === 1) return view.residents[0]!.label;
  return `${view.residents[0]!.label} 等 ${view.residents.length} 人`;
}

function PalaceCard({
  view,
  selected,
  onSelect,
  className,
}: {
  view: PalaceView;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}) {
  const empty = view.residents.length === 0 && view.role !== "待选秀男";
  return (
    <button
      type="button"
      className={`harem-node${selected ? " is-selected" : ""}${empty ? " harem-node--empty" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="harem-node__name">
        {view.loc.name}
        {view.role && <span className="harem-node__role">{view.role}</span>}
        {view.capacity && (
          <span className="harem-node__occupancy">
            {view.residents.length}/{view.capacity}
          </span>
        )}
      </span>
      <span className="harem-node__resident">{residentText(view)}</span>
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
  const byId = (id: string) => locations.find((l) => l.id === id);

  const empress = byId(EMPRESS_PALACE);
  const cold = byId(COLD_PALACE);
  const candidate = byId(CANDIDATE_PALACE);

  const residential = RESIDENTIAL_ORDER.map(byId).filter((l): l is LocationContent => l !== undefined);
  const half = Math.ceil(residential.length / 2);
  const left = residential.slice(0, half);
  const right = residential.slice(half);

  const card = (loc: LocationContent, role?: string, capacity?: number, className?: string) => (
    <PalaceCard
      key={loc.id}
      view={viewOf(db, state, loc, role, capacity)}
      selected={selectedId === loc.id}
      onSelect={() => onSelect(loc)}
      className={className}
    />
  );

  // 列表视图：坤宁宫 → 7 居所 → 冷宫 → 储秀宫。
  const listOrder: Array<{ loc: LocationContent; role?: string; capacity?: number }> = [
    ...(empress ? [{ loc: empress, role: "皇后居所" }] : []),
    ...residential.map((loc) => ({ loc, capacity: 5 })),
    ...(cold ? [{ loc: cold, role: "冷宫" }] : []),
    ...(candidate ? [{ loc: candidate, role: "待选秀男" }] : []),
  ];

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
          {empress && <div className="harem-grid__empress">{card(empress, "皇后居所")}</div>}
          <div className="harem-grid__body">
            <div className="harem-grid__col">{left.map((loc) => card(loc, undefined, 5))}</div>
            <div className="harem-grid__axis" aria-hidden="true">
              <span className="harem-grid__axis-label">宫道</span>
            </div>
            <div className="harem-grid__col">{right.map((loc) => card(loc, undefined, 5))}</div>
          </div>
          {(cold || candidate) && (
            <div className="harem-grid__bottom">
              {cold && card(cold, "冷宫", undefined, "harem-node--cold")}
              {candidate && card(candidate, "待选秀男", undefined, "harem-node--candidate")}
            </div>
          )}
        </div>
      ) : (
        <ul className="harem-list">
          {listOrder.map(({ loc, role, capacity }) => {
            const v = viewOf(db, state, loc, role, capacity);
            return (
              <li key={loc.id}>
                <button
                  type="button"
                  className={`harem-list__row${selectedId === loc.id ? " is-selected" : ""}`}
                  onClick={() => onSelect(loc)}
                >
                  <span className="harem-list__name">
                    {loc.name}
                    {role && <span className="harem-node__role">{role}</span>}
                  </span>
                  <span className="harem-list__resident">{residentText(v)}</span>
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
