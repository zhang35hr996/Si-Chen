/**
 * 后宫院子（gongdian_yuanzi）。点后宫某宫进入此院：
 * 设 5 宫室的 7 座居所，左→右排 西偏殿｜西侧殿｜主殿｜东侧殿｜东偏殿，按 chamber 显住客；
 * 坤宁/长门/储秀等单居所只显居中主殿。点有人之殿→进入该侍君场景；空殿无动作。
 * 院子留作日后院中剧情的场所。
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { CHAMBERS, chamberOf, hasChambers } from "../../engine/characters/chambers";
import { getPresentAt } from "../../engine/characters/presence";

export interface Hall {
  chamber: string;
  name: string;
  occupant?: CharacterContent;
}

const CHUXIU_GONG = "chuxiu_gong";
const CHINESE_NUMS = [
  "一","二","三","四","五","六","七","八","九","十",
  "十一","十二","十三","十四","十五","十六","十七","十八","十九","二十",
  "二十一","二十二","二十三","二十四","二十五","二十六","二十七","二十八","二十九","三十",
];

/** 储秀宫动态厢房：主殿放第一位，其余每人一间厢房（最多厢房三十）。 */
function chuxiuHalls(consorts: CharacterContent[]): Hall[] {
  const halls: Hall[] = [{ chamber: "main", name: "主殿", occupant: consorts[0] }];
  for (let i = 1; i < consorts.length && i <= CHINESE_NUMS.length; i++) {
    halls.push({ chamber: `side_${i}`, name: `厢房${CHINESE_NUMS[i - 1]}`, occupant: consorts[i] });
  }
  return halls;
}

/** 院子里的殿位：设宫室居所给 5 殿（按 CHAMBERS 序），储秀宫动态厢房，其余特殊宫只给主殿。 */
export function hallsFor(db: ContentDB, state: GameState, location: LocationContent): Hall[] {
  const consorts = getPresentAt(db, state, location.id).filter((c) => c.kind === "consort");
  if (hasChambers(location.id)) {
    return CHAMBERS.map((ch) => ({
      chamber: ch.id,
      name: ch.name,
      occupant: consorts.find((c) => chamberOf(state.standing[c.id]) === ch.id),
    }));
  }
  if (location.id === CHUXIU_GONG) return chuxiuHalls(consorts);
  return [{ chamber: "main", name: "主殿", occupant: consorts[0] }];
}

/** 视觉左→右顺序（西偏｜西侧｜主｜东侧｜东偏）；未知殿位（厢房等）置末。 */
const HALL_ORDER_MAP: Record<string, number> = {
  west_annex: 0, west_side: 1, main: 2, east_side: 3, east_annex: 4,
};

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
  const ordered = [...halls].sort(
    (a, b) => (HALL_ORDER_MAP[a.chamber] ?? 99) - (HALL_ORDER_MAP[b.chamber] ?? 99),
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
      <div className={`courtyard__halls courtyard__halls--${ordered.length === 1 ? "single" : ordered.length > 5 ? "list" : "full"}`}>
        {ordered.map((h) => (
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
