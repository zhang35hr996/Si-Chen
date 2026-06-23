import type { GameState } from "../state/types";
import type { StateDiffEntry } from "./types";

/** Shallow equality for primitives; JSON-stringify for objects/arrays. */
function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" && typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function record(
  out: StateDiffEntry[],
  path: string,
  before: unknown,
  after: unknown,
): void {
  if (!eq(before, after)) out.push({ path, before, after });
}

/**
 * Targeted boundary diff of two GameState snapshots.
 * Returns a list of paths that changed value. Used by the trace system to detect
 * mutations not attributed to any explicit effect.
 *
 * Covers: standing, resources, memories, flags, statusEffects, pendingAftermath,
 * pendingDaxuan, haremAdministration, calendar, taihou, chronicle, eventLog, gameOver.
 * Does NOT descend into full object graphs — uses per-field comparisons at known paths.
 */
export function diffGameState(before: GameState, after: GameState): StateDiffEntry[] {
  const out: StateDiffEntry[] = [];

  // ── standing ──────────────────────────────────────────────────────────
  const charIds = new Set([...Object.keys(before.standing), ...Object.keys(after.standing)]);
  for (const id of charIds) {
    const bs = before.standing[id];
    const as = after.standing[id];
    if (!bs && as) { out.push({ path: `standing.${id}`, before: undefined, after: as }); continue; }
    if (bs && !as) { out.push({ path: `standing.${id}`, before: bs, after: undefined }); continue; }
    if (!bs || !as) continue;
    const prefix = `standing.${id}`;
    record(out, `${prefix}.favor`, bs.favor, as.favor);
    record(out, `${prefix}.rank`, bs.rank, as.rank);
    record(out, `${prefix}.lifecycle`, bs.lifecycle, as.lifecycle);
    record(out, `${prefix}.health`, bs.health, as.health);
    record(out, `${prefix}.healthStatus`, bs.healthStatus, as.healthStatus);
    record(out, `${prefix}.title`, bs.title, as.title);
    record(out, `${prefix}.residence`, bs.residence, as.residence);
    record(out, `${prefix}.chamber`, bs.chamber, as.chamber);
    record(out, `${prefix}.affection`, bs.affection, as.affection);
    record(out, `${prefix}.lastPhysicianVisitMonthKey`, bs.lastPhysicianVisitMonthKey, as.lastPhysicianVisitMonthKey);
    record(out, `${prefix}.recoverUntilMonth`, bs.recoverUntilMonth, as.recoverUntilMonth);
    record(out, `${prefix}.deathRecord`, bs.deathRecord, as.deathRecord);
  }

  // ── resources.sovereign ───────────────────────────────────────────────
  const sovFields = [
    "health", "healthStatus", "diligence", "prestige", "martial", "statecraft",
    "cruelty", "fatigue", "regimeSecurity", "lastPhysicianVisitMonthKey",
  ] as const;
  for (const f of sovFields) {
    record(out, `resources.sovereign.${f}`, before.resources.sovereign[f], after.resources.sovereign[f]);
  }

  // ── resources.nation ──────────────────────────────────────────────────
  const nationFields = [
    "military", "treasury", "publicSupport", "productivity", "governance",
    "consortClanPower", "ministerLoyalty", "corruption", "clanDiscontent", "rumor",
  ] as const;
  for (const f of nationFields) {
    record(out, `resources.nation.${f}`, before.resources.nation[f], after.resources.nation[f]);
  }

  // ── resources.bloodline ───────────────────────────────────────────────
  record(out, "resources.bloodline.pregnancy.status",
    before.resources.bloodline.pregnancy.status, after.resources.bloodline.pregnancy.status);
  record(out, "resources.bloodline.menstrualStatus",
    before.resources.bloodline.menstrualStatus, after.resources.bloodline.menstrualStatus);

  // gestations: track by length + content hash
  if (!eq(before.resources.bloodline.gestations, after.resources.bloodline.gestations)) {
    record(out, "resources.bloodline.gestations",
      before.resources.bloodline.gestations.length, after.resources.bloodline.gestations.length);
  }

  // heirs: track length changes + per-heir field changes
  const bHeirs = before.resources.bloodline.heirs;
  const aHeirs = after.resources.bloodline.heirs;
  if (bHeirs.length !== aHeirs.length) {
    record(out, "resources.bloodline.heirs", bHeirs.length, aHeirs.length);
  }
  const minLen = Math.min(bHeirs.length, aHeirs.length);
  for (let i = 0; i < minLen; i++) {
    const bh = bHeirs[i]!;
    const ah = aHeirs[i]!;
    const hp = `resources.bloodline.heirs.${bh.id}`;
    record(out, `${hp}.lifecycle`, bh.lifecycle, ah.lifecycle);
    record(out, `${hp}.health`, bh.health, ah.health);
    record(out, `${hp}.favor`, bh.favor, ah.favor);
    record(out, `${hp}.education.scholarship`, bh.education.scholarship, ah.education.scholarship);
    record(out, `${hp}.education.martial`, bh.education.martial, ah.education.martial);
    record(out, `${hp}.education.virtue`, bh.education.virtue, ah.education.virtue);
  }

  // storehouse items
  const bItems = before.resources.storehouse.items;
  const aItems = after.resources.storehouse.items;
  const itemKeys = new Set([...Object.keys(bItems), ...Object.keys(aItems)]);
  for (const k of itemKeys) {
    record(out, `resources.storehouse.items.${k}`, bItems[k] ?? 0, aItems[k] ?? 0);
  }

  // ── memories ──────────────────────────────────────────────────────────
  const memCharIds = new Set([...Object.keys(before.memories), ...Object.keys(after.memories)]);
  for (const id of memCharIds) {
    const bm = before.memories[id];
    const am = after.memories[id];
    if (bm && am && bm.entries.length !== am.entries.length) {
      record(out, `memories.${id}.entries`, bm.entries.length, am.entries.length);
    }
  }

  // ── flags ─────────────────────────────────────────────────────────────
  const flagKeys = new Set([...Object.keys(before.flags), ...Object.keys(after.flags)]);
  for (const k of flagKeys) {
    record(out, `flags.${k}`, before.flags[k], after.flags[k]);
  }

  // ── statusEffects ─────────────────────────────────────────────────────
  if (before.statusEffects.length !== after.statusEffects.length) {
    record(out, "statusEffects", before.statusEffects.length, after.statusEffects.length);
  } else {
    // Check for lifted confinements (same-length array, only liftedTurn changed)
    for (let i = 0; i < before.statusEffects.length; i++) {
      const bs = before.statusEffects[i]!;
      const as = after.statusEffects[i]!;
      if (bs.liftedTurn !== as.liftedTurn) {
        record(out, `statusEffects[${i}].liftedTurn`, bs.liftedTurn, as.liftedTurn);
      }
    }
  }

  // ── pendingAftermath ──────────────────────────────────────────────────
  record(out, "pendingAftermath", before.pendingAftermath.length, after.pendingAftermath.length);

  // ── pendingDaxuan ─────────────────────────────────────────────────────
  record(out, "pendingDaxuan",
    JSON.stringify(before.pendingDaxuan), JSON.stringify(after.pendingDaxuan));

  // ── haremAdministration ───────────────────────────────────────────────
  record(out, "haremAdministration.mode",
    before.haremAdministration.mode, after.haremAdministration.mode);
  if (before.haremAdministration.mode === "acting_consort" || after.haremAdministration.mode === "acting_consort") {
    const bc = before.haremAdministration.mode === "acting_consort" ? before.haremAdministration.charId : undefined;
    const ac = after.haremAdministration.mode === "acting_consort" ? after.haremAdministration.charId : undefined;
    record(out, "haremAdministration.charId", bc, ac);
  }

  // ── calendar ──────────────────────────────────────────────────────────
  record(out, "calendar.dayIndex", before.calendar.dayIndex, after.calendar.dayIndex);
  record(out, "calendar.ap", before.calendar.ap, after.calendar.ap);
  record(out, "calendar.year", before.calendar.year, after.calendar.year);
  record(out, "calendar.month", before.calendar.month, after.calendar.month);

  // ── taihou ────────────────────────────────────────────────────────────
  record(out, "taihou.health", before.taihou.health, after.taihou.health);
  record(out, "taihou.healthStatus", before.taihou.healthStatus, after.taihou.healthStatus);
  record(out, "taihou.deceased", before.taihou.deceased, after.taihou.deceased);
  record(out, "taihou.lastPhysicianVisitMonthKey",
    before.taihou.lastPhysicianVisitMonthKey, after.taihou.lastPhysicianVisitMonthKey);

  // ── gameOver ──────────────────────────────────────────────────────────
  record(out, "gameOver", JSON.stringify(before.gameOver), JSON.stringify(after.gameOver));

  // ── chronicle / eventLog (length only) ────────────────────────────────
  record(out, "chronicle", before.chronicle.length, after.chronicle.length);
  record(out, "eventLog", before.eventLog.length, after.eventLog.length);

  // ── overnightWith / excusedFromGreeting ───────────────────────────────
  record(out, "overnightWith", JSON.stringify(before.overnightWith), JSON.stringify(after.overnightWith));

  return out;
}
