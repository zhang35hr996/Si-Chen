import { describe, expect, it } from "vitest";
import {
  dismissOfficial,
  exileOfficial,
  imprisonOfficial,
  markOfficialDead,
  restoreOfficialToActive,
  retireOfficial,
} from "../../src/engine/officials/lifecycle";
import { assignOfficialPost } from "../../src/engine/officials/assign";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 3, month: 5, period: "mid" as const, dayIndex: 100 };
const seated = () => {
  const s = createNewGameState(db, 1);
  const o = Object.values(s.officials).find((x) => x.postId !== null)!;
  return { s, id: o.id, postId: o.postId! };
};

describe("lifecycle services — leaving active", () => {
  it("retire: active→retired, releases seat, records history + reason/time", () => {
    const { s, id, postId } = seated();
    const r = retireOfficial(s, id, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = r.value.officials[id]!;
    expect(o.status).toBe("retired");
    expect(o.postId).toBeNull();
    expect(o.statusReason).toBe("retirement");
    expect(o.statusChangedAt).toEqual(T);
    const h = r.value.officialHistory.at(-1)!;
    expect(h).toMatchObject({ officialId: id, status: "retired", reason: "retirement", vacatedPostId: postId });
    expect(s.officials[id]!.status).toBe("active"); // input immutable
    expect(validateOfficialWorld(r.value, db)).toEqual([]);
  });

  it("imprison / exile set status + reason", () => {
    const { s, id } = seated();
    const imp = imprisonOfficial(s, id, T);
    expect(imp.ok && imp.value.officials[id]!.status === "imprisoned" && imp.value.officials[id]!.statusReason === "imprisonment").toBe(true);
    const ex = exileOfficial(s, id, T);
    expect(ex.ok && ex.value.officials[id]!.status === "exiled" && ex.value.officials[id]!.statusReason === "exile").toBe(true);
  });

  it("dismiss: stays active but vacates post; history records dismissal; needs a seat", () => {
    const { s, id, postId } = seated();
    const r = dismissOfficial(s, id, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = r.value.officials[id]!;
    expect(o.status).toBe("active");
    expect(o.postId).toBeNull();
    expect(o.statusReason).toBeUndefined(); // active ⇒ no reason on the official
    expect(r.value.officialHistory.at(-1)).toMatchObject({ status: "active", reason: "dismissal", vacatedPostId: postId });
    // dismissing an already-vacant active official fails
    const again = dismissOfficial(r.value, id, T);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe("OFFICIAL_NO_POST");
  });

  it("markDead: terminal, sets deathAt, releases seat, keeps the person", () => {
    const { s, id } = seated();
    const r = markOfficialDead(s, id, "natural_death", T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = r.value.officials[id]!;
    expect(o.status).toBe("dead");
    expect(o.deathAt).toEqual(T);
    expect(o.postId).toBeNull();
    expect(r.value.officials[id]).toBeDefined(); // not deleted
    const again = markOfficialDead(r.value, id, "execution", T);
    expect(again.ok).toBe(false); // dead is terminal
  });
});

describe("lifecycle services — restore + appoint", () => {
  it("restore: imprisoned→active with postId still null; then assignOfficialPost seats", () => {
    const { s, id } = seated();
    const imp = imprisonOfficial(s, id, T);
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    const res = restoreOfficialToActive(imp.value, id, T);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.officials[id]!.status).toBe("active");
    expect(res.value.officials[id]!.postId).toBeNull();
    expect(res.value.officials[id]!.statusReason).toBeUndefined();
    // reuse assignOfficialPost (no parallel appoint system)
    const ap = assignOfficialPost(res.value, db, id, "dianshi");
    expect(ap.ok).toBe(true);
  });

  it("rejects unknown official and bad transitions", () => {
    const { s, id } = seated();
    expect(retireOfficial(s, "nobody", T).ok).toBe(false);
    const dead = markOfficialDead(s, id, "natural_death", T);
    expect(dead.ok).toBe(true);
    if (!dead.ok) return;
    const r = retireOfficial(dead.value, id, T); // can't retire the dead
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("OFFICIAL_BAD_TRANSITION");
  });

  it("drops a pending retirement when the official leaves active", () => {
    const { s, id } = seated();
    const withPending = { ...s, pendingRetirements: [{ officialId: id, requestedAt: T }] };
    const r = imprisonOfficial(withPending, id, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pendingRetirements).toHaveLength(0);
  });
});
