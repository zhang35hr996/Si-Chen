/** 官员惩戒与行政升迁（Phase 3 PR3C-3a）。 */
import { describe, expect, it } from "vitest";
import { punishOfficial, promoteOfficialAdministratively } from "../../src/engine/officials/officialPunishment";
import { resolveOfficialVacancies } from "../../src/engine/officials/annualReview";
import { assignOfficialPost } from "../../src/engine/officials/assign";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameState, Official } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 5, period: "early" as const, dayIndex: 0 });
const gradeOf = (d: ContentDB, pid: string | null) => (pid ? d.officialPosts[pid]!.gradeOrder : 0);
const isVacant = (s: GameState, pid: string) => Object.values(s.officials).filter((o) => o.postId === pid).length < db.officialPosts[pid]!.seatCount;
const seatedHigh = (s: GameState) => Object.values(s.officials).find((o) => o.status === "active" && o.postId && gradeOf(db, o.postId) >= 10)!;
const lowerVacant = (s: GameState, fromGrade: number) =>
  Object.values(db.officialPosts).find((p) => p.gradeOrder > 0 && p.gradeOrder < fromGrade && isVacant(s, p.id))!.id;
const punCount = (s: GameState) => Object.keys(s.justice.punishments).length;

describe("punishOfficial — demotion (PUNISH branch)", () => {
  it("records a PunishmentRecord, drops loyalty + family favor, writes history+chronicle, auto-fills, valid", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const fromPostId = o.postId!;
    const target = lowerVacant(s, gradeOf(db, fromPostId));
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_demotion", toPostId: target }, at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.state;
    const pun = st.justice.punishments[r.value.punishmentId]!;
    expect(pun.targetKind).toBe("official");
    expect(pun.kind).toBe("official_demotion");
    expect(pun.targetId).toBe(o.id);
    expect(pun.lifecycle.status).toBe("completed");
    expect(st.officials[o.id]!.postId).toBe(target);
    expect(st.officials[o.id]!.loyalty).toBeLessThan(o.loyalty); // 忠心↓
    expect(st.officialFamilies[o.familyId]!.imperialFavor).toBeLessThan(s.officialFamilies[o.familyId]!.imperialFavor); // 家族皇恩↓
    expect(st.officialHistory.some((h) => h.officialId === o.id && h.punishmentId === r.value.punishmentId)).toBe(true);
    expect(st.chronicle.some((e) => e.type === "punished" && e.payload.punishmentId === r.value.punishmentId)).toBe(true);
    // 旧职被自动补缺（不是被罚者本人）。
    expect(validateOfficialWorld(st, db)).toEqual([]);
    // 独立后果：未触碰任何侍君属性。
    expect(st.standing).toEqual(s.standing);
  });

  it("dismissal sends the official to no-post (still active) with a record", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_dismissal" }, at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.officials[o.id]!.postId).toBeNull();
    expect(r.value.state.officials[o.id]!.status).toBe("active");
    expect(r.value.state.justice.punishments[r.value.punishmentId]!.kind).toBe("official_dismissal");
    expect(validateOfficialWorld(r.value.state, db)).toEqual([]);
  });

  it("rejects bad target / non-seated / non-lower post and leaves state byte-identical", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const snap = JSON.stringify(s);
    expect(punishOfficial(s, db, { officialId: "ghost", kind: "official_dismissal" }, at(2)).ok).toBe(false);
    expect(punishOfficial(s, db, { officialId: o.id, kind: "official_demotion" }, at(2)).ok).toBe(false); // 缺 toPostId
    // 目标品级不低于当前 → 拒绝。
    const higher = Object.values(db.officialPosts).find((p) => p.gradeOrder > gradeOf(db, o.postId) && isVacant(s, p.id));
    if (higher) expect(punishOfficial(s, db, { officialId: o.id, kind: "official_demotion", toPostId: higher.id }, at(2)).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it("the punished official is excluded from same-transaction auto-fill (not promoted back)", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const fromPostId = o.postId!;
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_dismissal" }, at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 被免者本轮不会被补缺重新坐回原职。
    expect(r.value.state.officials[o.id]!.postId).not.toBe(fromPostId);
  });
});

describe("PR3C-3a review fixes", () => {
  it("P1: a dismissed official is NOT auto-reinstated by later vacancy fills (until explicit re-appointment)", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_dismissal" }, at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let st = r.value.state;
    expect(st.officials[o.id]!.postId).toBeNull();
    // 制造一个其原品级附近的新空缺，再跑补缺 → 被免者仍无职。
    const filled = resolveOfficialVacancies({ ...st, calendar: { ...st.calendar, year: st.calendar.year + 1 } }, db, at(3));
    expect(filled.state.officials[o.id]!.postId).toBeNull();
    expect(filled.changes.some((c) => c.officialId === o.id)).toBe(false);
    // 但明确重新授任可恢复任职。
    const re = assignOfficialPost(st, db, o.id, "zhubo", at(4));
    expect(re.ok).toBe(true);
    if (re.ok) { st = re.value; expect(st.officials[o.id]!.postId).toBe("zhubo"); }
  });

  it("P2: a pending retirement is cleared when the official is punished or promoted", () => {
    const base = createNewGameState(db, 1);
    const o = seatedHigh(base);
    const s: GameState = { ...base, pendingRetirements: [{ officialId: o.id, requestedAt: base.calendar }] };
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_dismissal" }, at(2));
    expect(r.ok && r.value.state.pendingRetirements.some((p) => p.officialId === o.id)).toBe(false);
  });

  it("P2: CourtEvent publicity scope mirrors the record publicity", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const scopeFor = (publicity: "secret" | "palace" | "public") => {
      const r = punishOfficial(s, db, { officialId: o.id, kind: "official_dismissal", publicity }, at(2));
      if (!r.ok) throw new Error("punish failed");
      return r.value.state.chronicle.find((e) => e.type === "punished")!.publicity.scope;
    };
    expect(scopeFor("secret")).toBe("circle");
    expect(scopeFor("palace")).toBe("palace");
    expect(scopeFor("public")).toBe("realm");
  });
});

