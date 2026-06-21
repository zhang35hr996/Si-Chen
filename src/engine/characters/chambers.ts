/**
 * 后宫居所宫室（§七）。除坤宁宫（皇后单独居所）、长门宫（冷宫）、储秀宫（待选秀男）外，
 * 其余 7 座居所各分 5 间宫室，每间至多住一名侍君。宫室是同一地点内的「槽位」，
 * 不另立地点；侍君的归属记在 CharacterStanding.chamber，缺省为主殿。
 */
import type { ChamberId } from "../state/types";

export const CHAMBERS: ReadonlyArray<{ id: ChamberId; name: string }> = [
  { id: "main", name: "主殿" },
  { id: "east_side", name: "东侧殿" },
  { id: "west_side", name: "西侧殿" },
  { id: "east_annex", name: "东偏殿" },
  { id: "west_annex", name: "西偏殿" },
];

/** 设 5 宫室的居所（坤宁宫/长门宫/储秀宫除外）。 */
export const CHAMBERED_PALACE_ORDER: readonly string[] = [
  "zhaoning_gong",
  "yanhe_gong",
  "jingren_gong",
  "zhongcui_gong",
  "xianfugong",
  "jiyue_gong",
  "chenghui_gong",
  "chengqian_gong",
  "yongshou_gong",
  "yikun_gong",
];

export const CHAMBERED_PALACES: ReadonlySet<string> = new Set(CHAMBERED_PALACE_ORDER);

export function hasChambers(locationId: string): boolean {
  return CHAMBERED_PALACES.has(locationId);
}

export function chamberOf(standing: { chamber?: ChamberId } | undefined): ChamberId {
  return standing?.chamber ?? "main";
}
