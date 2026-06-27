/**
 * 后宫院子（gongdian_yuanzi）。点后宫某宫进入此院：
 * 设 5 宫室的 7 座居所，左→右排 西偏殿｜西侧殿｜主殿｜东侧殿｜东偏殿，按 chamber 显住客；
 * 坤宁/长门等单居所只显居中主殿。储秀宫按实际住客动态显示厢房一至厢房三十，
 * 让所有暂住秀男可以从院子直接进入，不必先点主殿再切换人物。
 * 院子留作日后院中剧情的场所。
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay, chineseNumeral } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { ChamberId, GameState } from "../../engine/state/types";
import { CHAMBERS, chamberOf, hasChambers } from "../../engine/characters/chambers";
import { getPresentAt } from "../../engine/characters/presence";

const CANDIDATE_PALACE = "chuxiu_gong";
export const MAX_CHUXIU_ROOMS = 30;

type HallId = ChamberId | `candidate_room_${number}`;

export interface Hall {
  chamber: HallId;
  name: string;
  occupant?: CharacterContent;
}

/**
 * 院子里的殿位：
 * - 设宫室居所给 5 殿（按 CHAMBERS 序）；
 * - 储秀宫按实际住客数给厢房一…三十，每间一人；
 * - 其它特殊宫只给主殿。
 */
export function hallsFor(db: ContentDB, state: GameState, location: LocationContent): Hall[] {
  const consorts = getPresentAt(db, state, location.id).filter((c) => c.kind === "consort");
  if (location.id === CANDIDATE_PALACE) {
    return consorts.slice(0, MAX_CHUXIU_ROOMS).map((occupant, index) => ({
      chamber: `candidate_room_${index + 1}`,
      name: `厢房${chineseNumeral(index + 1)}`,
      occupant,
    }));
  }
  if (hasChambers(location.id)) {
    return CHAMBERS.map((ch) => ({
      chamber: ch.id,
      name: ch.name,
      occupant: consorts.find((c) => chamberOf(state.standing[c.id]) === ch.id),
    }));
  }
  return [{ chamber: "main", name: "主殿", occupant: consorts[0] }];
}

/** 视觉左→右顺序（西偏｜西侧｜主｜东侧｜东偏）。 */
const HALL_ORDER: ChamberId[] = ["west_annex", "west_side", "main", "east_side", "east_annex"];

export function CourtyardScreen({
  db,
  state,
  registry,
  location,
  onPickHall,
  onBack,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  location: LocationContent;
  onPickHall: (consortId: string) => void;
  onBack: () => void;
}) {
  const bg = registry.resolveVariant("bg.gongdian_yuanzi", timeOfDay(state.calendar), "background");
  const halls = hallsFor(db, state, location);
  const isCandidatePalace = location.id === CANDIDATE_PALACE;
  const ordered = isCandidatePalace
    ? halls
    : [...halls].sort(
        (a, b) => HALL_ORDER.indexOf(a.chamber as ChamberId) - HALL_ORDER.indexOf(b.chamber as ChamberId),
      );

  return (
    <main
      className="courtyard"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <header className="courtyard__bar">
        <button type="button" className="courtyard__back" onClick={onBack}>返回</button>
        <h1 className="courtyard__name">{location.name}</h1>
      </header>
      <div
        className={`courtyard__halls courtyard__halls--${isCandidatePalace ? "candidate" : ordered.length === 1 ? "single" : "full"}`}
        style={isCandidatePalace ? {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
          alignContent: "start",
          overflowY: "auto",
        } : undefined}
      >
        {ordered.length === 0 && isCandidatePalace ? (
          <p className="courtyard__empty">储秀宫暂无待迁侍君</p>
        ) : ordered.map((h) => (
          <button
            key={h.chamber}
            type="button"
            className={`courtyard-hall courtyard-hall--${h.chamber}${h.occupant ? "" : " is-empty"}`}
            disabled={!h.occupant}
            onClick={() => h.occupant && onPickHall(h.occupant.id)}
          >
            <span className="courtyard-hall__name">{h.name}</span>
            <span className="courtyard-hall__occupant">
              {h.occupant ? h.occupant.profile.name : "空置"}
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
