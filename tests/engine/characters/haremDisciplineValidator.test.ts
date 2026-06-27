/**
 * haremDisciplineValidator 单元测试（HDV 系列）
 */
import { expect, it, describe } from "vitest";
import { validateHaremDisciplineLinks } from "../../../src/engine/characters/haremDisciplineValidator";
import { makeGameTime } from "../../../src/engine/calendar/time";

const now = makeGameTime(1, 1, "early");
const actorId = "actor_001";
const targetId = "target_001";

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

/** Well-formed chronicle event for a discipline incident. */
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

function makeIncident(id: string, status: "pending_response" | "resolved" = "pending_response") {
  return {
    id,
    actorId,
    targetId,
    status,
    courtEventId: `evt_${id}`,
    occurredAt: now,
    actorSnapshot: { peakFavor: 50, favor: 30 },
    targetSnapshot: { peakFavor: 40, favor: 30 },
    ...(status === "resolved" ? { resolution: "upheld" as const, resolvedAt: now } : {}),
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
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), makeEvent("evt_hdi_1_02", "hdi_1_02"));
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"), makeIncident("hdi_1_02"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MULTI_PENDING")).toBe(true);
  });

  it("HDV-05: courtEventId not in chronicle → error", () => {
    const s = makeSlice();
    // no event added to chronicle
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_EVENT")).toBe(true);
  });

  it("HDV-06: actorId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      actorId: "nonexistent_actor",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_ACTOR")).toBe(true);
  });

  it("HDV-07: targetId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      targetId: "nonexistent_target",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_TARGET")).toBe(true);
  });

  it("HDV-08: resolved + pending for same target → no multi-pending error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"), makeEvent("evt_hdi_1_02", "hdi_1_02"));
    s.haremDisciplineIncidents.push(
      makeIncident("hdi_1_01", "resolved"),
      makeIncident("hdi_1_02", "pending_response"),
    );
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.every((e) => e.code !== "HDI_MULTI_PENDING")).toBe(true);
  });

  it("HDV-09: actorId === targetId → HDI_SELF_TARGET error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      targetId: actorId,
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_SELF_TARGET")).toBe(true);
  });

  it("HDV-10: bad canonical id → HDI_BAD_CANONICAL_ID error", () => {
    const s = makeSlice();
    // id "discipline_001" doesn't match hdi_{year}_{mm}
    s.chronicle.push(makeEvent("evt_discipline_001", "discipline_001"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("discipline_001"),
      courtEventId: "evt_discipline_001",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_CANONICAL_ID")).toBe(true);
  });

  it("HDV-11: pending has resolvedAt → HDI_PENDING_HAS_RESOLVED_AT error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01", "pending_response"),
      resolvedAt: now,
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_PENDING_HAS_RESOLVED_AT")).toBe(true);
  });

  it("HDV-12: courtEvent type is not 'conflict' → HDI_BAD_EVENT_TYPE error", () => {
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

  it("HDV-13: courtEvent payload.subtype not 'harem_discipline' → HDI_BAD_EVENT_TYPE error", () => {
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

  it("HDV-14: payload.incidentId mismatch → HDI_EVENT_INCIDENT_MISMATCH error", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline", incidentId: "hdi_9_99" }, // wrong
      participants: [
        { charId: actorId, role: "discipliner" },
        { charId: targetId, role: "disciplined" },
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_INCIDENT_MISMATCH")).toBe(true);
  });

  it("HDV-15: missing disciplined participant → HDI_EVENT_PARTICIPANT_MISMATCH error", () => {
    const s = makeSlice();
    s.chronicle.push({
      id: "evt_hdi_1_01",
      type: "conflict",
      payload: { subtype: "harem_discipline", incidentId: "hdi_1_01" },
      participants: [
        { charId: actorId, role: "discipliner" },
        // target is missing
      ],
    });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_EVENT_PARTICIPANT_MISMATCH")).toBe(true);
  });

  it("HDV-16: snapshot peakFavor < favor → HDI_BAD_SNAPSHOT error", () => {
    const s = makeSlice();
    s.chronicle.push(makeEvent("evt_hdi_1_01", "hdi_1_01"));
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      actorSnapshot: { peakFavor: 20, favor: 50 }, // peakFavor < favor
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_BAD_SNAPSHOT")).toBe(true);
  });
});
