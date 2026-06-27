/**
 * haremDisciplineValidator 单元测试（HDV 系列）
 */
import { expect, it, describe } from "vitest";
import { validateHaremDisciplineLinks } from "../../../src/engine/characters/haremDisciplineValidator";
import { dayIndexOf } from "../../../src/engine/calendar/time";

const actorId = "actor_001";
const targetId = "target_001";

// GameTime helpers (must have dayIndex for validator to work)
function gt(year: number, month: number, period: "early" | "mid" | "late" = "early") {
  return { year, month, period, dayIndex: dayIndexOf(year, month, period) };
}

const now = gt(1, 1, "early");

function makeSlice() {
  return {
    haremDisciplineIncidents: [] as Parameters<typeof validateHaremDisciplineLinks>[0]["haremDisciplineIncidents"],
    chronicle: [] as Parameters<typeof validateHaremDisciplineLinks>[0]["chronicle"],
    standing: {
      [actorId]: {},
      [targetId]: {},
    } as Parameters<typeof validateHaremDisciplineLinks>[0]["standing"],
  };
}

function makeEvent(id: string, incidentId: string) {
  return {
    id,
    type: "conflict" as const,
    payload: { subtype: "harem_discipline", incidentId },
    participants: [
      { charId: actorId, role: "discipliner" },
      { charId: targetId, role: "disciplined" },
    ],
  };
}

function makeIncident(
  id: string,
  status: "pending_response" | "resolved" = "pending_response",
  occurredAt = now,
) {
  return {
    id,
    actorId,
    targetId,
    status,
    courtEventId: `evt_${id}`,
    occurredAt,
    actorSnapshot: { peakFavor: 50, favor: 30 },
    targetSnapshot: { peakFavor: 40, favor: 30 },
    ...(status === "resolved"
      ? { resolution: "upheld" as const, resolvedAt: now, resolutionEventId: `res_evt_${id}` }
      : {}),
  };
}

function makeResolutionEvent(incidentId: string) {
  return {
    id: `res_evt_${incidentId}`,
    type: "conflict" as const,
    payload: { subtype: "harem_discipline_resolution", incidentId, resolution: "upheld" },
    participants: [
      { charId: "player", role: "arbitrator" },
      { charId: actorId, role: "discipliner" },
      { charId: targetId, role: "disciplined" },
    ],
  };
}