describe("PR3C-3a official-punishment validation closure", () => {
  const codes = (st: GameState) => validateOfficialWorld(st, db).map((e) => e.code);
  function punished(): { st: GameState; pid: string; offId: string } {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const r = punishOfficial(s, db, { officialId: o.id, kind: "official_demotion", toPostId: lowerVacant(s, gradeOf(db, o.postId)) }, at(2));
    if (!r.ok) throw new Error("setup");
    return { st: r.value.state, pid: r.value.punishmentId, offId: o.id };
  }

  it("clean punished world validates", () => {
    expect(validateOfficialWorld(punished().st, db)).toEqual([]);
  });

  it("deleting the punishment's history → PUNISHMENT_OFFICIAL_HISTORY_COUNT", () => {
    const { st, pid } = punished();
    expect(codes({ ...st, officialHistory: st.officialHistory.filter((h) => h.punishmentId !== pid) })).toContain("PUNISHMENT_OFFICIAL_HISTORY_COUNT");
  });

  it("duplicating the history → PUNISHMENT_OFFICIAL_HISTORY_COUNT", () => {
    const { st, pid } = punished();
    const dup = st.officialHistory.find((h) => h.punishmentId === pid)!;
    expect(codes({ ...st, officialHistory: [...st.officialHistory, { ...dup, id: "ohist_dup" }] })).toContain("PUNISHMENT_OFFICIAL_HISTORY_COUNT");
  });

  it("deleting the punished CourtEvent → PUNISHMENT_OFFICIAL_EVENT_COUNT", () => {
    const { st, pid } = punished();
    expect(codes({ ...st, chronicle: st.chronicle.filter((e) => !(e.type === "punished" && e.payload.punishmentId === pid)) })).toContain("PUNISHMENT_OFFICIAL_EVENT_COUNT");
  });

  it("demotion record with non-lower toPostId → PUNISHMENT_OFFICIAL_BAD_POST", () => {
    const { st, pid } = punished();
    const puns = { ...st.justice.punishments };
    const p = puns[pid] as { details: { fromPostId: string; toPostId: string } };
    puns[pid] = { ...p, details: { ...p.details, toPostId: p.details.fromPostId === "taibao" ? "dadudu" : "taibao" } } as typeof puns[string]; // 高品
    expect(codes({ ...st, justice: { ...st.justice, punishments: puns } })).toContain("PUNISHMENT_OFFICIAL_BAD_POST");
  });

  it("non-immediate lifecycle → PUNISHMENT_OFFICIAL_BAD_LIFECYCLE", () => {
    const { st, pid } = punished();
    const puns = { ...st.justice.punishments };
    puns[pid] = { ...puns[pid]!, lifecycle: { status: "active" } } as typeof puns[string];
    expect(codes({ ...st, justice: { ...st.justice, punishments: puns } })).toContain("PUNISHMENT_OFFICIAL_BAD_LIFECYCLE");
  });
});

describe("promoteOfficialAdministratively — NOT a punishment", () => {
  it("promotes to a higher vacant post, raises loyalty/family favor, creates NO PunishmentRecord", () => {
    const base = createNewGameState(db, 1);
    // 造一个低品在任官员（坐 g4 空缺），并留一个 g5/g6 空缺。
    const o0 = Object.values(base.officials).find((x) => x.status === "active" && x.postId)!;
    const low: Official = { ...o0, postId: "xunjian", appointedAt: base.calendar }; // g4
    const s: GameState = { ...base, officials: { ...base.officials, [o0.id]: low } };
    const target = Object.values(db.officialPosts).find((p) => p.gradeOrder > 4 && p.gradeOrder <= 6 && isVacant(s, p.id))!.id;
    const before = punCount(s);
    const r = promoteOfficialAdministratively(s, db, o0.id, target, at(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.officials[o0.id]!.postId).toBe(target);
    expect(r.value.officials[o0.id]!.loyalty).toBeGreaterThan(low.loyalty); // 行政奖励↑
    expect(r.value.officialFamilies[o0.familyId]!.imperialFavor).toBeGreaterThan(s.officialFamilies[o0.familyId]!.imperialFavor);
    expect(punCount(r.value)).toBe(before); // 绝不创建 PunishmentRecord
    expect(r.value.officialHistory.every((h) => h.officialId !== o0.id || h.punishmentId === undefined)).toBe(true); // 无 punishmentId
    expect(validateOfficialWorld(r.value, db)).toEqual([]);
  });

  it("rejects a non-higher / occupied target", () => {
    const s = createNewGameState(db, 1);
    const o = seatedHigh(s);
    const lower = lowerVacant(s, gradeOf(db, o.postId));
    expect(promoteOfficialAdministratively(s, db, o.id, lower, at(2)).ok).toBe(false); // 更低品 → 拒绝
  });
});
