/**
 * 六宫主理权逻辑（后宫行政）。
 *
 * 主理权三态：
 *   empress        — 凤后正常掌宫（默认）。
 *   acting_consort — 凤后禁足期间由某位侍君奉旨协理。
 *   neiwu_proxy    — 凤后禁足且无合格侍君，内务府暂代宫务。
 *
 * 此模块不依赖 presence.ts / greeting.ts，避免循环引用。
 */
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState, HaremAdministrationState } from "../state/types";
import { isConfined } from "./confinement";
import { resolveDisplayName } from "./standing";

/** 凤后驸级门槛：rank.order 须 >= fu 的 order。 */
function fuOrder(db: ContentDB): number {
  return db.ranks["fu"]?.order ?? 140;
}

/**
 * 合格六宫协理候选：
 *   - 种类为 consort
 *   - 非凤后本人（rank !== "fenghou"）
 *   - 有 standing 且未故
 *   - 未禁足
 *   - 不在长门宫（冷宫）
 *   - lifecycle 不是 candidate
 *   - 当前位分 order >= fu.order
 *
 * 排序：有效位分从高到低；同位分按 charId 字典序（稳定）。
 * 生成侍君（generatedConsorts）同样纳入候选；按 id 去重（generatedConsorts 已并入 db 时不重复）。
 */
export function eligibleHaremAdministrators(db: ContentDB, state: GameState): CharacterContent[] {
  const minOrder = fuOrder(db);
  // 按 id 去重，避免 generatedConsorts 被 App 合并进 db 时重复出现。
  const allById = new Map<string, CharacterContent>();
  for (const c of Object.values(db.characters)) allById.set(c.id, c);
  for (const c of Object.values(state.generatedConsorts)) allById.set(c.id, c);
  const all = Array.from(allById.values());
  return all
    .filter((c) => {
      if (c.kind !== "consort") return false;
      const st = state.standing[c.id];
      if (!st) return false;
      if (st.rank === "fenghou") return false;
      if (st.lifecycle === "deceased" || st.lifecycle === "candidate") return false;
      const rankMeta = db.ranks[st.rank];
      if (!rankMeta || rankMeta.order < minOrder) return false;
      if (isConfined(state, c.id)) return false;
      const home = st.residence ?? c.defaultLocation;
      if (home === "changmengong") return false;
      return true;
    })
    .sort((a, b) => {
      const stA = state.standing[a.id]!;
      const stB = state.standing[b.id]!;
      const orderA = db.ranks[stA.rank]?.order ?? 0;
      const orderB = db.ranks[stB.rank]?.order ?? 0;
      if (orderB !== orderA) return orderB - orderA;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** 当前六宫主理权状态（读取 GameState 字段）。 */
export function getHaremAdministrationState(state: GameState): HaremAdministrationState {
  return state.haremAdministration;
}

/**
 * 返回请安地点 locationId，或 null（内务府代理时暂停正式请安）。
 *   empress mode        → 凤后当前寝殿（residence ?? defaultLocation ?? "kunninggong"）
 *   acting_consort mode → 协理者当前寝殿
 *   neiwu_proxy mode    → null
 */
export function getGreetingLocation(db: ContentDB, state: GameState): string | null {
  const admin = state.haremAdministration;
  if (admin.mode === "neiwu_proxy") return null;

  if (admin.mode === "empress") {
    // 凤后寝殿：找当前 rank===fenghou 的角色
    for (const [id, st] of Object.entries(state.standing)) {
      if (st.rank === "fenghou" && st.lifecycle !== "deceased") {
        const char = db.characters[id];
        return st.residence ?? char?.defaultLocation ?? "kunninggong";
      }
    }
    return "kunninggong"; // fallback
  }

  // acting_consort
  const st = state.standing[admin.charId];
  const char = db.characters[admin.charId] ?? state.generatedConsorts[admin.charId];
  return st?.residence ?? char?.defaultLocation ?? null;
}

/**
 * 归还主理权给凤后后的后宫主理权状态（用于帮助确定归还后的礼安地点）。
 * 当凤后禁足解除时使用。
 */
export function empressRestoredAdministration(): HaremAdministrationState {
  return { mode: "empress" };
}

/** 请安主持者视图：用于 UI 层动态生成请安入口文案。neiwu_proxy 时无正式请安，返回 null。 */
export interface GreetingHostView {
  mode: "empress" | "acting_consort";
  hostId: string;
  /** 展示名（如「沈织白」「许贵君」）。 */
  hostName: string;
  locationId: string;
  /** 宫殿名（如「坤宁宫」「昭阳宫」）。 */
  locationName: string;
}

/**
 * 当前请安主持者视图。
 *   empress mode        → 凤后及其寝殿
 *   acting_consort mode → 协理者及其寝殿
 *   neiwu_proxy mode    → null（无正式请安）
 */
export function getGreetingHostView(db: ContentDB, state: GameState): GreetingHostView | null {
  const admin = state.haremAdministration;
  if (admin.mode === "neiwu_proxy") return null;

  if (admin.mode === "empress") {
    for (const [id, st] of Object.entries(state.standing)) {
      if (st.rank === "fenghou" && st.lifecycle !== "deceased") {
        const char = db.characters[id];
        const locationId = st.residence ?? char?.defaultLocation ?? "kunninggong";
        const location = db.locations[locationId];
        const rank = db.ranks[st.rank];
        const hostName = char ? resolveDisplayName(char, st, rank) : "皇后";
        return { mode: "empress", hostId: id, hostName, locationId, locationName: location?.name ?? locationId };
      }
    }
    return null;
  }

  // acting_consort
  const charId = admin.charId;
  const st = state.standing[charId];
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!st || !char) return null;
  const locationId = st.residence ?? char.defaultLocation;
  if (!locationId) return null;
  const location = db.locations[locationId];
  const rank = db.ranks[st.rank];
  const hostName = resolveDisplayName(char, st, rank);
  return { mode: "acting_consort", hostId: charId, hostName, locationId, locationName: location?.name ?? locationId };
}