describe("validateHaremDisciplineLinks", () => {
  it("HDV-01: empty incidents → no errors", () => {
    const s = makeSlice();
    expect(validateHaremDisciplineLinks(s)).toHaveLength(0);
  });

  it("HDV-02: valid pending + matching event → no errors", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    expect(validateHaremDisciplineLinks(s)).toHaveLength(0);
  });

  it("HDV-03: duplicate id → error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), makeEvent("evt_hdi_1_01b", "hdi_1_01"));
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"), makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_DUPLICATE_ID")).toBe(true);
  });

  it("HDV-04: two pending_response for same target → error", () => {
    const s = makeSlice();
    const jan = gt(1, 1);
    const feb = gt(1, 2);
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), makeEvent("evt_hdi_1_02", "hdi_1_02"));
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "pending_response", jan), makeIncident("hdi_1_02", "pending_response", feb));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MULTI_PENDING")).toBe(true);
  });

  it("HDV-05: courtEventId not in chronicle → error", () => {
    const s = makeSlice();
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_EVENT")).toBe(true);
  });

  it("HDV-06: actorId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_1_01"), actorId: "nonexistent" });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_ACTOR")).toBe(true);
  });

  it("HDV-07: targetId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_1_01"), targetId: "nonexistent" });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_TARGET")).toBe(true);
  });

  it("HDV-08: resolved + pending for same target → no multi-pending error", () => {
    const s = makeSlice();
    const jan = gt(1, 1);
    const feb = gt(1, 2);
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), makeResolutionEvent("hdi_1_01"), makeEvent("evt_hdi_1_02", "hdi_1_02"));
    s.haremDisciplineIncidents.push(
      { ...makeIncident("hdi_1_01", "resolved", jan), resolvedAt: jan },
      makeIncident("hdi_1_02", "pending_response", feb),
    );
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.every((e) => e.code !== "HDI_MULTI_PENDING")).toBe(true);
  });

  it("HDV-09: actorId === targetId → HDI_SELF_TARGET error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_1_01"), targetId: actorId });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_SELF_TARGET")).toBe(true);
  });

  it("HDV-10: id year mismatches occurredAt → HDI_BAD_CANONICAL_ID", () => {
    const s = makeSlice();
    // id says year 9, but occurredAt is year 1
    const occ = gt(1, 1);
    s.chronicle.push(makeEvent("evt_hdi_9_01", "hdi_9_01"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_9_01", "pending_response", occ), courtEventId: "evt_hdi_9_01" });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_CANONICAL_ID")).toBe(true);
  });

  it("HDV-11: id month mismatches occurredAt → HDI_BAD_CANONICAL_ID", () => {
    const s = makeSlice();
    // id says month 05, but occurredAt.month = 1
    const occ = gt(1, 1);
    s.chronicle.push(makeEvent("evt_hdi_1_05", "hdi_1_05"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_1_05", "pending_response", occ), courtEventId: "evt_hdi_1_05" });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_CANONICAL_ID")).toBe(true);
  });

  it("HDV-12: pending has resolvedAt → HDI_PENDING_HAS_RESOLVED_AT error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({ ...makeIncident("hdi_1_01", "pending_response"), resolvedAt: now });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_PENDING_HAS_RESOLVED_AT")).toBe(true);
  });

  it("HDV-13: resolvedAt same phase as occurredAt → allowed", () => {
    const s = makeSlice();
    const occ = gt(1, 1, "mid");
    const occ2 = gt(1, 2);
    s.chronicle.push(makeEvent("evt_hdi_1_02", "hdi_1_02"), makeResolutionEvent("hdi_1_02"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_02", "resolved", occ2),
      resolvedAt: occ2, // same time
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.every((e) => e.code !== "HDI_RESOLVED_BEFORE_OCCURRENCE")).toBe(true);
    void occ;
  });

  it("HDV-14: resolvedAt earlier phase same month → HDI_RESOLVED_BEFORE_OCCURRENCE", () => {
    const s = makeSlice();
    // occurred late, resolved early of same month
    const occLate = gt(1, 2, "late");
    const resEarly = gt(1, 2, "early");
    s.chronicle.push(makeEvent("evt_hdi_1_02", "hdi_1_02"), makeResolutionEvent("hdi_1_02"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_02", "resolved", occLate),
      resolvedAt: resEarly,
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLVED_BEFORE_OCCURRENCE")).toBe(true);
  });

  it("HDV-15: courtEvent type not 'conflict' → HDI_BAD_EVENT_TYPE error", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "ceremony",
      payload: { subtype: "harem_discipline", incidentId: "hdi_1_01" },
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_EVENT_TYPE")).toBe(true);
  });

  it("HDV-16: payload.subtype not 'harem_discipline' → HDI_BAD_EVENT_TYPE error", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "birth", incidentId: "hdi_1_01" },
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_EVENT_TYPE")).toBe(true);
  });

  it("HDV-17: payload.incidentId mismatch → HDI_EVENT_INCIDENT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline", incidentId: "hdi_9_99" },
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_INCIDENT_MISMATCH")).toBe(true);
  });

  it("HDV-18: payload.incidentId missing → HDI_EVENT_INCIDENT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline" }, // incidentId absent
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_INCIDENT_MISMATCH")).toBe(true);
  });

  it("HDV-19: participants missing entirely → HDI_EVENT_PARTICIPANT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline", incidentId: "hdi_1_01" },
      // no participants field
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_PARTICIPANT_MISMATCH")).toBe(true);
  });

  it("HDV-20: missing disciplined participant → HDI_EVENT_PARTICIPANT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline", incidentId: "hdi_1_01" },
      participants: [{ charId: actorId, role: "discipliner" }], // target missing
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_PARTICIPANT_MISMATCH")).toBe(true);
  });

  it("HDV-21: snapshot peakFavor < favor → HDI_BAD_SNAPSHOT error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      actorSnapshot: { peakFavor: 20, favor: 50 },
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_SNAPSHOT")).toBe(true);
  });

  it("HDV-22: resolved without resolutionEventId → HDI_MISSING_RESOLUTION_EVENT", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    const inc = { ...makeIncident("hdi_1_01", "resolved") };
    // remove resolutionEventId that makeIncident added
    delete (inc as Record<string, unknown>)["resolutionEventId"];
    s.haremDisciplineIncidents.push(inc);
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_RESOLUTION_EVENT")).toBe(true);
  });

  it("HDV-23: resolutionEventId not in chronicle → HDI_MISSING_RESOLUTION_EVENT", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    // no resolution event added to chronicle
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_RESOLUTION_EVENT")).toBe(true);
  });

  it("HDV-24: resolution event has wrong subtype → HDI_BAD_RESOLUTION_EVENT", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "birth", incidentId: "hdi_1_01" }, // wrong subtype
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_RESOLUTION_EVENT")).toBe(true);
  });

  it("HDV-25: resolution event incidentId mismatch → HDI_RESOLUTION_INCIDENT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_9_99" }, // wrong id
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_INCIDENT_MISMATCH")).toBe(true);
  });

  it("HDV-26: two resolved incidents share resolutionEventId → HDI_RESOLUTION_EVENT_REUSED", () => {
    const s = makeSlice();
    const jan = gt(1, 1);
    const feb = gt(1, 2);
    const sharedResId = "res_evt_shared";
    s.chronicle.push(
      makeEvent("evt_hdi_1_01", "hdi_1_01"),
      makeEvent("evt_hdi_1_02", "hdi_1_02"),
      { id: sharedResId, type: "conflict", payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01" } },
    );
    s.haremDisciplineIncidents.push(
      { ...makeIncident("hdi_1_01", "resolved", jan), resolutionEventId: sharedResId },
      { ...makeIncident("hdi_1_02", "resolved", feb), resolutionEventId: sharedResId },
    );
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_EVENT_REUSED")).toBe(true);
  });

  it("HDV-27: pending_response with resolutionEventId → HDI_PENDING_HAS_RESOLUTION_EVENT", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01", "pending_response"),
      resolutionEventId: "res_evt_hdi_1_01",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_PENDING_HAS_RESOLUTION_EVENT")).toBe(true);
  });

  it("HDV-28: resolution event type not 'conflict' → HDI_BAD_RESOLUTION_EVENT", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "ceremony" as "conflict",
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01", resolution: "upheld" },
      participants: [
        { charId: "player", role: "arbitrator" },
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_RESOLUTION_EVENT")).toBe(true);
  });

  it("HDV-29: resolution event payload.resolution mismatch → HDI_RESOLUTION_VALUE_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict" as const,
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01", resolution: "protected" },
      participants: [
        { charId: "player", role: "arbitrator" },
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved")); // resolution: "upheld"
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_VALUE_MISMATCH")).toBe(true);
  });

  it("HDV-30: resolution event missing player/arbitrator → HDI_RESOLUTION_PARTICIPANT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict" as const,
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01", resolution: "upheld" },
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_PARTICIPANT_MISMATCH")).toBe(true);
  });

  it("HDV-31: resolution event missing actor/discipliner → HDI_RESOLUTION_PARTICIPANT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict" as const,
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01", resolution: "upheld" },
      participants: [
        { charId: "player", role: "arbitrator" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_PARTICIPANT_MISMATCH")).toBe(true);
  });

  it("HDV-32: resolution event missing target/disciplined → HDI_RESOLUTION_PARTICIPANT_MISMATCH", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), {
      id: "res_evt_hdi_1_01",
      type: "conflict" as const,
      payload: { subtype: "harem_discipline_resolution", incidentId: "hdi_1_01", resolution: "upheld" },
      participants: [
        { charId: "player", role: "arbitrator" },
        { charId: actorId, role: "discipliner" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01", "resolved"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_RESOLUTION_PARTICIPANT_MISMATCH")).toBe(true);
  });
});
